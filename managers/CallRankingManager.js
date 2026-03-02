const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { EmbedBuilder } = require("discord.js");

class CallRankingManager {
  constructor(client) {
    this.client = client;

    // ====== DB / NEON ======
    this.databaseUrl = process.env.DATABASE_URL || null;
    this.pool = null;

    // ====== RANKING FIXO (YAKUZA) ======
    this.targetGuildId = process.env.CALL_RANKING_GUILD_ID || "1476212383109087304";
    this.targetChannelId = process.env.CALL_RANKING_CHANNEL_ID || null; // precisa ser o CANAL correto
    this.targetMessageId = process.env.CALL_RANKING_MESSAGE_ID || "1477465092470608015";

    // ====== FILTROS ======
    // remover TOP7 (da Cave que foi parar na base) + remover bot da yakuza do ranking
    this.excludedUserIds = new Set([
      "1098636834680094821", // TOP 7 (Cave)
      "1237058787093905510", // bot da Yakuza (não mostrar no ranking)
    ]);

    // ====== INTERVALOS ======
    this.updateIntervalMs = 5 * 60 * 1000;
    this.snapshotBackupIntervalMs = 10 * 60 * 60 * 1000;

    // ====== STATE ======
    this.activeSessions = new Map(); // "guild:user" => startedAt(ms)
    this.interval = null;
    this.snapshotInterval = null;
    this.enabled = false;

    // snapshots locais (opcional)
    this.dataDir = path.join(__dirname, "..", "data");
  }

  // =========================
  // Storage (snapshots)
  // =========================
  ensureStorage() {
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
  }

  // =========================
  // DB
  // =========================
  async connectDb() {
    if (!this.databaseUrl) {
      console.error("❌ [CallRanking] DATABASE_URL não definida.");
      return false;
    }

    this.pool = new Pool({
      connectionString: this.databaseUrl,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    });

    await this.pool.query("SELECT 1");
    return true;
  }

  async query(sql, params = []) {
    if (!this.pool) throw new Error("DB pool not initialized");
    return this.pool.query(sql, params);
  }

