const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bedwars')
    .setDescription('[Mush] Verifique as estatísticas Gerais de um jogador no Bed Wars.')
    .addStringOption(option =>
      option
        .setName('nick')
        .setDescription('Nome de usuário do jogador')
        .setRequired(true)
    ),

  async execute(interaction) {
    const username = interaction.options.getString('nick');

    try {
      const response = await axios.get(`https://mush.com.br/api/player/${encodeURIComponent(username)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      const data = response.data;

      if (!data?.success || !data?.response?.stats?.bedwars) {
        return interaction.reply({
          content: '❌ Não foi possível encontrar as estatísticas desse jogador. (Pode estar nicked ou o nick está errado.)',
          ephemeral: true
        });
      }

      const bedwarsStats = data.response.stats.bedwars;
      const playTime = data.response.stats?.play_time?.bedwars ?? 0;
      const uniqueId = data.response.account?.unique_id;

      const modes = [
        { label: 'Geral', value: 'geral' },
        { label: 'Solo', value: 'solo' },
        { label: 'Dupla', value: 'dupla' },
        { label: 'Trio', value: 'trio' },
        { label: 'Quarteto', value: 'quarteto' },
      ];

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select-mode-bedwars')
        .setPlaceholder('Selecione um modo')
        .addOptions(modes);

      const row = new ActionRowBuilder().addComponents(selectMenu);

      // Stats padrão = Geral
      const embed = createEmbed(username, bedwarsStats, bedwarsStats, uniqueId, playTime, 'geral');

      const msg = await interaction.reply({
        embeds: [embed],
        components: [row]
      });

      const filter = i => i.customId === 'select-mode-bedwars' && i.user.id === interaction.user.id;
      const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

      collector.on('collect', async (i) => {
        const selectedMode = i.values[0];

        const stats = pickStatsByMode(selectedMode, bedwarsStats);

        const updatedEmbed = createEmbed(username, bedwarsStats, stats, uniqueId, playTime, selectedMode);
        await i.update({ embeds: [updatedEmbed], components: [row] });
      });

      collector.on('end', async () => {
        // Desativa o menu ao expirar
        try {
          const disabledMenu = StringSelectMenuBuilder.from(selectMenu).setDisabled(true);
          const disabledRow = new ActionRowBuilder().addComponents(disabledMenu);
          await interaction.editReply({ components: [disabledRow] });
        } catch {}
      });

      return msg;
    } catch (error) {
      console.error('Erro ao obter as estatísticas do jogador:', error?.message || error);
      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({
          content: '❌ Não foi possível obter as estatísticas do jogador.',
          ephemeral: true
        });
      }
      return interaction.editReply({
        content: '❌ Não foi possível obter as estatísticas do jogador.',
        components: [],
        embeds: []
      });
    }
  }
};

function pickStatsByMode(mode, bedwarsStats) {
  switch (mode) {
    case 'solo':
      return {
        beds_broken: bedwarsStats.solo_beds_broken,
        beds_lost: bedwarsStats.solo_beds_lost,
        kills: bedwarsStats.solo_kills,
        deaths: bedwarsStats.solo_deaths,
        assists: bedwarsStats.solo_assists,
        final_kills: bedwarsStats.solo_final_kills,
        final_deaths: bedwarsStats.solo_final_deaths,
        final_assists: bedwarsStats.solo_final_assists,
        wins: bedwarsStats.solo_wins,
        losses: bedwarsStats.solo_losses,
        games_played: bedwarsStats.solo_games_played,
        winstreak: bedwarsStats.solo_winstreak,
        max_winstreak: bedwarsStats.solo_max_winstreak,
      };

    case 'dupla':
      return {
        beds_broken: bedwarsStats.doubles_beds_broken,
        beds_lost: bedwarsStats.doubles_beds_lost,
        kills: bedwarsStats.doubles_kills,
        deaths: bedwarsStats.doubles_deaths,
        assists: bedwarsStats.doubles_assists,
        final_kills: bedwarsStats.doubles_final_kills,
        final_deaths: bedwarsStats.doubles_final_deaths,
        final_assists: bedwarsStats.doubles_final_assists,
        wins: bedwarsStats.doubles_wins,
        losses: bedwarsStats.doubles_losses,
        games_played: bedwarsStats.doubles_games_played,
        winstreak: bedwarsStats.doubles_winstreak,
        max_winstreak: bedwarsStats.doubles_max_winstreak,
      };

    case 'trio':
      return {
        beds_broken: bedwarsStats['3v3v3v3_beds_broken'],
        beds_lost: bedwarsStats['3v3v3v3_beds_lost'],
        kills: bedwarsStats['3v3v3v3_kills'],
        deaths: bedwarsStats['3v3v3v3_deaths'],
        assists: bedwarsStats['3v3v3v3_assists'],
        final_kills: bedwarsStats['3v3v3v3_final_kills'],
        final_deaths: bedwarsStats['3v3v3v3_final_deaths'],
        final_assists: bedwarsStats['3v3v3v3_final_assists'],
        wins: bedwarsStats['3v3v3v3_wins'],
        losses: bedwarsStats['3v3v3v3_losses'],
        games_played: bedwarsStats['3v3v3v3_games_played'],
        winstreak: bedwarsStats['3v3v3v3_winstreak'],
        max_winstreak: bedwarsStats['3v3v3v3_max_winstreak'],
      };

    case 'quarteto':
      return {
        beds_broken: bedwarsStats['4v4v4v4_beds_broken'],
        beds_lost: bedwarsStats['4v4v4v4_beds_lost'],
        kills: bedwarsStats['4v4v4v4_kills'],
        deaths: bedwarsStats['4v4v4v4_deaths'],
        assists: bedwarsStats['4v4v4v4_assists'],
        final_kills: bedwarsStats['4v4v4v4_final_kills'],
        final_deaths: bedwarsStats['4v4v4v4_final_deaths'],
        final_assists: bedwarsStats['4v4v4v4_final_assists'],
        wins: bedwarsStats['4v4v4v4_wins'],
        losses: bedwarsStats['4v4v4v4_losses'],
        games_played: bedwarsStats['4v4v4v4_games_played'],
        winstreak: bedwarsStats['4v4v4v4_winstreak'],
        max_winstreak: bedwarsStats['4v4v4v4_max_winstreak'],
      };

    default:
      return bedwarsStats;
  }
}

function createEmbed(username, bw, stats, uniqueId, playTimeSeconds, mode) {
  const kdr  = stats?.deaths ? (Number(stats.kills || 0) / Number(stats.deaths || 1)).toFixed(2) : '0.00';
  const wlr  = stats?.losses ? (Number(stats.wins || 0) / Number(stats.losses || 1)).toFixed(2) : '0.00';
  const fkdr = stats?.final_deaths ? (Number(stats.final_kills || 0) / Number(stats.final_deaths || 1)).toFixed(2) : '0.00';
  const bblr = stats?.beds_lost ? (Number(stats.beds_broken || 0) / Number(stats.beds_lost || 1)).toFixed(2) : '0.00';

  const hours = (Number(playTimeSeconds || 0) / 3600).toFixed(2);

  const modeTitle =
    mode === 'solo' ? 'Solo' :
    mode === 'dupla' ? 'Dupla' :
    mode === 'trio' ? 'Trio' :
    mode === 'quarteto' ? 'Quarteto' : 'Geral';

  const desc = [
    `• **Nível:** [${bw?.level ?? 0}✽]`,
    `• **XP:** ${(bw?.xp ?? 0).toLocaleString('pt-BR')} → [${(bw?.xp ?? 0) % 15000}/15000]`,
    ``,
    `• **Camas quebradas:** ${(stats?.beds_broken ?? 0).toLocaleString('pt-BR')}`,
    `• **Camas perdidas:** ${(stats?.beds_lost ?? 0).toLocaleString('pt-BR')}`,
    ``,
    `• **Abates:** ${(stats?.kills ?? 0).toLocaleString('pt-BR')}`,
    `• **Mortes:** ${(stats?.deaths ?? 0).toLocaleString('pt-BR')}`,
    `• **Assistências:** ${(stats?.assists ?? 0).toLocaleString('pt-BR')}`,
    ``,
    `• **Abates finais:** ${(stats?.final_kills ?? 0).toLocaleString('pt-BR')}`,
    `• **Mortes finais:** ${(stats?.final_deaths ?? 0).toLocaleString('pt-BR')}`,
    `• **Assistências finais:** ${(stats?.final_assists ?? 0_
