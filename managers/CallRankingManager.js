const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { EmbedBuilder } = require("discord.js");

class CallRankingManager {
  constructor(client) {
    this.client = client;

    // ✅ Agora o banco é Neon/Postgres
    this.databaseUrl = process.env.DATABASE_URL || null;
    this.pool = null;

    // (Opcional) snapshots em JSON local — útil se você roda no PC/VPS.
    // Em Railway, arquivos podem não persistir; Neon já é a persistência real.
    this.dataDir = path.join(__dirname, "..", "data");

    this.activeSessions = new Map(); // session_key(guild:user) => startedAt
    this.updateIntervalMs = 5 * 60 * 1000; // 5 min

    this.snapshotBackupIntervalMs = 10 * 60 * 60 * 1000; // 10h
    this.snapshotInterval = null;
    this.lastSnapshotAt = 0;

    this.interval = null;

    // ✅ Ranking SOMENTE na Yakuza (fixo) e SEMPRE edita a mesma msg
    this.targetGuildId = process.env.CALL_RANKING_GUILD_ID || null;
    this.targetChannelId = process.env.CALL_RANKING_CHANNEL_ID || null;
    this.targetMessageId = process.env.CALL_RANKING_MESSAGE_ID || null;
  }

  // =========================
  // FS (opcional: snapshots)
  // =========================
  ensureStorage() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  // =========================
  // DB helpers (Postgres)
  // =========================
  async query(sql, params = []) {
    return this.pool.query(sql, params);
  }

  async initDbSchema() {
    // ✅ totals por guild + user (NUNCA mistura servidores)
    await this.query(`
      CREATE TABLE IF NOT EXISTS call_users (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT,
        total_ms BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS call_sessions (
        session_key TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        started_at BIGINT NOT NULL
      )
    `);

    await this.query(`CREATE INDEX IF NOT EXISTS idx_call_users_guild ON call_users (guild_id)`);
    await this.query(`CREATE INDEX IF NOT EXISTS idx_call_sessions_guild ON call_sessions (guild_id)`);
  }

  // =========================
  // TRACK RULES (permite seu bot)
  // =========================
  isTrackableUser(user) {
    if (!user) return false;

    // ✅ Permite o próprio bot
    if (this.client?.user && user.id === this.client.user.id) return true;

    // ❌ Ignora outros bots
    if (user.bot) return false;

    return true;
  }

