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
                .setRequired(true)),
    
    async execute(interaction) {
        console.log('Command executed:', interaction.commandName);
        const username = interaction.options.getString('nick');
        console.log('Username:', username);
        try {
            const response = await axios.get(`https://mush.com.br/api/player/${username}`);
            const data = response.data;

            console.log('Resposta da API:', data);

            if (!data || !data.response || !data.response.stats || !data.response.stats.bedwars) {
                throw new Error('Estatísticas não encontradas');
            }

            const bedwarsStats = data.response.stats.bedwars;
            const playTime = data.response.stats.play_time.bedwars;
            const modes = ['geral', 'solo', 'dupla', 'trio', 'quarteto'];

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select-mode')
                .setPlaceholder('Selecione um modo')
                .addOptions(modes.map(mode => ({
                    label: mode.charAt(0).toUpperCase() + mode.slice(1),
                    value: mode,
                })));

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const embed = createEmbed(username, bedwarsStats, bedwarsStats, data.response.account.unique_id, playTime);

            await interaction.reply({
  embeds: [embed],
  components: [buttons],
});

            });

            const filter = i => i.customId === 'select-mode' && i.user.id === interaction.user.id;
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

            collector.on('collect', async i => {
                const selectedMode = i.values[0];
                let stats;

                switch (selectedMode) {
                    case 'solo':
                        stats = {
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
                        break;
                    case 'dupla':
                        stats = {
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
                        break;
                    case 'trio':
                        stats = {
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
                        break;
                    case 'quarteto':
                        stats = {
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
                        break;
                    default:
                        stats = bedwarsStats;
                }

                if (!stats) {
await i.update({ embeds: [updatedEmbed], components: [updatedButtons] });
                    return;
                }

                const updatedEmbed = createEmbed(username, bedwarsStats, stats, data.response.account.unique_id, playTime, selectedMode);

                await i.update({ embeds: [updatedEmbed], components: [row] });
            });

            collector.on('end', collected => {
                if (collected.size === 0) {
                    interaction.editReply({ content: 'Tempo esgotado para selecionar um modo.', components: [] });
                }
            });
        } catch (error) {
            console.error('Erro ao obter as estatísticas do jogador:', error.message);
            if (!interaction.replied) {
                await interaction.reply('Não foi possível obter as estatísticas do jogador.');
            }
        }
    },
};

function createEmbed(username, bw, stats, uniqueId, playTimeSeconds) {
  const kdr  = stats.deaths ? (stats.kills / stats.deaths).toFixed(2) : '0.00';
  const wlr  = stats.losses ? (stats.wins / stats.losses).toFixed(2) : '0.00';
  const fkdr = stats.final_deaths ? (stats.final_kills / stats.final_deaths).toFixed(2) : '0.00';
  const bblr = stats.beds_lost ? (stats.beds_broken / stats.beds_lost).toFixed(2) : '0.00';

  const hours = (Number(playTimeSeconds || 0) / 3600).toFixed(2);

  const desc = [
    `• **Nível:** [${bw.level ?? 0}✽]`,
    `• **XP:** ${(bw.xp ?? 0).toLocaleString('pt-BR')} → [${(bw.xp ?? 0) % 15000}/15000]`,
    ``,
    `• **Camas quebradas:** ${(stats.beds_broken ?? 0).toLocaleString('pt-BR')}`,
    `• **Camas perdidas:** ${(stats.beds_lost ?? 0).toLocaleString('pt-BR')}`,
    ``,
    `• **Abates:** ${(stats.kills ?? 0).toLocaleString('pt-BR')}`,
    `• **Mortes:** ${(stats.deaths ?? 0).toLocaleString('pt-BR')}`,
    `• **Assistências:** ${(stats.assists ?? 0).toLocaleString('pt-BR')}`,
    ``,
    `• **Abates finais:** ${(stats.final_kills ?? 0).toLocaleString('pt-BR')}`,
    `• **Mortes finais:** ${(stats.final_deaths ?? 0).toLocaleString('pt-BR')}`,
    `• **Assistências finais:** ${(stats.final_assists ?? 0).toLocaleString('pt-BR')}`,
    ``,
    `• **Vitórias:** ${(stats.wins ?? 0).toLocaleString('pt-BR')}`,
    `• **Derrotas:** ${(stats.losses ?? 0).toLocaleString('pt-BR')}`,
    `• **Partidas jogadas:** ${(stats.games_played ?? 0).toLocaleString('pt-BR')}`,
    `• **Tempo online:** ${hours} horas`,
    ``,
    `• **Winstreak:** ${(stats.winstreak ?? 0).toLocaleString('pt-BR')}`,
    `• **Maior Winstreak:** ${(stats.max_winstreak ?? 0).toLocaleString('pt-BR')}`,
    ``,
    `• **KDR:** ${kdr}`,
    `• **WLR:** ${wlr}`,
    `• **FKDR:** ${fkdr}`,
    `• **BBLR:** ${bblr}`,
  ].join('\n');

  return new EmbedBuilder()
    .setTitle(`<:Caminha:1324521740411605002> • Bed Wars (Geral): ${username}`)
    .setColor('#2b2d31')
    .setThumbnail(`https://visage.surgeplay.com/face/256/${uniqueId}`)
    .setDescription(desc)
    .setFooter({ text: `Desenvolvido por Rezando | Hoje às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` });
}
        .setTimestamp();
}
