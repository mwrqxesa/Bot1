const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

class CallRankingManager {
  constructor(client) {
    this.client = client;

    this.dataDir = path.join(__dirname, '..', 'data');
    this.dbPath = path.join(this.dataDir, 'call_ranking.sqlite');
    this.legacyJsonPath = path.join(this.dataDir, 'call_ranking.json');
    this.legacyBackupJsonPath = path.join(this.dataDir, 'call_ranking.backup.json');

    this.activeSessions = new Map(); // guildId:userId => timestamp (memória)
    this.interval = null;
    this.updateIntervalMs = 5 * 60 * 1000; // 5 min

    // snapshots periódicos (export JSON)
    this.snapshotBackupIntervalMs = 10 * 60 * 60 * 1000; // 10h
    this.snapshotInterval = null;
    this.lastSnapshotAt = 0;

    this.targetGuildId = process.env.CALL_RANKING_GUILD_ID || null;
    this.targetChannelId = process.env.CALL_RANKING_CHANNEL_ID || null;

    this.db = null;
    this.cache = {
      rankingMessageId: null,
    };
  }

  // =========================
  // FS / DB BASE
  // =========================
  ensureStorage() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  openDb() {
    this.ensureStorage();

    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve(this);
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }

  async initDbSchema() {
    await this.run(`
      CREATE TABLE IF NOT EXISTS call_users (
        user_id TEXT PRIMARY KEY,
        username TEXT,
        total_ms INTEGER NOT NULL DEFAULT 0
      )
    `);

    await this.run(`
      CREATE TABLE IF NOT EXISTS call_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    await this.run(`
      CREATE TABLE IF NOT EXISTS call_sessions (
        session_key TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        started_at INTEGER NOT NULL
      )
    `);
  }

  async getMeta(key) {
    const row = await this.get(`SELECT value FROM call_meta WHERE key = ?`, [key]);
    return row?.value ?? null;
  }

  async setMeta(key, value) {
    await this.run(
      `INSERT INTO call_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [String(key), value == null ? null : String(value)]
    );

    if (key === 'rankingMessageId') {
      this.cache.rankingMessageId = value == null ? null : String(value);
    }
  }

  // ✅ MÉTODO QUE ESTAVA FALTANDO
  async loadMeta() {
    this.cache.rankingMessageId = await this.getMeta('rankingMessageId');
  }

