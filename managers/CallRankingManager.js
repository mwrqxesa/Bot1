const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');

class CallRankingManager {
  constructor(client) {
    this.client = client;

    this.dataDir = path.join(__dirname, '..', 'data');
    this.filePath = path.join(this.dataDir, 'call_ranking.json');

    // Sessões ativas: "guildId:userId" => timestamp de início
    this.activeSessions = new Map();

    // Atualização automática (5 min)
    this.updateIntervalMs = 5 * 60 * 1000;
    this.interval = null;

    // Config via Railway Variables
    this.targetGuildId = process.env.CALL_RANKING_GUILD_ID || null;
    this.targetChannelId = process.env.CALL_RANKING_CHANNEL_ID || null;

    // Estrutura persistida
    this.data = this.load();
  }

  // =========================
  // Persistência
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

      // garante estrutura
      if (!json.users || typeof json.users !== 'object') json.users = {};
      if (!('rankingMessageId' in json)) json.rankingMessageId = null;

      return json;
    } catch {
      return {
        users: {},
        rankingMessageId: null,
      };
    }
  }

  save() {
    this.ensureStorage();
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  // =========================
  // Helpers
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
    if (!guildId || !userId) return;
    const k = this.key(guildId, userId);

    // evita sobrescrever sessão já ativa
    if (this.activeSessions.has(k)) return;

    this.activeSessions.set(k, Date.now());
  }

  stopSession(guildId, userId) {
    if (!guildId || !userId) return;
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
  // Voice tracking
  // =========================
  isTrackableMember(member) {
    return !!member && !member.user?.bot;
  }

  handleVoiceStateUpdate(oldState, newState) {
    const member = newState.member || oldState.member;
    if (!this.isTrackableMember(member)) return;

    const guildId = newState.guild?.id || oldState.guild?.id;
    const userId = member.id;
    if (!guildId || !userId) return;

    const wasInVoice = !!oldState.channelId;
    const isInVoice = !!newState.channelId;

    // sincroniza username no banco
    this.touchUser(member.user);

    // Entrou em call
    if (!wasInVoice && isInVoice) {
      this.startSession(guildId, userId);
      this.save();
      return;
    }

    // Saiu da call
    if (wasInVoice && !isInVoice) {
      this.stopSession(guildId, userId);
      return;
    }

    // Trocou de call (continua contando)
    if (wasInVoice && isInVoice && oldState.channelId !== newState.channelId) {
      // mantém a sessão ativa sem resetar
      this.save();
      return;
    }

    // Outras mudanças (mute/deafen/stream/etc) — mantém sessão
    this.save();
  }

  // =========================
  // Embed / UI
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
  // Mensagem do ranking
  // =========================
  async updateRankingMessage() {
    if (!this.targetGuildId || !this.targetChannelId) {
      console.warn('[CallRanking] CALL_RANKING_GUILD_ID / CALL_RANKING_CHANNEL_ID não configurados.');
      return;
    }

    const guild = await this.client.guilds.fetch(this.targetGuildId).catch(() => null);
    if (!guild) {
      console.warn('[CallRanking] Servidor não encontrado:', this.targetGuildId);
      return;
    }

    const channel = await guild.channels.fetch(this.targetChannelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) {
      console.warn('[CallRanking] Canal inválido ou não é de texto:', this.targetChannelId);
      return;
    }

    const embed = this.buildEmbed(guild);

    // Tenta editar mensagem existente
    if (this.data.rankingMessageId) {
      const msg = await channel.messages.fetch(this.data.rankingMessageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed] }).catch((err) => {
          console.error('[CallRanking] Falha ao editar mensagem:', err);
        });
        return;
      }
    }

    // Se não existir, cria uma nova
    const newMsg = await channel.send({ embeds: [embed] }).catch((err) => {
      console.error('[CallRanking] Falha ao enviar mensagem:', err);
      return null;
    });

    if (newMsg) {
      this.data.rankingMessageId = newMsg.id;
      this.save();
    }
  }

  // =========================
  // Init
  // =========================
  async init() {
    // Captura quem já está em call quando o bot liga
    for (const guild of this.client.guilds.cache.values()) {
      for (const voiceState of guild.voiceStates.cache.values()) {
        if (voiceState.channelId && voiceState.member && !voiceState.member.user.bot) {
          this.touchUser(voiceState.member.user);
          this.startSession(guild.id, voiceState.id);
        }
      }
    }

    this.save();

    // Atualiza imediatamente ao iniciar
    await this.updateRankingMessage().catch((err) => {
      console.error('[CallRanking] Erro na atualização inicial:', err);
    });

    // Atualiza a cada 5 min
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => {
      this.updateRankingMessage().catch((err) => {
        console.error('[CallRanking] Erro na atualização periódica:', err);
      });
    }, this.updateIntervalMs);
  }
}

module.exports = CallRankingManager;
