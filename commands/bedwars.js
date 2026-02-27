const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const axios = require('axios');

const MUSH_API = 'https://mush.com.br/api/player';

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function fmt(v) {
  return n(v).toLocaleString('pt-BR');
}

function ratio(a, b) {
  a = n(a);
  b = n(b);
  if (b <= 0) return '0.00';
  return (a / b).toFixed(2);
}

function getWinPercent(wins, games) {
  wins = n(wins);
  games = n(games);
  if (games <= 0) return '0.00';
  return ((wins / games) * 100).toFixed(2);
}

function modeLabel(mode) {
  switch (mode) {
    case 'solo': return 'Solo';
    case 'dupla': return 'Dupla';
    case 'trio': return 'Trio';
    case 'quarteto': return 'Quarteto';
    default: return 'Geral';
  }
}

function getModeStats(bedwarsStats, mode) {
  if (!bedwarsStats) return null;

  if (mode === 'geral') {
    return {
      beds_broken: n(bedwarsStats.beds_broken),
      beds_lost: n(bedwarsStats.beds_lost),
      kills: n(bedwarsStats.kills),
      deaths: n(bedwarsStats.deaths),
      assists: n(bedwarsStats.assists),
      final_kills: n(bedwarsStats.final_kills),
      final_deaths: n(bedwarsStats.final_deaths),
      final_assists: n(bedwarsStats.final_assists),
      wins: n(bedwarsStats.wins),
      losses: n(bedwarsStats.losses),
      games_played: n(bedwarsStats.games_played),
      winstreak: n(bedwarsStats.winstreak),
      max_winstreak: n(bedwarsStats.max_winstreak),
    };
  }

  if (mode === 'solo') {
    return {
      beds_broken: n(bedwarsStats.solo_beds_broken),
      beds_lost: n(bedwarsStats.solo_beds_lost),
      kills: n(bedwarsStats.solo_kills),
      deaths: n(bedwarsStats.solo_deaths),
      assists: n(bedwarsStats.solo_assists),
      final_kills: n(bedwarsStats.solo_final_kills),
      final_deaths: n(bedwarsStats.solo_final_deaths),
      final_assists: n(bedwarsStats.solo_final_assists),
      wins: n(bedwarsStats.solo_wins),
      losses: n(bedwarsStats.solo_losses),
      games_played: n(bedwarsStats.solo_games_played),
      winstreak: n(bedwarsStats.solo_winstreak),
      max_winstreak: n(bedwarsStats.solo_max_winstreak),
    };
  }

  if (mode === 'dupla') {
    return {
      beds_broken: n(bedwarsStats.doubles_beds_broken),
      beds_lost: n(bedwarsStats.doubles_beds_lost),
      kills: n(bedwarsStats.doubles_kills),
      deaths: n(bedwarsStats.doubles_deaths),
      assists: n(bedwarsStats.doubles_assists),
      final_kills: n(bedwarsStats.doubles_final_kills),
      final_deaths: n(bedwarsStats.doubles_final_deaths),
      final_assists: n(bedwarsStats.doubles_final_assists),
      wins: n(bedwarsStats.doubles_wins),
      losses: n(bedwarsStats.doubles_losses),
      games_played: n(bedwarsStats.doubles_games_played),
      winstreak: n(bedwarsStats.doubles_winstreak),
      max_winstreak: n(bedwarsStats.doubles_max_winstreak),
    };
  }

  if (mode === 'trio') {
    return {
      beds_broken: n(bedwarsStats['3v3v3v3_beds_broken']),
      beds_lost: n(bedwarsStats['3v3v3v3_beds_lost']),
      kills: n(bedwarsStats['3v3v3v3_kills']),
      deaths: n(bedwarsStats['3v3v3v3_deaths']),
      assists: n(bedwarsStats['3v3v3v3_assists']),
      final_kills: n(bedwarsStats['3v3v3v3_final_kills']),
      final_deaths: n(bedwarsStats['3v3v3v3_final_deaths']),
      final_assists: n(bedwarsStats['3v3v3v3_final_assists']),
      wins: n(bedwarsStats['3v3v3v3_wins']),
      losses: n(bedwarsStats['3v3v3v3_losses']),
      games_played: n(bedwarsStats['3v3v3v3_games_played']),
      winstreak: n(bedwarsStats['3v3v3v3_winstreak']),
      max_winstreak: n(bedwarsStats['3v3v3v3_max_winstreak']),
    };
  }

  if (mode === 'quarteto') {
    return {
      beds_broken: n(bedwarsStats['4v4v4v4_beds_broken']),
      beds_lost: n(bedwarsStats['4v4v4v4_beds_lost']),
      kills: n(bedwarsStats['4v4v4v4_kills']),
      deaths: n(bedwarsStats['4v4v4v4_deaths']),
      assists: n(bedwarsStats['4v4v4v4_assists']),
      final_kills: n(bedwarsStats['4v4v4v4_final_kills']),
      final_deaths: n(bedwarsStats['4v4v4v4_final_deaths']),
      final_assists: n(bedwarsStats['4v4v4v4_final_assists']),
      wins: n(bedwarsStats['4v4v4v4_wins']),
      losses: n(bedwarsStats['4v4v4v4_losses']),
      games_played: n(bedwarsStats['4v4v4v4_games_played']),
      winstreak: n(bedwarsStats['4v4v4v4_winstreak']),
      max_winstreak: n(bedwarsStats['4v4v4v4_max_winstreak']),
    };
  }

  return null;
}