  async initDbSchema() {
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
  // Track rules
  // =========================
  isTrackableUser(user) {
    if (!user) return false;
    if (user.bot) return false; // ignora bots
    return true;
  }

  // =========================
  // Helpers
  // =========================
  key(guildId, userId) {
    return `${String(guildId)}:${String(userId)}`;
  }

  formatMs(ms) {
    const totalMinutes = Math.floor((Number(ms) || 0) / 1000 / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  getLiveMs(guildId, userId) {
    const k = this.key(guildId, userId);
    const startedAt = this.activeSessions.get(k);
    if (!startedAt) return 0;
    return Math.max(0, Date.now() - startedAt);
  }

  msFromAmount(amount, unit) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) throw new Error("Quantidade inválida.");

    const u = String(unit || "hours").toLowerCase();
    if (u === "minutes" || u === "min" || u === "m") return Math.round(n * 60 * 1000);
    return Math.round(n * 60 * 60 * 1000); // hours default
  }

  // =========================
  // USERS / TOTALS
  // =========================
  async touchUser(guildId, user) {
    if (!this.enabled) return;
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

  async getUserStoredMs(guildId, userId) {
    const res = await this.query(
      `SELECT total_ms FROM call_users WHERE guild_id = $1 AND user_id = $2`,
      [String(guildId), String(userId)]
    );
    return Number(res.rows?.[0]?.total_ms || 0);
  }

  async getUserTotalMs(guildId, userId) {
    if (!this.enabled) return 0;
    const stored = await this.getUserStoredMs(guildId, userId);
    const live = this.getLiveMs(guildId, userId);
    return stored + live;
  }

  async addTimeToUser(guildId, userId, username, amount, unit = "hours") {
    if (!this.enabled) throw new Error("CallRanking desativado (sem DB).");
    const ms = this.msFromAmount(amount, unit);

    await this.query(
      `
      INSERT INTO call_users (guild_id, user_id, username, total_ms)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (guild_id, user_id)
      DO UPDATE SET
        username = EXCLUDED.username,
        total_ms = call_users.total_ms + EXCLUDED.total_ms
      `,
      [String(guildId), String(userId), String(username || `ID ${userId}`), ms]
    );

    return ms;
  }

  /**
   * ✅ FLUSH DO TEMPO AO VIVO:
   * materializa (liveMs) no banco e reseta started_at = now
   * Assim o live zera e não “engana” transferência/consulta.
   */
  async flushLiveSessionToDb(guildId, userId) {
    if (!this.enabled) return 0;

    const k = this.key(guildId, userId);
    const startedAt = this.activeSessions.get(k);
    if (!startedAt) return 0;

    const now = Date.now();
    const liveMs = Math.max(0, now - startedAt);

    if (liveMs > 0) {
      await this.query(
        `
        INSERT INTO call_users (guild_id, user_id, username, total_ms)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (guild_id, user_id)
        DO UPDATE SET total_ms = call_users.total_ms + EXCLUDED.total_ms
        `,
        [String(guildId), String(userId), `ID ${userId}`, liveMs]
      );
    }

    // reseta sessão
    await this.query(
      `
      INSERT INTO call_sessions (session_key, guild_id, user_id, started_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (session_key)
      DO UPDATE SET started_at = EXCLUDED.started_at
      `,
      [k, String(guildId), String(userId), now]
    );

    this.activeSessions.set(k, now);
    return liveMs;
  }

  /**
   * ✅ TRANSFERÊNCIA CORRIGIDA:
   * - flush no FROM e TO (se estiverem em call)
   * - faz o desconto/adição no banco
   * => tira inclusive aquelas “1:27” ao vivo.
   */
  async transferTime(guildId, fromUser, toUser, amount, unit = "hours") {
    if (!this.enabled) throw new Error("CallRanking desativado (sem DB).");
    if (!fromUser || !toUser) throw new Error("Usuários inválidos.");
    if (String(fromUser.id) === String(toUser.id)) throw new Error("Não pode transferir para si mesmo.");

    const ms = this.msFromAmount(amount, unit);

    await this.query("BEGIN");
    try {
      await this.touchUser(guildId, fromUser);
      await this.touchUser(guildId, toUser);

      // ✅ IMPORTANTÍSSIMO:
      await this.flushLiveSessionToDb(guildId, fromUser.id);
      await this.flushLiveSessionToDb(guildId, toUser.id);

      const fromStored = await this.getUserStoredMs(guildId, fromUser.id);
      if (fromStored < ms) {
        throw new Error(
          `Saldo insuficiente: ${fromUser} tem ${this.formatMs(fromStored)} e tentou transferir ${this.formatMs(ms)}.`
        );
      }

      await this.query(
        `
        UPDATE call_users
        SET total_ms = total_ms - $3,
            username = $4
        WHERE guild_id = $1 AND user_id = $2
        `,
        [String(guildId), String(fromUser.id), ms, String(fromUser.username)]
      );

      await this.query(
        `
        UPDATE call_users
        SET total_ms = total_ms + $3,
            username = $4
        WHERE guild_id = $1 AND user_id = $2
        `,
        [String(guildId), String(toUser.id), ms, String(toUser.username)]
      );

      await this.query("COMMIT");
      return ms;
    } catch (e) {
      await this.query("ROLLBACK");
      throw e;
    }
  }

  // =========================
  // Sessions
  // =========================
  async startSession(guildId, userId) {
    if (!this.enabled) return;

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
    if (!this.enabled) return;

    const k = this.key(guildId, userId);
    const startedAt = this.activeSessions.get(k);
    if (!startedAt) return;

    this.activeSessions.delete(k);

    const elapsed = Math.max(0, Date.now() - startedAt);

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
      DO UPDATE SET
        total_ms = call_users.total_ms + EXCLUDED.total_ms,
        username = EXCLUDED.username
      `,
      [String(guildId), String(userId), username, elapsed]
    );

    await this.query(`DELETE FROM call_sessions WHERE session_key = $1`, [k]);
  }

  async restoreActiveSessionsFromDb() {
    if (!this.enabled) return;

    const res = await this.query(`SELECT session_key, started_at FROM call_sessions`);
    for (const row of res.rows) {
      this.activeSessions.set(String(row.session_key), Number(row.started_at));
    }
  }

  // =========================
  // Events
  // =========================
  async handleVoiceStateUpdate(oldState, newState) {
    if (!this.enabled) return;

    const member = newState.member || oldState.member;
    if (!member || !this.isTrackableUser(member.user)) return;

    const guildId = newState.guild?.id || oldState.guild?.id;
    const userId = member.id;
    if (!guildId || !userId) return;

    // ranking só na Yakuza
    if (String(guildId) !== String(this.targetGuildId)) return;

    const wasIn = !!oldState.channelId;
    const isIn = !!newState.channelId;

    try {
      await this.touchUser(guildId, member.user);

      if (!wasIn && isIn) await this.startSession(guildId, userId);
      if (wasIn && !isIn) await this.stopSession(guildId, userId);
    } catch (err) {
      console.error("❌ [CallRanking] erro no voiceStateUpdate, desabilitando:", err?.message || err);
      this.enabled = false;
    }
  }

  // =========================
  // Embed / message update
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
      .filter((u) => !this.excludedUserIds.has(u.userId))
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

  async updateRankingMessage() {
    if (!this.enabled) return;
    if (!this.targetGuildId || !this.targetChannelId || !this.targetMessageId) return;

    const guild = await this.client.guilds.fetch(String(this.targetGuildId)).catch(() => null);
    if (!guild) return;

    const channel = await guild.channels.fetch(String(this.targetChannelId)).catch(() => null);
    if (!channel || !channel.isTextBased?.()) return;

    const msg = await channel.messages.fetch(String(this.targetMessageId)).catch(() => null);
    if (!msg) {
      console.error(
        `[CallRanking] Não consegui buscar a msg fixa ${this.targetMessageId} no canal ${this.targetChannelId}. Confere "Read Message History".`
      );
      return;
    }

    const embed = await this.buildEmbedForGuild(guild);
    await msg.edit({ embeds: [embed] });
  }

  // =========================
  // Snapshot (opcional)
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
      if (!this.enabled) return;
      this.ensureStorage();

      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const filename = `call_ranking.snapshot.${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
        now.getDate()
      )}_${pad(now.getHours())}-${pad(now.getMinutes())}.json`;
      const snapshotPath = path.join(this.dataDir, filename);

      const json = await this.exportCurrentDataAsJsonObject();
      fs.writeFileSync(snapshotPath, JSON.stringify(json, null, 2));
      console.log(`[CallRanking] Snapshot criado: ${filename}`);
    } catch (err) {
      console.warn("[CallRanking] Snapshot falhou:", err?.message || err);
    }
  }

  // =========================
  // INIT
  // =========================
  async init() {
    try {
      const ok = await this.connectDb().catch((e) => {
        console.error("❌ [CallRanking] Falha ao conectar no Neon:", e?.message || e);
        return false;
      });

      if (!ok) {
        this.enabled = false;
        console.warn("⚠️ [CallRanking] Desabilitado (sem DB).");
        return;
      }

      if (!this.targetChannelId) {
        console.error("❌ [CallRanking] CALL_RANKING_CHANNEL_ID não definido (canal da mensagem do ranking).");
        this.enabled = false;
        return;
      }

      this.enabled = true;

      await this.initDbSchema();
      await this.restoreActiveSessionsFromDb();

      // captura quem já está em call ao ligar (somente yakuza)
      const guild = this.client.guilds.cache.get(String(this.targetGuildId));
      if (guild) {
        for (const voiceState of guild.voiceStates.cache.values()) {
          if (!voiceState.channelId || !voiceState.member) continue;
          if (!this.isTrackableUser(voiceState.member.user)) continue;

          const userId = voiceState.member.id;
          await this.touchUser(guild.id, voiceState.member.user);

          const k = this.key(guild.id, userId);
          if (!this.activeSessions.has(k)) {
            await this.startSession(guild.id, userId);
          }
        }
      }

      await this.updateRankingMessage().catch((err) => {
        console.error("[CallRanking] Erro na atualização inicial:", err?.message || err);
      });

      if (this.interval) clearInterval(this.interval);
      this.interval = setInterval(() => {
        this.updateRankingMessage().catch((err) => {
          console.error("[CallRanking] Erro na atualização periódica:", err?.message || err);
        });
      }, this.updateIntervalMs);

      if (this.snapshotInterval) clearInterval(this.snapshotInterval);
      this.snapshotInterval = setInterval(() => {
        this.createSnapshotBackup().catch?.(() => {});
      }, this.snapshotBackupIntervalMs);

      console.log("✅ [CallRanking] Rodando: Neon OK, ranking só na Yakuza, editando msg fixa.");
    } catch (err) {
      this.enabled = false;
      console.error("❌ [CallRanking] Init falhou e foi desabilitado:", err?.message || err);
    }
  }

  async close() {
    try {
      if (this.interval) clearInterval(this.interval);
      if (this.snapshotInterval) clearInterval(this.snapshotInterval);
      if (this.pool) await this.pool.end().catch(() => {});
    } finally {
      this.enabled = false;
    }
  }
}

module.exports = CallRankingManager;