  // =========================
  // HELPERS
  // =========================
  key(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  formatMs(ms) {
    const totalMinutes = Math.floor((Number(ms) || 0) / 1000 / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  // =========================
  // USERS / TOTALS (por guild)
  // =========================
  async touchUser(guildId, user) {
    if (!this.isTrackableUser(user)) return;

    await this.query(
      `
      INSERT INTO call_users (guild_id, user_id, username, total_ms)
      VALUES ($1, $2, $3, 0)
      ON CONFLICT (guild_id, user_id)
      DO UPDATE SET username = EXCLUDED.username
      `,
      [String(guildId), String(user.id), user.username]
    );
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

  // =========================
  // SESSÕES
  // =========================
  async startSession(guildId, userId) {
    const k = this.key(guildId, userId);
    if (this.activeSessions.has(k)) return;

    const now = Date.now();
    this.activeSessions.set(k, now);

    await this.query(
      `
      INSERT INTO call_sessions (session_key, guild_id, user_id, started_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (session_key)
      DO UPDATE SET started_at = EXCLUDED.started_at
      `,
      [k, String(guildId), String(userId), now]
    );
  }

  async stopSession(guildId, userId) {
    const k = this.key(guildId, userId);
    const startedAt = this.activeSessions.get(k);
    if (!startedAt) return;

    this.activeSessions.delete(k);

    const elapsed = Math.max(0, Date.now() - startedAt);

    // pega username guardado (se existir)
    const existing = await this.query(
      `SELECT username FROM call_users WHERE guild_id = $1 AND user_id = $2`,
      [String(guildId), String(userId)]
    );
    const username = existing.rows?.[0]?.username || `ID ${userId}`;

    await this.query(
      `
      INSERT INTO call_users (guild_id, user_id, username, total_ms)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (guild_id, user_id)
      DO UPDATE SET total_ms = call_users.total_ms + EXCLUDED.total_ms,
                    username = EXCLUDED.username
      `,
      [String(guildId), String(userId), username, elapsed]
    );

    await this.query(`DELETE FROM call_sessions WHERE session_key = $1`, [k]);
  }

  async restoreActiveSessionsFromDb() {
    const res = await this.query(`SELECT session_key, started_at FROM call_sessions`);
    for (const row of res.rows) {
      this.activeSessions.set(String(row.session_key), Number(row.started_at));
    }
  }

  async handleVoiceStateUpdate(oldState, newState) {
    const member = newState.member || oldState.member;
    if (!member || !this.isTrackableUser(member.user)) return;

    const guildId = newState.guild?.id || oldState.guild?.id;
    const userId = member.id;
    if (!guildId || !userId) return;

    const wasIn = !!oldState.channelId;
    const isIn = !!newState.channelId;

    await this.touchUser(guildId, member.user);

    if (!wasIn && isIn) return this.startSession(guildId, userId);
    if (wasIn && !isIn) return this.stopSession(guildId, userId);
  }

  // =========================
  // EMBED (SOMENTE YAKUZA)
  // =========================
  async buildEmbedForGuild(guild) {
    const res = await this.query(
      `SELECT user_id, total_ms FROM call_users WHERE guild_id = $1`,
      [String(guild.id)]
    );

    const ranking = res.rows
      .map((row) => ({
        userId: String(row.user_id),
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
      .setTitle("📞 Ranking de Horas em Call — Yakuza")
      .setColor("#0099ff")
      .setDescription(`### 🏆 Top membros em call\n\n${lines}`)
      .addFields(
        { name: "👥 Em call agora (Yakuza)", value: `**${onlineNow}** membro(s)`, inline: true },
        { name: "🔄 Atualização", value: "A cada **5 minutos**", inline: true },
        { name: "🕒 Última atualização", value: lastUpdate, inline: false }
      )
      .setFooter({ text: "Desenvolvido por Lynn" })
      .setTimestamp();
  }

  // =========================
  // UPDATE FIXO: SEMPRE EDITA A MESMA MENSAGEM
  // =========================
  async updateRankingMessage() {
    if (!this.targetGuildId || !this.targetChannelId || !this.targetMessageId) return;

    const guild = await this.client.guilds.fetch(String(this.targetGuildId)).catch(() => null);
    if (!guild) return;

    const channel = await guild.channels.fetch(String(this.targetChannelId)).catch(() => null);
    if (!channel || !channel.isTextBased?.()) return;

    const msg = await channel.messages.fetch(String(this.targetMessageId)).catch(() => null);
    if (!msg) {
      console.error(
        `[CallRanking] Não consegui buscar a mensagem fixa ${this.targetMessageId} no canal ${this.targetChannelId}. ` +
        `Verifique: ID correto e permissão "Read Message History".`
      );
      return;
    }

    const embed = await this.buildEmbedForGuild(guild);

    await msg.edit({ embeds: [embed] }).catch((err) => {
      console.error("[CallRanking] Erro ao editar mensagem fixa:", err);
    });
  }

  // =========================
  // SNAPSHOT (opcional)
  // =========================
  async exportCurrentDataAsJsonObject() {
    const res = await this.query(`SELECT guild_id, user_id, username, total_ms FROM call_users`);
    const usersByGuild = {};

    for (const row of res.rows) {
      const gid = String(row.guild_id);
      if (!usersByGuild[gid]) usersByGuild[gid] = {};
      usersByGuild[gid][row.user_id] = {
        username: row.username || `ID ${row.user_id}`,
        totalMs: Number(row.total_ms || 0),
      };
    }

    return {
      usersByGuild,
      rankingTarget: {
        guildId: this.targetGuildId,
        channelId: this.targetChannelId,
        messageId: this.targetMessageId,
      },
    };
  }

  async createSnapshotBackup() {
    try {
      // Em Railway isso pode não persistir; Neon já é persistência.
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
      if (!fs.existsSync(this.dataDir)) return;

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

  // =========================
  // INIT
  // =========================
  async init() {
    if (!this.databaseUrl) {
      console.error("❌ [CallRanking] DATABASE_URL não definida. Configure no Railway Variables (Neon).");
      return;
    }

    // Neon exige SSL; normalmente sslmode=require já vem na URL.
    this.pool = new Pool({ connectionString: this.databaseUrl });

    // teste de conexão
    await this.query("SELECT 1");

    await this.initDbSchema();
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

    // update inicial (edita a msg fixa)
    await this.updateRankingMessage().catch((err) => {
      console.error("[CallRanking] Erro na atualização inicial:", err);
    });

    // snapshot inicial (opcional)
    await this.createSnapshotBackup();

    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => {
      this.updateRankingMessage().catch((err) => {
        console.error("[CallRanking] Erro na atualização periódica:", err);
      });
    }, this.updateIntervalMs);

    if (this.snapshotInterval) clearInterval(this.snapshotInterval);
    this.snapshotInterval = setInterval(() => {
      this.createSnapshotBackup().catch?.(() => {});
    }, this.snapshotBackupIntervalMs);

    console.log("✅ [CallRanking] Conectado no Neon/Postgres e rodando (ranking só na Yakuza).");
  }
}

module.exports = CallRankingManager;
