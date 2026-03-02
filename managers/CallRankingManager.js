const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { EmbedBuilder } = require("discord.js");

class CallRankingManager {
  constructor(client) {
    this.client = client;

    // ====== CONFIG ======
    // Neon/Postgres
    this.databaseUrl = process.env.DATABASE_URL || null;
    this.pool = null;

    // ✅ Ranking somente na Yakuza (fixo)
    // Você já passou:
    // Guild: 1476212383109087304
    // Msg:   1477465092470608015
    this.targetGuildId = process.env.CALL_RANKING_GUILD_ID || "1476212383109087304";
    this.targetChannelId = process.env.CALL_RANKING_CHANNEL_ID || "1476212383109087304"; // ⚠️ troque pelo ID do CANAL correto se este não for o canal
    this.targetMessageId = process.env.CALL_RANKING_MESSAGE_ID || "1477465092470608015";

    // Intervalos
    this.updateIntervalMs = 5 * 60 * 1000; // 5 min
    this.snapshotBackupIntervalMs = 10 * 60 * 60 * 1000; // 10h (opcional)

    // ====== STATE ======
    this.activeSessions = new Map(); // key(guild:user) => startedAt(ms)
    this.interval = null;
    this.snapshotInterval = null;

    // ✅ “modo seguro”: se banco falhar, não spamma erro em voiceStateUpdate
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

    // ✅ Força SSL no Node/pg (Neon costuma exigir).
    // Mesmo que sua URL tenha sslmode=require, isso ajuda a evitar dor de cabeça.
    this.pool = new Pool({
      connectionString: this.databaseUrl,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    });

    // testa conexão
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
    // ✅ permite o próprio bot (para seu 24/7 se você quiser contar)
    if (this.client?.user && user.id === this.client.user.id) return true;
    // ❌ ignora outros bots
    if (user.bot) return false;
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
    const gid = String(guildId);
    const uid = String(userId);
    const k = `${gid}:${uid}`;
    const startedAt = this.activeSessions.get(k);
    if (!startedAt) return 0;
    return Math.max(0, Date.now() - startedAt);
  }

  // =========================
  // Users / totals
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
    // ✅ se DB caiu, não faz nada (evita spam)
    if (!this.enabled) return;

    const member = newState.member || oldState.member;
    if (!member || !this.isTrackableUser(member.user)) return;

    const guildId = newState.guild?.id || oldState.guild?.id;
    const userId = member.id;
    if (!guildId || !userId) return;

    // ✅ ranking só na Yakuza: ignora outros servidores
    if (String(guildId) !== String(this.targetGuildId)) return;

    const wasIn = !!oldState.channelId;
    const isIn = !!newState.channelId;

    try {
      await this.touchUser(guildId, member.user);

      if (!wasIn && isIn) await this.startSession(guildId, userId);
      if (wasIn && !isIn) await this.stopSession(guildId, userId);
    } catch (err) {
      // se der erro aqui, desabilita para parar avalanche
      console.error("❌ [CallRanking] erro em voiceStateUpdate, desabilitando:", err?.message || err);
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
        `[CallRanking] Não consegui buscar a msg fixa ${this.targetMessageId} no canal ${this.targetChannelId}. ` +
          `Confere permissão "Read Message History".`
      );
      return; // ❌ não cria nova msg
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
  // Import do seu “backup base” (OPCIONAL)
  // =========================
  // Formato esperado do arquivo:
  // {
  //   "usersByGuild": {
  //     "1476212383109087304": {
  //       "123": { "username": "Fulano", "totalMs": 123456 }
  //     }
  //   }
  // }
  async importBaseSnapshotIfProvided() {
    if (!this.enabled) return;

    const filePath = process.env.CALL_RANKING_IMPORT_JSON || null;
    if (!filePath) return;

    try {
      if (!fs.existsSync(filePath)) {
        console.warn(`[CallRanking] IMPORT_JSON definido mas arquivo não existe: ${filePath}`);
        return;
      }

      const raw = fs.readFileSync(filePath, "utf8");
      const json = JSON.parse(raw);

      const gid = String(this.targetGuildId);
      const map = json?.usersByGuild?.[gid];
      if (!map || typeof map !== "object") {
        console.warn("[CallRanking] Import JSON não tem usersByGuild para a guild alvo.");
        return;
      }

      // upsert “base” (se já tiver mais horas no banco, não diminui)
      // regra: total_ms = GREATEST(total_ms, incoming_total)
      const entries = Object.entries(map);
      for (const [userId, data] of entries) {
        const username = data?.username || `ID ${userId}`;
        const totalMs = Number(data?.totalMs || 0);

        await this.query(
          `
          INSERT INTO call_users (guild_id, user_id, username, total_ms)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (guild_id, user_id)
          DO UPDATE SET
            username = EXCLUDED.username,
            total_ms = GREATEST(call_users.total_ms, EXCLUDED.total_ms)
          `,
          [gid, String(userId), String(username), totalMs]
        );
      }

      console.log(`✅ [CallRanking] Import base aplicado (${entries.length} usuários).`);
    } catch (err) {
      console.error("❌ [CallRanking] Falha ao importar base:", err?.message || err);
    }
  }

  // =========================
  // INIT
  // =========================
  async init() {
    // evita crash geral caso falhe
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

      this.enabled = true;

      await this.initDbSchema();
      await this.restoreActiveSessionsFromDb();

      // ✅ aplica seu “backup base” se você passar o caminho (CALL_RANKING_IMPORT_JSON)
      // Isso resolve seu ponto: “tenho dados base do último backup”
      await this.importBaseSnapshotIfProvided();

      // captura quem já está em call ao ligar (somente yakuza)
      const guild = this.client.guilds.cache.get(String(this.targetGuildId));
      if (guild) {
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

      // update inicial (edita msg fixa)
      await this.updateRankingMessage().catch((err) => {
        console.error("[CallRanking] Erro na atualização inicial:", err?.message || err);
      });

      // timers
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

  // (opcional) encerrar pool
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
