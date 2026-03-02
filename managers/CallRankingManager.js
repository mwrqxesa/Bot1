const fs = require("node:fs");
const path = require("node:path");
const { EmbedBuilder } = require("discord.js");
const sqlite3 = require("sqlite3").verbose();

class CallRankingManager {
  constructor(client) {
    this.client = client;

    this.dataDir = path.join(__dirname, "..", "data");
    this.dbPath = path.join(this.dataDir, "call_ranking.sqlite");

    this.legacyJsonPath = path.join(this.dataDir, "call_ranking.json");
    this.legacyBackupJsonPath = path.join(this.dataDir, "call_ranking.backup.json");

    this.activeSessions = new Map(); // session_key(guild:user) => startedAt
    this.updateIntervalMs = 5 * 60 * 1000; // 5 min
    this.snapshotBackupIntervalMs = 10 * 60 * 60 * 1000; // 10h

    this.interval = null;
    this.snapshotInterval = null;
    this.lastSnapshotAt = 0;

    this.db = null;

    // cache local (carregado via meta)
    this.cache = {
      rankingMessageIds: new Map(), // guildId -> messageId
    };
  }

  // =========================
  // FS / DB
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
    // call_users agora é por guild
    await this.run(`
      CREATE TABLE IF NOT EXISTS call_users (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT,
        total_ms INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
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

    // Índices úteis
    await this.run(`CREATE INDEX IF NOT EXISTS idx_call_users_guild ON call_users (guild_id)`);
    await this.run(`CREATE INDEX IF NOT EXISTS idx_call_sessions_guild ON call_sessions (guild_id)`);
  }

  // =========================
  // META
  // =========================
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
  }

  metaKeyRankingMessageId(guildId) {
    return `rankingMessageId:${guildId}`;
  }

  async loadMetaForGuild(guildId) {
    const msgId = await this.getMeta(this.metaKeyRankingMessageId(guildId));
    if (msgId) this.cache.rankingMessageIds.set(String(guildId), String(msgId));
  }

  async setRankingMessageId(guildId, messageId) {
    const gid = String(guildId);
    const mid = messageId == null ? null : String(messageId);

    await this.setMeta(this.metaKeyRankingMessageId(gid), mid);
    if (mid) this.cache.rankingMessageIds.set(gid, mid);
    else this.cache.rankingMessageIds.delete(gid);
  }

  // =========================
  // TRACK RULES (permite seu bot)
  // =========================
  isTrackableUser(user) {
    if (!user) return false;

    // ✅ Permite o próprio bot (pra contar horas dele também, se quiser)
    if (this.client?.user && user.id === this.client.user.id) return true;

    // ❌ Ignora outros bots
    if (user.bot) return false;

    return true;
  }

  // =========================
  // TARGETS (onde postar ranking)
  // =========================
  parseTargetsFromEnv() {
    // Recomendado: JSON
    const raw = process.env.CALL_RANKING_TARGETS;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((x) => x && x.guildId && x.channelId)
            .map((x) => ({
              guildId: String(x.guildId),
              channelId: String(x.channelId),
            }));
        }
      } catch (e) {
        console.warn("[CallRanking] CALL_RANKING_TARGETS inválido (JSON). Ignorando.");
      }
    }

    // Fallback: 1 guild
    const gid = process.env.CALL_RANKING_GUILD_ID;
    const cid = process.env.CALL_RANKING_CHANNEL_ID;
    if (gid && cid) {
      return [{ guildId: String(gid), channelId: String(cid) }];
    }

    return [];
  }

  getTargets() {
    // Você pode também puxar do GuildSettingsManager se quiser,
    // mas como você já usa env, vamos manter simples e determinístico.
    return this.parseTargetsFromEnv();
  }

  // =========================
  // HELPERS
  // =========================
  key(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  // ✅ somente horas e minutos
  formatMs(ms) {
    const totalMinutes = Math.floor((Number(ms) || 0) / 1000 / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  // =========================
  // USERS / TOTALS (por guild)
  // =========================
  async touchUser(guildId, user) {
    if (!this.isTrackableUser(user)) return;

    await this.run(
      `INSERT INTO call_users (guild_id, user_id, username, total_ms)
       VALUES (?, ?, ?, 0)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET username = excluded.username`,
      [String(guildId), String(user.id), user.username]
    );
  }

  async getStoredTotalMs(guildId, userId) {
    const row = await this.get(
      `SELECT total_ms FROM call_users WHERE guild_id = ? AND user_id = ?`,
      [String(guildId), String(userId)]
    );
    return Number(row?.total_ms || 0);
  }

  getLiveMs(guildId, userId) {
    let total = 0;
    const prefix = `${String(guildId)}:`;
    const uid = String(userId);

    for (const [k, startedAt] of this.activeSessions.entries()) {
      if (!k.startsWith(prefix)) continue;
      const [, kUserId] = k.split(":");
      if (kUserId === uid) total += Date.now() - startedAt;
    }

    return total;
  }

  async getTotalWithLiveMs(guildId, userId) {
    return (await this.getStoredTotalMs(guildId, userId)) + this.getLiveMs(guildId, userId);
  }

  // =========================
  // CARGOS AUTOMÁTICOS
  // (se você quiser só na Yakuza, coloque target só na Yakuza)
  // =========================
  getCallRankMap() {
    return {
      10: "Novato",
      20: "Desperto",
      30: "Vigilante",
      40: "Executor",
      50: "Tenente",
      60: "Magnífico",
      70: "Ceifador",
      80: "Portador do Véu",
      90: "Anbu",
      100: "Magnata",
      200: "Patriarca",
      300: "Shogun",
      400: "Imperador",
      500: "Lenda",
      600: "Soberano",
      700: "Fantasma",
      800: "O Escolhido",
      900: "Yakuza Suprema",
      1000: "Monarca das Calls",
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
      title: this.getCallRankMap()[reached],
    };
  }

  formatCallRoleName(hours, title) {
    const base = title || `${hours}h`;
    return `友𝅙𝅙﹒𝅙𝅙𑊑\`🪭\`ﾞ𝅙𝅙—ㅤ𝐃﹒${base}ㅤ﹑𝅙𝅙る`;
  }

