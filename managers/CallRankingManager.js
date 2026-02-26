const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');

class CallRankingManager {
  constructor(client) {
    this.client = client;

    this.dataDir = path.join(__dirname, '..', 'data');
    this.filePath = path.join(this.dataDir, 'call_ranking.json');
    this.backupPath = path.join(this.dataDir, 'call_ranking.backup.json');

    this.activeSessions = new Map(); // guildId:userId => timestamp
    this.interval = null;
    this.updateIntervalMs = 5 * 60 * 1000; // 5 min

    this.targetGuildId = process.env.CALL_RANKING_GUILD_ID || null;
    this.targetChannelId = process.env.CALL_RANKING_CHANNEL_ID || null;

    this.data = this.load();
  }

  // =========================
  // STORAGE
  // =========================
  ensureStorage() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    if (!fs.existsSync(this.filePath)) {
      const initial = {
        users: {},
        rankingMessageId: null,
      };
      fs.writeFileSync(this.filePath, JSON.stringify(initial, null, 2));
    }
  }

  load() {
    this.ensureStorage();

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const json = JSON.parse(raw);

      if (!json.users || typeof json.users !== 'object') json.users = {};
      if (!('rankingMessageId' in json)) json.rankingMessageId = null;

      return json;
    } catch (err) {
      console.warn('[CallRanking] Erro ao ler JSON principal, tentando backup...', err?.message || err);

      // tenta carregar backup se principal falhar
      try {
        if (fs.existsSync(this.backupPath)) {
          const rawBackup = fs.readFileSync(this.backupPath, 'utf8');
          const backupJson = JSON.parse(rawBackup);

          if (!backupJson.users || typeof backupJson.users !== 'object') backupJson.users = {};
          if (!('rankingMessageId' in backupJson)) backupJson.rankingMessageId = null;

          console.log('[CallRanking] Backup carregado com sucesso.');
          return backupJson;
        }
      } catch (backupErr) {
        console.warn('[CallRanking] Backup também falhou:', backupErr?.message || backupErr);
      }

      return {
        users: {},
        rankingMessageId: null,
      };
    }
  }

  save() {
    this.ensureStorage();

    // 1) cria backup do arquivo atual (antes de sobrescrever)
    try {
      if (fs.existsSync(this.filePath)) {
        fs.copyFileSync(this.filePath, this.backupPath);
      }
    } catch (err) {
      console.warn('[CallRanking] Falha ao criar backup:', err?.message || err);
    }

    // 2) salva o arquivo principal
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  // =========================
  // HELPERS
  // =========================
  key(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  formatMs(ms) {
    const totalSec = Math.floor((ms || 0) / 1000);

    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  touchUser(user) {
    if (!user || user.bot) return;

    if (!this.data.users[user.id]) {
      this.data.users[user.id] = {
        username: user.username,
        totalMs: 0,
      };
    } else {
      this.data.users[user.id].username = user.username;
    }
  }

  startSession(guildId, userId) {
    const k = this.key(guildId, userId);
    if (this.activeSessions.has(k)) return;
    this.activeSessions.set(k, Date.now());
  }

  stopSession(guildId, userId) {
    const k = this.key(guildId, userId);
    const startedAt = this.activeSessions.get(k);
    if (!startedAt) return;

    const elapsed = Date.now() - startedAt;
    this.activeSessions.delete(k);

    if (!this.data.users[userId]) {
      this.data.users[userId] = {
        username: `ID ${userId}`,
        totalMs: 0,
      };
    }

    this.data.users[userId].totalMs += Math.max(0, elapsed);
    this.save();
  }

  getLiveMs(userId) {
    let live = 0;

    for (const [k, startedAt] of this.activeSessions.entries()) {
      const [, uid] = k.split(':');
      if (uid === userId) {
        live += (Date.now() - startedAt);
      }
    }

    return live;
  }

  getTotalWithLiveMs(userId) {
    const base = this.data.users[userId]?.totalMs || 0;
    return base + this.getLiveMs(userId);
  }

  // =========================
  // VOICE TRACKING
  // =========================
  handleVoiceStateUpdate(oldState, newState) {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    const guildId = newState.guild?.id || oldState.guild?.id;
    const userId = member.id;
    if (!guildId || !userId) return;

    const wasInVoice = !!oldState.channelId;
    const isInVoice = !!newState.channelId;

    this.touchUser(member.user);

    // entrou
    if (!wasInVoice && isInVoice) {
      this.startSession(guildId, userId);
      this.save();
      return;
    }

    // saiu
    if (wasInVoice && !isInVoice) {
      this.stopSession(guildId, userId);
      return;
    }

    // trocou de canal ou alterou estado (continua contando)
    this.save();
  }

  // =========================
  // EMBED
  // =========================
  buildEmbed(guild) {
    const ranking = Object.keys(this.data.users)
      .map(userId => ({
        userId,
        username: this.data.users[userId]?.username || `ID ${userId}`,
        totalMs: this.getTotalWithLiveMs(userId),
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
      .setDescription([
        '### 🏆 Top membros em call',
        lines
      ].join('\n\n'))
      .addFields(
        {
          name: '👥 Em call agora',
          value: `**${onlineNow}** membro(s)`,
          inline: true
        },
        {
          name: '🔄 Atualização',
          value: 'A cada **5 minutos**',
          inline: true
        },
        {
          name: '🕒 Última atualização',
          value: lastUpdate,
          inline: false
        }
      )
      .setFooter({ text: 'Desenvolvido por Lynn' })
      .setTimestamp();
  }

  // =========================
  // UPDATE MESSAGE
  // =========================
  async updateRankingMessage() {
    if (!this.targetGuildId || !this.targetChannelId) {
      console.warn('[CallRanking] IDs de guild/canal não configurados.');
      return;
    }

    const guild = await this.client.guilds.fetch(this.targetGuildId).catch(() => null);
    if (!guild) {
      console.warn('[CallRanking] Servidor não encontrado:', this.targetGuildId);
      return;
    }

    const channel = await guild.channels.fetch(this.targetChannelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) {
      console.warn('[CallRanking] Canal inválido:', this.targetChannelId);
      return;
    }

    const embed = this.buildEmbed(guild);

    if (this.data.rankingMessageId) {
      const msg = await channel.messages.fetch(this.data.rankingMessageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed] }).catch(err => {
          console.error('[CallRanking] Erro ao editar mensagem:', err);
        });
        return;
      }
    }

    const newMsg = await channel.send({ embeds: [embed] }).catch(err => {
      console.error('[CallRanking] Erro ao enviar mensagem:', err);
      return null;
    });

    if (newMsg) {
      this.data.rankingMessageId = newMsg.id;
      this.save();
    }
  }

  // =========================
  // INIT
  // =========================
  async init() {
    // captura membros já em call ao ligar o bot
    for (const guild of this.client.guilds.cache.values()) {
      for (const voiceState of guild.voiceStates.cache.values()) {
        if (voiceState.channelId && voiceState.member && !voiceState.member.user.bot) {
          this.touchUser(voiceState.member.user);
          this.startSession(guild.id, voiceState.id);
        }
      }
    }

    this.save();

    // atualiza mensagem imediatamente
    await this.updateRankingMessage().catch(err => {
      console.error('[CallRanking] Erro na atualização inicial:', err);
    });

    // loop de atualização
    if (this.interval) clearInterval(this.interval);

    this.interval = setInterval(() => {
      this.updateRankingMessage().catch(err => {
        console.error('[CallRanking] Erro na atualização periódica:', err);
      });
    }, this.updateIntervalMs);
  }
}

module.exports = CallRankingManager;
