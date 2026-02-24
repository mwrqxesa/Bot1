const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

function safe(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}
function ratio(a, b) {
  a = safe(a); b = safe(b);
  if (b <= 0) return 0;
  return a / b;
}

async function fetchPlayer(nick) {
  try {
    const res = await axios.get(`https://mush.com.br/api/player/${encodeURIComponent(nick)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000
    });
    if (!res.data?.success || !res.data?.response) return null;
    return res.data.response;
  } catch {
    return null;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('matchup')
    .setDescription('[Mush] Compara 2 jogadores (BedWars geral) e diz quem leva vantagem.')
    .addStringOption(o => o.setName('player1').setDescription('Primeiro jogador').setRequired(true))
    .addStringOption(o => o.setName('player2').setDescription('Segundo jogador').setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();

    const p1Name = interaction.options.getString('player1', true);
    const p2Name = interaction.options.getString('player2', true);

    const [p1, p2] = await Promise.all([fetchPlayer(p1Name), fetchPlayer(p2Name)]);

    if (!p1) return interaction.editReply(`❌ Não foi possível encontrar **${p1Name}**.`);
    if (!p2) return interaction.editReply(`❌ Não foi possível encontrar **${p2Name}**.`);

    const bw1 = p1.stats?.bedwars;
    const bw2 = p2.stats?.bedwars;

    if (!bw1) return interaction.editReply(`❌ **${p1Name}** não possui stats de BedWars.`);
    if (!bw2) return interaction.editReply(`❌ **${p2Name}** não possui stats de BedWars.`);

    // Pontuação simples (ajustável)
    const score1 =
      safe(bw1.wins) * 2 +
      safe(bw1.final_kills) * 1.5 +
      safe(bw1.beds_broken) * 1.2 +
      ratio(bw1.final_kills, bw1.final_deaths || 1) * 100;

    const score2 =
      safe(bw2.wins) * 2 +
      safe(bw2.final_kills) * 1.5 +
      safe(bw2.beds_broken) * 1.2 +
      ratio(bw2.final_kills, bw2.final_deaths || 1) * 100;

    const winner =
      score1 === score2 ? 'Empate' :
      score1 > score2 ? p1Name : p2Name;

    const embed = new EmbedBuilder()
      .setTitle('⚔️ Matchup (BedWars Geral)')
      .setColor('#0099ff')
      .setDescription([
        `\`•\` **${p1Name}**:`,
        `- Vitórias: **${safe(bw1.wins).toLocaleString('pt-BR')}**`,
        `- FK: **${safe(bw1.final_kills).toLocaleString('pt-BR')}**`,
        `- Camas: **${safe(bw1.beds_broken).toLocaleString('pt-BR')}**`,
        `- FKDR: **${ratio(bw1.final_kills, bw1.final_deaths || 1).toFixed(2)}**`,
        ``,
        `\`•\` **${p2Name}**:`,
        `- Vitórias: **${safe(bw2.wins).toLocaleString('pt-BR')}**`,
        `- FK: **${safe(bw2.final_kills).toLocaleString('pt-BR')}**`,
        `- Camas: **${safe(bw2.beds_broken).toLocaleString('pt-BR')}**`,
        `- FKDR: **${ratio(bw2.final_kills, bw2.final_deaths || 1).toFixed(2)}**`,
        ``,
        `🏁 **Vantagem:** **${winner}**`,
      ].join('\n'))
      .setFooter({ text: 'Desenvolvido por Lynn' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }
};