  // =========================
  // AUTO-IMPORT JSON -> SQLITE (1ª vez)
  // =========================
  readLegacyJsonSafe(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf8');
      const json = JSON.parse(raw);
      if (!json || typeof json !== 'object') return null;
      if (!json.users || typeof json.users !== 'object') json.users = {};
      if (!('rankingMessageId' in json)) json.rankingMessageId = null;
      return json;
    } catch (err) {
      console.warn(`[CallRanking] Falha ao ler JSON legado (${path.basename(filePath)}):`, err?.message || err);
      return null;
    }
  }

  async countUsersInDb() {
    const row = await this.get(`SELECT COUNT(*) AS count FROM call_users`);
    return Number(row?.count || 0);
  }

  async autoImportLegacyJsonIfNeeded() {
    const dbUserCount = await this.countUsersInDb();
    if (dbUserCount > 0) return; // banco já tem dados

    // tenta principal e depois backup
    const legacy =
      this.readLegacyJsonSafe(this.legacyJsonPath) ||
      this.readLegacyJsonSafe(this.legacyBackupJsonPath);

    if (!legacy) {
      console.log('[CallRanking] Nenhum JSON legado encontrado para importação automática.');
      return;
    }

    const users = legacy.users || {};
    const entries = Object.entries(users);

    if (entries.length === 0 && !legacy.rankingMessageId) {
      console.log('[CallRanking] JSON legado vazio, nada para importar.');
      return;
    }

    for (const [userId, info] of entries) {
      const username = info?.username || `ID ${userId}`;
      const totalMs = Number(info?.totalMs || 0);

      await this.run(
        `INSERT INTO call_users (user_id, username, total_ms)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, total_ms = excluded.total_ms`,
        [String(userId), username, totalMs]
      );
    }

    if (legacy.rankingMessageId) {
      await this.setMeta('rankingMessageId', String(legacy.rankingMessageId));
    }

    await this.setMeta('legacyJsonImportedAt', String(Date.now()));

    console.log(`[CallRanking] Importação automática concluída: ${entries.length} usuário(s) do JSON legado.`);
  }

  // =========================
  // SNAPSHOT JSON (backup/export)
  // =========================
  async exportCurrentDataAsJsonObject() {
    const usersRows = await this.all(`SELECT user_id, username, total_ms FROM call_users`);
    const users = {};

    for (const row of usersRows) {
      users[row.user_id] = {
        username: row.username || `ID ${row.user_id}`,
        totalMs: Number(row.total_ms || 0),
      };
    }

    return {
      users,
      rankingMessageId: this.cache.rankingMessageId || null,
    };
  }

  async createSnapshotBackup() {
    try {
      this.ensureStorage();

      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const filename = `call_ranking.snapshot.${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}.json`;
      const snapshotPath = path.join(this.dataDir, filename);

      const json = await this.exportCurrentDataAsJsonObject();
      fs.writeFileSync(snapshotPath, JSON.stringify(json, null, 2));
      this.lastSnapshotAt = Date.now();

      console.log(`[CallRanking] Snapshot criado: ${filename}`);

      this.cleanupOldSnapshots(10);
    } catch (err) {
      console.error('[CallRanking] Erro ao criar snapshot backup:', err);
    }
  }

  cleanupOldSnapshots(keep = 10) {
    try {
      const files = fs.readdirSync(this.dataDir)
        .filter(name => name.startsWith('call_ranking.snapshot.') && name.endsWith('.json'))
        .map(name => ({
          name,
          fullPath: path.join(this.dataDir, name),
          mtime: fs.statSync(path.join(this.dataDir, name)).mtimeMs
        }))
        .sort((a, b) => b.mtime - a.mtime);

      for (const file of files.slice(keep)) {
        fs.unlinkSync(file.fullPath);
        console.log(`[CallRanking] Snapshot antigo removido: ${file.name}`);
      }
    } catch (err) {
      console.warn('[CallRanking] Falha ao limpar snapshots antigos:', err?.message || err);
    }
  }

  // =========================
  // HELPERS
  // =========================
  key(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  formatMs(ms) {
    const sec = Math.floor((Number(ms) || 0) / 1000);
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);

    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  async touchUser(user) {
    if (!user || user.bot) return;

    await this.run(
      `INSERT INTO call_users (user_id, username, total_ms)
       VALUES (?, ?, 0)
       ON CONFLICT(user_id) DO UPDATE SET username = excluded.username`,
      [String(user.id), user.username]
    );
  }

  async getStoredTotalMs(userId) {
    const row = await this.get(`SELECT total_ms FROM call_users WHERE user_id = ?`, [String(userId)]);
    return Number(row?.total_ms || 0);
  }

  getLiveMs(userId) {
    let total = 0;
    for (const [k, startedAt] of this.activeSessions.entries()) {
      const [, uid] = k.split(':');
      if (uid === String(userId)) total += (Date.now() - startedAt);
    }
    return total;
  }

  async getTotalWithLiveMs(userId) {
    return (await this.getStoredTotalMs(userId)) + this.getLiveMs(userId);
  }

  // =========================
  // RANK MAP (dark anime)
  // =========================
  getCallRankMap() {
    return {
      10: 'Novato',
      20: 'Desperto',
      30: 'Vigilante',
      40: 'Executor',
      50: 'Tenente',
      60: 'Magnífico',
      70: 'Ceifador',
      80: 'Portador do Véu',
      90: 'Anbu',
      100: 'Magnata',
      200: 'Patriarca',
      300: 'Shogun',
      400: 'Imperador',
      500: 'Lenda',
      600: 'Soberano',
      700: 'Fantasma',
      800: 'O Escolhido',
      900: 'Yakuza Suprema',
      1000: 'Monarca das Calls'
    };
  }

  getCallMilestones() {
    return Object.keys(this.getCallRankMap()).map(Number).sort((a, b) => a - b);
  }

  getCallLevelRoleDataFromHours(hours) {
    if (hours < 10) return null;

    let reached = null;
    for (const h of this.getCallMilestones()) {
      if (hours >= h) reached = h;
      else break;
    }
    if (!reached) return null;

    return {
      milestone: reached,
      title: this.getCallRankMap()[reached]
    };
  }

  formatCallRoleName(hours, title) {
    const base = title || `${hours}h`;
    return `友𝅙𝅙﹒𝅙𝅙𑊑\`🪭\`ﾞ𝅙𝅙—ㅤ𝐃﹒${base}ㅤ﹑𝅙𝅙る`;
  }

  isCallLevelRoleName(roleName) {
    if (!roleName) return false;
    const rankMap = this.getCallRankMap();
    return Object.entries(rankMap).some(([h, title]) =>
      this.formatCallRoleName(Number(h), title) === roleName
    );
  }

  getCallRoleColor(hours) {
    const map = {
      10: 0x7f8c8d, 20: 0x3498db, 30: 0x5865f2, 40: 0x9b59b6, 50: 0xe91e63,
      60: 0x8e44ad, 70: 0xc0392b, 80: 0x2c3e50, 90: 0x16a085, 100: 0xf39c12,
      200: 0xd35400, 300: 0x8e44ad, 400: 0x2c3e50, 500: 0xf1c40f, 600: 0x1abc9c,
      700: 0x34495e, 800: 0xecf0f1, 900: 0xe74c3c, 1000: 0xffffff
    };
    return map[hours] || 0x99aab5;
  }

  async ensureCallRole(guild, roleName, hours) {
    let role = guild.roles.cache.find(r => r.name === roleName);
    const color = this.getCallRoleColor(hours);

    if (role) {
      if (role.color !== color) {
        await role.edit({ color, reason: 'Sincronizar cor do cargo de call' }).catch(() => {});
      }
      return role;
    }

    return guild.roles.create({
      name: roleName,
      color,
      reason: 'Cargo automático por horas em call'
    }).catch(() => null);
  }

  async updateMemberCallLevelRole(guild, userId) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member || member.user.bot) return;

    const totalMs = await this.getTotalWithLiveMs(userId);
    const hours = totalMs / 3600000;
    const roleData = this.getCallLevelRoleDataFromHours(hours);

    const currentCallRoles = member.roles.cache.filter(r => this.isCallLevelRoleName(r.name));

    if (!roleData) {
      if (currentCallRoles.size > 0) {
        await member.roles.remove(currentCallRoles).catch(() => {});
      }
      return;
    }

    const targetRoleName = this.formatCallRoleName(roleData.milestone, roleData.title);
    const targetRole = await this.ensureCallRole(guild, targetRoleName, roleData.milestone);
    if (!targetRole) return;

    const toRemove = currentCallRoles.filter(r => r.id !== targetRole.id);
    if (toRemove.size > 0) {
      await member.roles.remove(toRemove).catch(() => {});
    }

    if (!member.roles.cache.has(targetRole.id)) {
      await member.roles.add(targetRole, 'Cargo automático por horas em call').catch(() => {});
    }
  }

  async updateAllCallLevelRoles() {
    if (!this.targetGuildId) return;

    const guild = await this.client.guilds.fetch(this.targetGuildId).catch(() => null);
    if (!guild) return;

    const rows = await this.all(`SELECT user_id FROM call_users`);
    for (const row of rows) {
      try {
        await this.updateMemberCallLevelRole(guild, row.user_id);
      } catch (err) {
        console.error(`[CallRanking] Erro ao atualizar cargo de ${row.user_id}:`, err);
      }
    }
  }

  // =========================
  // SESSÕES DE CALL (persistidas)
  // =========================
  async startSession(guildId, userId) {
    const k = this.key(guildId, userId);
    if (this.activeSessions.has(k)) return;

    const now = Date.now();
    this.activeSessions.set(k, now);

    await this.run(
      `INSERT INTO call_sessions (session_key, guild_id, user_id, started_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_key) DO UPDATE SET started_at = excluded.started_at`,
      [k, String(guildId), String(userId), now]
    );
  }

  async stopSession(guildId, userId) {
    const k = this.key(guildId, userId);
    const startedAt = this.activeSessions.get(k);
    if (!startedAt) return;

    this.activeSessions.delete(k);
    const elapsed = Math.max(0, Date.now() - startedAt);

    // soma no total_ms preservando username atual se existir
    const existing = await this.get(`SELECT username FROM call_users WHERE user_id = ?`, [String(userId)]);
    const username = existing?.username || `ID ${userId}`;

    await this.run(
      `INSERT INTO call_users (user_id, username, total_ms)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET total_ms = total_ms + excluded.total_ms`,
      [String(userId), username, elapsed]
    );

    await this.run(`DELETE FROM call_sessions WHERE session_key = ?`, [k]);
  }

  async restoreActiveSessionsFromDb() {
    const rows = await this.all(`SELECT session_key, started_at FROM call_sessions`);
    for (const row of rows) {
      this.activeSessions.set(row.session_key, Number(row.started_at));
    }
  }

  async handleVoiceStateUpdate(oldState, newState) {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    const guildId = newState.guild?.id || oldState.guild?.id;
    const userId = member.id;
    if (!guildId || !userId) return;

    const wasIn = !!oldState.channelId;
    const isIn = !!newState.channelId;

    await this.touchUser(member.user);

    if (!wasIn && isIn) {
      await this.startSession(guildId, userId);
      return;
    }

    if (wasIn && !isIn) {
      await this.stopSession(guildId, userId);
      return;
    }

    // trocou de canal ou mudou estado -> mantém sessão sem reset
  }

  // =========================
  // EMBED / RANKING
  // =========================
  async buildEmbed(guild) {
    const rows = await this.all(`SELECT user_id, total_ms FROM call_users`);

    const ranking = rows.map(row => ({
      userId: row.user_id,
      totalMs: Number(row.total_ms || 0) + this.getLiveMs(row.user_id),
    }))
    .sort((a, b) => b.totalMs - a.totalMs);

    const top = ranking.slice(0, 15);

    const lines = top.length
      ? top.map((u, i) => {
          const pos =
            i === 0 ? '🥇' :
            i === 1 ? '🥈' :
            i === 2 ? '🥉' :
            `\`${String(i + 1).padStart(2, '0')}\``;

          return `${pos} <@${u.userId}> — **${this.formatMs(u.totalMs)}**`;
        }).join('\n')
      : 'Ninguém entrou em call ainda.';

    const onlineNow = [...this.activeSessions.keys()]
      .filter(k => k.startsWith(`${guild.id}:`)).length;

    const lastUpdate = new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    return new EmbedBuilder()
      .setTitle('📞 Ranking de Horas em Call')
      .setColor('#0099ff')
      .setDescription(`### 🏆 Top membros em call\n\n${lines}`)
      .addFields(
        { name: '👥 Em call agora', value: `**${onlineNow}** membro(s)`, inline: true },
        { name: '🔄 Atualização', value: 'A cada **5 minutos**', inline: true },
        { name: '🕒 Última atualização', value: lastUpdate, inline: false }
      )
      .setFooter({ text: 'Desenvolvido por Lynn' })
      .setTimestamp();
  }

  // =========================
  // MENSAGEM DO RANKING
  // =========================
  async updateRankingMessage() {
    if (!this.targetGuildId || !this.targetChannelId) return;

    const guild = await this.client.guilds.fetch(this.targetGuildId).catch(() => null);
    if (!guild) return;

    const channel = await guild.channels.fetch(this.targetChannelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) return;

    const embed = await this.buildEmbed(guild);

    let msg = null;
    if (this.cache.rankingMessageId) {
      msg = await channel.messages.fetch(this.cache.rankingMessageId).catch(() => null);
    }

    if (msg) {
      await msg.edit({ embeds: [embed] }).catch(err => {
        console.error('[CallRanking] Erro ao editar mensagem:', err);
      });
    } else {
      const newMsg = await channel.send({ embeds: [embed] }).catch(err => {
        console.error('[CallRanking] Erro ao enviar mensagem:', err);
        return null;
      });

      if (newMsg) {
        await this.setMeta('rankingMessageId', newMsg.id);
      }
    }

    await this.updateAllCallLevelRoles().catch(err => {
      console.error('[CallRanking] Erro ao sincronizar cargos de call:', err);
    });
  }

  // =========================
  // INIT
  // =========================
  async init() {
    this.ensureStorage();

    await this.openDb();
    await this.initDbSchema();
    await this.autoImportLegacyJsonIfNeeded();
    await this.loadMeta(); // ✅ agora existe
    await this.restoreActiveSessionsFromDb();

    // Captura membros já em call ao ligar
    for (const guild of this.client.guilds.cache.values()) {
      for (const voiceState of guild.voiceStates.cache.values()) {
        if (voiceState.channelId && voiceState.member && !voiceState.member.user.bot) {
          await this.touchUser(voiceState.member.user);

          const k = this.key(guild.id, voiceState.id);
          if (!this.activeSessions.has(k)) {
            await this.startSession(guild.id, voiceState.id);
          }
        }
      }
    }

    await this.updateRankingMessage().catch(err => {
      console.error('[CallRanking] Erro na atualização inicial:', err);
    });

    await this.createSnapshotBackup();

    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => {
      this.updateRankingMessage().catch(err => {
        console.error('[CallRanking] Erro na atualização periódica:', err);
      });
    }, this.updateIntervalMs);

    if (this.snapshotInterval) clearInterval(this.snapshotInterval);
    this.snapshotInterval = setInterval(() => {
      this.createSnapshotBackup().catch?.(() => {});
    }, this.snapshotBackupIntervalMs);
  }
}

module.exports = CallRankingManager;