  isCallLevelRoleName(roleName) {
    if (!roleName) return false;

    const rankMap = this.getCallRankMap();
    return Object.entries(rankMap).some(([h, title]) => this.formatCallRoleName(Number(h), title) === roleName);
  }

  getCallRoleColor(hours) {
    const map = {
      10: 0x7f8c8d, 20: 0x3498db, 30: 0x5865f2, 40: 0x9b59b6, 50: 0xe91e63,
      60: 0x8e44ad, 70: 0xc0392b, 80: 0x2c3e50, 90: 0x16a085, 100: 0xf39c12,
      200: 0xd35400, 300: 0x8e44ad, 400: 0x2c3e50, 500: 0xf1c40f, 600: 0x1abc9c,
      700: 0x34495e, 800: 0xecf0f1, 900: 0xe74c3c, 1000: 0xffffff,
    };

    return map[hours] || 0x99aab5;
  }

  async ensureCallRole(guild, roleName, hours) {
    let role = guild.roles.cache.find((r) => r.name === roleName);
    const color = this.getCallRoleColor(hours);

    if (role) {
      if (role.color !== color) {
        await role.edit({ color, reason: "Sincronizar cor do cargo de call" }).catch(() => {});
      }
      return role;
    }

    return guild.roles
      .create({
        name: roleName,
        color,
        reason: "Cargo automático por horas em call",
      })
      .catch(() => null);
  }

