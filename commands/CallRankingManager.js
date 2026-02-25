const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');

class CallRankingManager {
  constructor(client) {
    this.client = client;
    this.dataDir = path.join(__dirname, '..', 'data');
    this.file = path.join(this.dataDir, 'call_ranking.json');

    // CONFIGURE AQUI 👇
    this.targetGuildId = process.env.CALL_RANKING_GUILD_ID || null;
    this.targetChannelId = process.env.CALL_RANKING_CHANNEL_ID || null;

    this.updateIntervalMs = 5 * 60 * 1000; // 5 min
    this.activeSessions = new Map(); // key = guildId:userId => timestamp(ms)
    this.data = this.load();
    this.interval = null;
  }

  ensureStorage() {
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    if (!fs.existsSync(this.file)) {
      fs.writeFileSync(this.file, JSON.stringify({
        users: {},
        rankingMessageId: null,
        lastResetAt: Date.now()
      }, null, 2));
    }
  }

  load() {
    this.ensureStorage();
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return { users: {}, rankingMessageId: null, lastResetAt: Date.now() };
    }
  }

  save() {
    this.ensureStorage();
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  key(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  isTrackable(member, newState) {
    if (!member || member.user.bot) return false;
    if (!newState.channelId) return false;
    // ignora self-deaf/self-mute? (opcional)
    return true;
  }

  startSession(guildId, userId) {
    this.activeSessions.set(this.key(guildId, userId), Date.now());
  }

  stopSession(guildId, userId) {
    const k = this.key(guildId, userId);
    const startedAt = this.activeSessions.get(k);
    if (!startedAt) return;

    const elapsed = Date.now() - startedAt;
    this.activeSessions.delete(k);

    if (!this.data.users[userId]) {
      this.data.users[userId] = {
        totalMs: 0,
        username: null,
        updatedAt: Date.now()
      };
    }

    this.data.users[userId].totalMs += Math.max(0, elapsed);
    this.data.users[userId].updatedAt = Date.now();
    this.save();
  }

  syncUsername(user) {
    if (!user || !this.data.users[user.id]) return;
    this.data.users[user.id].username = user.username;
  }

  handleVoiceStateUpdate(oldState, newState) {
    const guildId = newState.guild?.id || oldState.guild?.id;
    if (!guildId) return;

    const member = newState.member || oldState.member;
    const userId = member?.id;
    if (!userId || member.user.bot) return;

    const wasInVoice = !!oldState.channelId;
    const isInVoice = !!newState.channelId;

    // entrou
    if (!wasInVoice && isInVoice) {
      this.startSession(guildId, userId);
      this.syncUsername(member.user);
      this.save();
      return;
    }

    // saiu
    if (wasInVoice && !isInVoice) {
      this.syncUsername(member.user);
      this.stopSession(guildId, userId);
      return;
    }

    // trocou de canal -> mantém sessão (continua)
    if (wasInVoice && isInVoice && oldState.channelId !== newState.channelId) {
      this.syncUsername(member.user);
      return;
    }
  }

  getTotalWithLiveMs(userId) {
    const base = this.data.users[userId]?.totalMs || 0;
    let live = 0;

    // soma sessão ativa (se houver)
    for (const [key, startedAt] of this.activeSessions.entries()) {
      const [, uid] = key.split(':');
      if (uid === userId) live += (Date.now() - startedAt);
    }

    return base + live;
  }

  formatMs(ms) {
    const totalSec = Math.floor(ms / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);

    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  buildEmbed(guild) {
    const users = Object.keys(this.data.users).map(userId => {
      const totalMs = this.getTotalWithLiveMs(userId);
      const username = this.data.users[userId]?.username || `ID ${userId}`;
      return { userId, username, totalMs };
    });

    users.sort((a, b) => b.totalMs - a.totalMs);

    const top = users.slice(0, 15);
    const lines = top.length
      ? top.map((u, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**#${i + 1}**`;
          return `${medal} <@${u.userId}> • **${this.formatMs(u.totalMs)}**`;
        })
      : ['Nenhum tempo registrado ainda.'];

    const onlineNow = [...this.activeSessions.keys()]
      .filter(k => k.startsWith(`${guild.id}:`)).length;

    return new EmbedBuilder()
      .setTitle('📞 Ranking de Tempo em Call')
      .setColor('#0099ff')
      .setDescription(lines.join('\n'))
      .addFields(
        { name: '👥 Em call agora', value: String(onlineNow), inline: true },
        { name: '🔄 Atualiza a cada', value: '5 minutos', inline: true }
      )
      .setFooter({ text: 'Desenvolvido por Lynn' })
      .setTimestamp();
  }

  async updateRankingMessage() {
    if (!this.targetGuildId || !this.targetChannelId) return;

    const guild = await this.client.guilds.fetch(this.targetGuildId).catch(() => null);
    if (!guild) return;

    const channel = await guild.channels.fetch(this.targetChannelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) return;

    const embed = this.buildEmbed(guild);

    // tenta editar a mensagem fixa
    if (this.data.rankingMessageId) {
      const msg = await channel.messages.fetch(this.data.rankingMessageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed] }).catch(() => {});
        return;
      }
    }

    // se não existir, cria
    const newMsg = await channel.send({ embeds: [embed] }).catch(() => null);
    if (newMsg) {
      this.data.rankingMessageId = newMsg.id;
      this.save();
    }
  }

  async init() {
    // Inicializa sessões para quem já está em call quando o bot liga
    for (const guild of this.client.guilds.cache.values()) {
      for (const [_, vs] of guild.voiceStates.cache) {
        if (vs.channelId && vs.member && !vs.member.user.bot) {
          this.startSession(guild.id, vs.id);
          this.syncUsername(vs.member.user);
        }
      }
    }
    this.save();

    // Atualização periódica
    this.interval = setInterval(() => {
      this.updateRankingMessage().catch(err => console.error('CallRanking update error:', err));
    }, this.updateIntervalMs);

    // Atualiza ao iniciar
    await this.updateRankingMessage().catch(() => {});
  }
}

module.exports = CallRankingManager;