function createModeSelect(currentMode = 'geral') {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('bedwars-mode-select')
      .setPlaceholder('Selecione um modo')
      .addOptions([
        { label: 'Geral', value: 'geral', default: currentMode === 'geral' },
        { label: 'Solo', value: 'solo', default: currentMode === 'solo' },
        { label: 'Dupla', value: 'dupla', default: currentMode === 'dupla' },
        { label: 'Trio', value: 'trio', default: currentMode === 'trio' },
        { label: 'Quarteto', value: 'quarteto', default: currentMode === 'quarteto' },
      ])
  );
}

function createEmbed({ username, uniqueId, bw, stats, playTimeSeconds, mode }) {
  const kdr = ratio(stats.deaths ? stats.kills : 0, stats.deaths);
  const wlr = ratio(stats.losses ? stats.wins : 0, stats.losses);
  const fkdr = ratio(stats.final_deaths ? stats.final_kills : 0, stats.final_deaths);
  const bblr = ratio(stats.beds_lost ? stats.beds_broken : 0, stats.beds_lost);
  const hours = (n(playTimeSeconds) / 3600).toFixed(2);
  const winPct = getWinPercent(stats.wins, stats.games_played);

  const xp = n(bw?.xp);
  const xpCurrent = xp % 15000;
  const xpMax = 15000;

  const desc = [
    `• **Nível:** [${n(bw?.level)}✽]`,
    `• **XP:** ${fmt(xp)} ➜ [${fmt(xpCurrent)}/${fmt(xpMax)}]`,
    ``,
    `• **Camas quebradas:** ${fmt(stats.beds_broken)}`,
    `• **Camas perdidas:** ${fmt(stats.beds_lost)}`,
    ``,
    `• **Abates:** ${fmt(stats.kills)}`,
    `• **Mortes:** ${fmt(stats.deaths)}`,
    `• **Assistências:** ${fmt(stats.assists)}`,
    ``,
    `• **Abates finais:** ${fmt(stats.final_kills)}`,
    `• **Mortes finais:** ${fmt(stats.final_deaths)}`,
    `• **Assistências finais:** ${fmt(stats.final_assists)}`,
    ``,
    `• **Vitórias:** ${fmt(stats.wins)} (${winPct}%)`,
    `• **Derrotas:** ${fmt(stats.losses)}`,
    `• **Partidas jogadas:** ${fmt(stats.games_played)}`,
    `• **Tempo online:** ${hours} horas`,
    ``,
    `• **Winstreak:** ${fmt(stats.winstreak)}`,
    `• **Maior Winstreak:** ${fmt(stats.max_winstreak)}`,
    ``,
    `• **KDR:** ${kdr}`,
    `• **WLR:** ${wlr}`,
    `• **FKDR:** ${fkdr}`,
    `• **BBLR:** ${bblr}`,
  ].join('\n');

  return new EmbedBuilder()
    .setTitle(`<:Caminha:1324521740411605002> • Bed Wars (${modeLabel(mode)}): ${username}`)
    .setColor('#2b2d31')
    .setThumbnail(uniqueId ? `https://visage.surgeplay.com/face/256/${uniqueId}` : null)
    .setDescription(desc)
    .setFooter({
      text: `Desenvolvido por Lynn | Hoje às ${new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      })}`,
    })
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bedwars')
    .setDescription('[Mush] Verifique as estatísticas de um jogador no Bed Wars.')
    .addStringOption(option =>
      option
        .setName('nick')
        .setDescription('Nome de usuário do jogador')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const usernameInput = interaction.options.getString('nick', true);

    let api;
    try {
      const response = await axios.get(`${MUSH_API}/${encodeURIComponent(usernameInput)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 20000,
      });
      api = response.data;
    } catch (err) {
      console.error('Erro ao consultar API Mush (bedwars):', err?.message || err);
      return interaction.editReply('❌ Não foi possível obter as estatísticas do jogador agora.');
    }

    if (!api?.success || !api?.response) {
      return interaction.editReply('❌ Jogador não encontrado. (Pode estar nicked.)');
    }

    const player = api.response;
    const account = player.account || {};
    const username = account.username || usernameInput;
    const uniqueId = account.unique_id || null;

    const bedwarsStats = player?.stats?.bedwars;
    const playTimeSeconds = player?.stats?.play_time?.bedwars || 0;

    if (!bedwarsStats) {
      return interaction.editReply(`❌ Não foi possível encontrar estatísticas de BedWars para **${username}**.`);
    }

    let currentMode = 'geral';
    const currentStats = getModeStats(bedwarsStats, currentMode);

    if (!currentStats) {
      return interaction.editReply('❌ Não foi possível carregar as estatísticas do modo selecionado.');
    }

    const embed = createEmbed({
      username,
      uniqueId,
      bw: bedwarsStats,
      stats: currentStats,
      playTimeSeconds,
      mode: currentMode,
    });

    const row = createModeSelect(currentMode);

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });

    const message = await interaction.fetchReply();

    const collector = message.createMessageComponentCollector({
      time: 60_000,
      filter: (i) =>
        i.customId === 'bedwars-mode-select' && i.user.id === interaction.user.id,
    });

    collector.on('collect', async (i) => {
      try {
        const selectedMode = i.values?.[0] || 'geral';
        const selectedStats = getModeStats(bedwarsStats, selectedMode);

        if (!selectedStats) {
          return i.update({
            content: '❌ Não foi possível carregar esse modo.',
            embeds: [],
            components: [],
          });
        }

        currentMode = selectedMode;

        const updatedEmbed = createEmbed({
          username,
          uniqueId,
          bw: bedwarsStats,
          stats: selectedStats,
          playTimeSeconds,
          mode: currentMode,
        });

        const updatedRow = createModeSelect(currentMode);

        await i.update({
          embeds: [updatedEmbed],
          components: [updatedRow],
        });
      } catch (err) {
        console.error('Erro no seletor de modo /bedwars:', err);
        if (!i.replied && !i.deferred) {
          await i.reply({ content: '❌ Ocorreu um erro ao trocar o modo.', ephemeral: true }).catch(() => {});
        }
      }
    });

    collector.on('end', async () => {
      try {
        await interaction.editReply({
          components: [],
        }).catch(() => {});
      } catch {}
    });
  },
};