  async updateMemberCallLevelRole(guild, userId) {
    const member = await guild.members.fetch(userId).catch(() => null);

    // ✅ permite o próprio bot
    if (!member || !this.isTrackableUser(member.user)) return;

    const totalMs = await this.getTotalWithLiveMs(guild.id, userId);
    const hours = totalMs / 3600000;
    const roleData = this.getCallLevelRoleDataFromHours(hours);

    const currentCallRoles = member.roles.cache.filter((r) => this.isCallLevelRoleName(r.name));

    if (!roleData) {
      if (currentCallRoles.size > 0) await member.roles.remove(currentCallRoles).catch(() => {});
      return;
    }

    const targetRoleName = this.formatCallRoleName(roleData.milestone, roleData.title);
    const targetRole = await this.ensureCallRole(guild, targetRoleName, roleData.milestone);
    if (!targetRole) return;

    const toRemove = currentCallRoles.filter((r) => r.id !== targetRole.id);
    if (toRemove.size > 0) await member.roles.remove(toRemove).catch(() => {});

    if (!member.roles.cache.has(targetRole.id)) {
      await member.roles.add(targetRole, "Cargo automático por horas em call").catch(() => {});
    }
  }

  async updateAllCallLevelRolesForGuild(guildId) {
    const guild = await this.client.guilds.fetch(String(guildId)).catch(() => null);
    if (!guild) return;

    const rows = await this.all(`SELECT user_id FROM call_users WHERE guild_id = ?`, [String(guildId)]);
    for (const row of rows) {
      try {
        await this.updateMemberCallLevelRole(guild, row.user_id);
      } catch (err) {
        console.error(`[CallRanking] Erro ao atualizar cargo de ${row.user_id} em ${guildId}:`, err);
      }
    }
  }

  // =========================
  // SESSÕES DE CALL
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

    const existing = await this.get(
      `SELECT username FROM call_users WHERE guild_id = ? AND user_id = ?`,
      [String(guildId), String(userId)]
    );
    const username = existing?.username || `ID ${userId}`;

    await this.run(
      `INSERT INTO call_users (guild_id, user_id, username, total_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id) DO UPDATE SET total_ms = total_ms + excluded.total_ms`,
      [String(guildId), String(userId), username, elapsed]
    );

