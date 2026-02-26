const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');

class CallRankingManager {
  constructor(client) {
    this.client = client;
    this.dataDir = path.join(__dirname, '..', 'data');
    this.filePath = path.join(this.dataDir, 'call_ranking.json');
    this.backupPath = path.join(this.dataDir, 'call_ranking.backup.json');

    this.activeSessions = new Map();
    this.updateIntervalMs = 5 * 60 * 1000;
    this.interval = null;

    this.targetGuildId = process.env.CALL_RANKING_GUILD_ID || null;
    this.targetChannelId = process.env.CALL_RANKING_CHANNEL_ID || null;

    this.data = this.load();
  }

  ensureStorage() {
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });

    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(
        this.filePath,
        JSON.stringify({ users: {}, rankingMessageId: null }, null, 2)
      );
    }
  }

  load() {
    this.ensureStorage();

    try {
      const json = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!json.users || typeof json.users !== 'object') json.users = {};
      if (!('rankingMessageId' in json)) json.rankingMessageId = null;
      return json;
    } catch {
      try {
        if (fs.existsSync(this.backupPath)) {
          const backup = JSON.parse(fs.readFileSync(this.backupPath, 'utf8'));
          if (!backup.users || typeof backup.users !== 'object') backup.users = {};
          if (!('rankingMessageId' in backup)) backup.rankingMessageId = null;
          return backup;
        }
      } catch {}
      return { users: {}, rankingMessageId: null };
    }
  }

  save() {
    this.ensureStorage();

    try {
      if (fs.existsSync(this.filePath)) {
        fs.copyFileSync(this.filePath, this.backupPath);
      }
    } catch (err) {
      console.warn('[CallRanking] Backup falhou:', err?.message || err);
    }

    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  key(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  touchUser(user) {
    if (!user || user.bot) return;
    if (!this.data.users[user.id]) {
      this.data.users[user.id] = { username: user.username, totalMs: 0 };
    } else {
      this.data.users[user.id].username = user.username;
    }
  }

  startSession(guildId, userId) {
    const k = this.key(guildId, userId);
    if (!this.activeSessions.has(k)) this.activeSessions.set(k, Date.now());
  }

  stopSession(guildId, userId) {
    const k = this.key(guildId, userId);
    const started = this.activeSessions.get(k);
    if (!started) return;

    this.activeSessions.delete(k);
    const elapsed = Math.max(0, Date.now() - started);

    if (!this.data.users[userId]) {
      this.data.users[userId] = { username: `ID ${userId}`, totalMs: 0 };
    }
    this.data.users[userId].totalMs += elapsed;
    this.save();
  }

  getLiveMs(userId) {
    let total = 0;
    for (const [k, started] of this.activeSessions.entries()) {
      const [, uid] = k.split(':');
      if (uid === userId) total += (Date.now() - started);
    }
    return total;
  }

  getTotalWithLiveMs(userId) {
    return (this.data.users[userId]?.totalMs || 0) + this.getLiveMs(userId);
  }

  formatMs(ms) {
    const sec = Math.floor((ms || 0) / 1000);
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

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

  getCallLevelRoleData(totalMs) {
    const hours = totalMs / 3600000;
    if (hours < 10) return null;

    let reached = null;
    for (const h of this.getCallMilestones()) {
      if (hours >= h) reached = h;
      else break;
    }
    if (!reached) return null;

    return { milestone: reached, title: this.getCallRankMap()[reached] };
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

    const roleData = this.getCallLevelRoleData(this.getTotalWithLiveMs(userId));
    const currentCallRoles = member.roles.cache.filter(r => this.isCallLevelRoleName(r.name));

    if (!roleData) {
      if (currentCallRoles.size > 0) await member.roles.remove(currentCallRoles).catch(() => {});
      return;
    }

    const targetRoleName = this.formatCallRoleName(roleData.milestone, roleData.title);
    const targetRole = await this.ensureCallRole(guild, targetRoleName, roleData.milestone);
    if (!targetRole) return;

    const toRemove = currentCallRoles.filter(r => r.id !== targetRole.id);
    if (toRemove.size > 0) await member.roles.remove(toRemove).catch(() => {});

    if (!member.roles.cache.has(targetRole.id)) {
      await member.roles.add(targetRole, 'Cargo automático por horas em call').catch(() => {});
    }
  }

  async updateAllCallLevelRoles() {
    if (!this.targetGuildId) return;
    const guild = await this.client.guilds.fetch(this.targetGuildId).catch(() => null);
    if (!guild) return;

    for (const userId of Object.keys(this.data.users || {})) {
      try {
        await this.updateMemberCallLevelRole(guild, userId);
      } catch (err) {
        console.error(`[CallRanking] Erro ao atualizar cargo de ${userId}:`, err);
      }
    }
  }

  handleVoiceStateUpdate(oldState, newState) {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    const guildId = newState.guild?.id || oldState.guild?.id;
    const userId = member.id;
    if (!guildId || !userId) return;

    const wasIn = !!oldState.channelId;
    const isIn = !!newState.channelId;

    this.touchUser(member.user);

    if (!wasIn && isIn) {
      this.startSession(guildId, userId);
      this.save();
      return;
    }

    if (wasIn && !isIn) {
      this.stopSession(guildId, userId);
      return;
    }

    this.save();
  }

  buildEmbed(guild) {
    const ranking = Object.keys(this.data.users)
      .map(userId => ({
        userId,
        totalMs: this.getTotalWithLiveMs(userId)
      }))
      .sort((a, b) => b.totalMs - a.totalMs);

    const top = ranking.slice(0, 15);

    const lines = top.length
      ? top.map((u, i) => {
          const pos = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `\`${String(i + 1).padStart(2, '0')}\``;
          return `${pos} <@${u.userId}> — **${this.formatMs(u.totalMs)}**`;
        }).join('\n')
      : 'Ninguém entrou em call ainda.';

    const onlineNow = [...this.activeSessions.keys()].filter(k => k.startsWith(`${guild.id}:`)).length;

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

  async updateRankingMessage() {
    if (!this.targetGuildId || !this.targetChannelId) return;

    const guild = await this.client.guilds.fetch(this.targetGuildId).catch(() => null);
    if (!guild) return;

    const channel = await guild.channels.fetch(this.targetChannelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) return;

    const embed = this.buildEmbed(guild);

    let msg = null;
    if (this.data.rankingMessageId) {
      msg = await channel.messages.fetch(this.data.rankingMessageId).catch(() => null);
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
        this.data.rankingMessageId = newMsg.id;
        this.save();
      }
    }

    await this.updateAllCallLevelRoles().catch(err => {
      console.error('[CallRanking] Erro ao sincronizar cargos de call:', err);
    });
  }

  async init() {
    for (const guild of this.client.guilds.cache.values()) {
      for (const voiceState of guild.voiceStates.cache.values()) {
        if (voiceState.channelId && voiceState.member && !voiceState.member.user.bot) {
          this.touchUser(voiceState.member.user);
          this.startSession(guild.id, voiceState.id);
        }
      }
    }

    this.save();

    await this.updateRankingMessage().catch(err => {
      console.error('[CallRanking] Erro na atualização inicial:', err);
    });

    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => {
      this.updateRankingMessage().catch(err => {
        console.error('[CallRanking] Erro na atualização periódica:', err);
      });
    }, this.updateIntervalMs);
  }
}

module.exports = CallRankingManager;