    await this.run(`DELETE FROM call_sessions WHERE session_key = ?`, [k]);
  }

  async restoreActiveSessionsFromDb() {
    const rows = await this.all(`SELECT session_key, started_at FROM call_sessions`);
    for (const row of rows) {
      this.activeSessions.set(String(row.session_key), Number(row.started_at));
    }
  }

  async handleVoiceStateUpdate(oldState, newState) {
    const member = newState.member || oldState.member;

    // ✅ seu bot conta; outros bots não
    if (!member || !this.isTrackableUser(member.user)) return;

    const guildId = newState.guild?.id || oldState.guild?.id;
    const userId = member.id;
    if (!guildId || !userId) return;

    const wasIn = !!oldState.channelId;
    const isIn = !!newState.channelId;

    await this.touchUser(guildId, member.user);

    if (!wasIn && isIn) {
      await this.startSession(guildId, userId);
      return;
    }

    if (wasIn && !isIn) {
      await this.stopSession(guildId, userId);
      return;
    }

    // troca de canal / mute / deaf -> mantém sessão
  }

  // =========================
  // EMBED / RANKING (por guild)
  // =========================
  async buildEmbed(guild) {
    const rows = await this.all(
      `SELECT user_id, total_ms FROM call_users WHERE guild_id = ?`,
      [String(guild.id)]
    );

    const ranking = rows
      .map((row) => ({
        userId: row.user_id,
        totalMs: Number(row.total_ms || 0) + this.getLiveMs(guild.id, row.user_id),
      }))
      .sort((a, b) => b.totalMs - a.totalMs);

    const top = ranking.slice(0, 15);

    const lines = top.length
      ? top
          .map((u, i) => {
            const pos =
              i === 0 ? "🥇" :
              i === 1 ? "🥈" :
              i === 2 ? "🥉" :
              `\`${String(i + 1).padStart(2, "0")}\``;

            return `${pos} <@${u.userId}> — **${this.formatMs(u.totalMs)}**`;
          })
          .join("\n")
      : "Ninguém entrou em call ainda.";

    const onlineNow = [...this.activeSessions.keys()].filter((k) => k.startsWith(`${guild.id}:`)).length;

    const lastUpdate = new Date().toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    return new EmbedBuilder()
      .setTitle("📞 Ranking de Horas em Call")
      .setColor("#0099ff")
      .setDescription(`### 🏆 Top membros em call\n\n${lines}`)
      .addFields(
        { name: "👥 Em call agora", value: `**${onlineNow}** membro(s)`, inline: true },
        { name: "🔄 Atualização", value: "A cada **5 minutos**", inline: true },
        { name: "🕒 Última atualização", value: lastUpdate, inline: false }
      )
      .setFooter({ text: "Desenvolvido por Lynn" })
      .setTimestamp();
  }

  // =========================
  // MENSAGEM DO RANKING (por guild)
  // =========================
  async updateRankingMessageForTarget(target) {
    const guildId = String(target.guildId);
    const channelId = String(target.channelId);

    const guild = await this.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) return;

    const embed = await this.buildEmbed(guild);

    // garante que a meta desta guild esteja carregada
    if (!this.cache.rankingMessageIds.has(guildId)) {
      await this.loadMetaForGuild(guildId);
    }

    const storedMsgId = this.cache.rankingMessageIds.get(guildId) || null;

    let msg = null;
    if (storedMsgId) {
      // Se faltar "Read Message History", aqui pode falhar e você vai reenviar toda vez.
      msg = await channel.messages.fetch(storedMsgId).catch(() => null);
    }

    if (msg) {
      await msg.edit({ embeds: [embed] }).catch((err) => {
        console.error(`[CallRanking] Erro ao editar mensagem (${guildId}):`, err);
      });
      return;
    }

    // Se não encontrou a msg antiga (apagada, permissão, id errado) -> envia nova e salva
    const newMsg = await channel.send({ embeds: [embed] }).catch((err) => {
      console.error(`[CallRanking] Erro ao enviar mensagem (${guildId}):`, err);
      return null;
    });

    if (newMsg) {
      await this.setRankingMessageId(guildId, newMsg.id);
    }
  }

  async updateRankingMessages() {
    const targets = this.getTargets();
    if (!targets.length) return;

    for (const t of targets) {
      await this.updateRankingMessageForTarget(t);
      // cargos por guild (só onde você posta ranking)
      await this.updateAllCallLevelRolesForGuild(t.guildId).catch((err) => {
        console.error(`[CallRanking] Erro ao sincronizar cargos em ${t.guildId}:`, err);
      });
    }
  }

  // =========================
  // SNAPSHOT / BACKUP
  // =========================
  async exportCurrentDataAsJsonObject() {
    const rows = await this.all(`SELECT guild_id, user_id, username, total_ms FROM call_users`);
    const usersByGuild = {};

    for (const row of rows) {
      const gid = String(row.guild_id);
      if (!usersByGuild[gid]) usersByGuild[gid] = {};
      usersByGuild[gid][row.user_id] = {
        username: row.username || `ID ${row.user_id}`,
        totalMs: Number(row.total_ms || 0),
      };
    }

    // salva também messageIds por guild
    const rankingMessageIds = {};
    for (const [gid, mid] of this.cache.rankingMessageIds.entries()) {
      rankingMessageIds[gid] = mid;
    }

    return { usersByGuild, rankingMessageIds };
  }

  async createSnapshotBackup() {
    try {
      this.ensureStorage();

      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const filename = `call_ranking.snapshot.${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}.json`;
      const snapshotPath = path.join(this.dataDir, filename);

      const json = await this.exportCurrentDataAsJsonObject();
      fs.writeFileSync(snapshotPath, JSON.stringify(json, null, 2));

      this.lastSnapshotAt = Date.now();
      console.log(`[CallRanking] Snapshot criado: ${filename}`);

      this.cleanupOldSnapshots(10);
    } catch (err) {
      console.error("[CallRanking] Erro ao criar snapshot backup:", err);
    }
  }

  cleanupOldSnapshots(keep = 10) {
    try {
      const files = fs
        .readdirSync(this.dataDir)
        .filter((name) => name.startsWith("call_ranking.snapshot.") && name.endsWith(".json"))
        .map((name) => ({
          name,
          fullPath: path.join(this.dataDir, name),
          mtime: fs.statSync(path.join(this.dataDir, name)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime);

      for (const file of files.slice(keep)) {
        fs.unlinkSync(file.fullPath);
        console.log(`[CallRanking] Snapshot antigo removido: ${file.name}`);
      }
    } catch (err) {
      console.warn("[CallRanking] Falha ao limpar snapshots antigos:", err?.message || err);
    }
  }

  async createManualBackupPayload() {
    const data = await this.exportCurrentDataAsJsonObject();
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");

    const fileName = `call_ranking_backup_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}.json`;

    return {
      fileName,
      buffer: Buffer.from(JSON.stringify(data, null, 2), "utf8"),
      data,
    };
  }

  // =========================
  // IMPORT LEGADO (opcional)
  // =========================
  readLegacyJsonSafe(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, "utf8");
      const json = JSON.parse(raw);
      if (!json || typeof json !== "object") return null;
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

  /**
   * AVISO: o legado não tem guild_id, então não dá pra separar Cave vs Yakuza.
   * Se você tiver que importar, ele vai colocar tudo em UM guild escolhido.
   * Para evitar sujeira, o recomendado é NÃO importar e começar “limpo”.
   */
  async autoImportLegacyJsonIfNeeded() {
    const dbUserCount = await this.countUsersInDb();
    if (dbUserCount > 0) return;

    const legacy =
      this.readLegacyJsonSafe(this.legacyJsonPath) ||
      this.readLegacyJsonSafe(this.legacyBackupJsonPath);

    if (!legacy) return;

    // Se existir, escolhe o primeiro target como destino
    const targets = this.getTargets();
    const defaultGuildId = targets?.[0]?.guildId || null;

    if (!defaultGuildId) {
      console.warn("[CallRanking] Existe JSON legado, mas não há CALL_RANKING_TARGETS/IDs definidos. Ignorando import.");
      return;
    }

    const entries = Object.entries(legacy.users || {});
    if (!entries.length) return;

    for (const [userId, info] of entries) {
      const username = info?.username || `ID ${userId}`;
      const totalMs = Number(info?.totalMs || 0);

      await this.run(
        `INSERT INTO call_users (guild_id, user_id, username, total_ms)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(guild_id, user_id) DO UPDATE SET username = excluded.username, total_ms = excluded.total_ms`,
        [String(defaultGuildId), String(userId), username, totalMs]
      );
    }

    await this.setMeta("legacyJsonImportedAt", String(Date.now()));
    console.log(`[CallRanking] Import legado concluído (${entries.length} usuários) => guild ${defaultGuildId}.`);
  }

  // =========================
  // INIT
  // =========================
  async init() {
    this.ensureStorage();

    await this.openDb();
    await this.initDbSchema();

    // (opcional) import legado
    await this.autoImportLegacyJsonIfNeeded();

    // restaura sessões ativas do db
    await this.restoreActiveSessionsFromDb();

    // captura quem já está em call ao ligar
    for (const guild of this.client.guilds.cache.values()) {
      for (const voiceState of guild.voiceStates.cache.values()) {
        if (!voiceState.channelId || !voiceState.member) continue;
        if (!this.isTrackableUser(voiceState.member.user)) continue;

        await this.touchUser(guild.id, voiceState.member.user);

        const k = this.key(guild.id, voiceState.id);
        if (!this.activeSessions.has(k)) {
          await this.startSession(guild.id, voiceState.id);
        }
      }
    }

    // atualização inicial
    await this.updateRankingMessages().catch((err) => {
      console.error("[CallRanking] Erro na atualização inicial:", err);
    });

    // snapshot inicial
    await this.createSnapshotBackup();

    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => {
      this.updateRankingMessages().catch((err) => {
        console.error("[CallRanking] Erro na atualização periódica:", err);
      });
    }, this.updateIntervalMs);

    if (this.snapshotInterval) clearInterval(this.snapshotInterval);
    this.snapshotInterval = setInterval(() => {
      this.createSnapshotBackup().catch?.(() => {});
    }, this.snapshotBackupIntervalMs);
  }
}

module.exports = CallRankingManager;
