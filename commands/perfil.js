const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

function discordTs(ms, style = 'R') {
  if (!ms) return 'Desconhecido';
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('perfil')
    .setDescription('[Mush] Mostra um resumo do perfil do jogador.')
    .addStringOption(opt =>
      opt.setName('nick')
        .setDescription('Nick do jogador')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const nick = interaction.options.getString('nick', true);

    let player;
    try {
      const res = await axios.get(`https://mush.com.br/api/player/${encodeURIComponent(nick)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 15000
      });

      if (!res.data?.success || !res.data?.response) {
        return interaction.editReply(`❌ Não foi possível encontrar o jogador **${nick}**.`);
      }
      player = res.data.response;
    } catch {
      return interaction.editReply(`❌ Não foi possível encontrar o jogador **${nick}**.`);
    }

    const acc = player.account || {};
    const uniqueId = acc.unique_id;
    const username = acc.username || nick;

    const bw = player.stats?.bedwars || null;
    const sw = player.stats?.skywars_r1 || null;
    const duels = player.stats?.duels || null;

    const skinLink = uniqueId
      ? `[Clique aqui](https://visage.surgeplay.com/full/512/${uniqueId})`
      : 'N/A';

    const embed = new EmbedBuilder()
      .setTitle(`👤 Perfil: ${username}`)
      .setColor(player.profile_tag?.color || '#0099ff')
      .setThumbnail(uniqueId ? `https://visage.surgeplay.com/face/256/${uniqueId}` : null)
      .setDescription([
        `\`•\` **Rank:** ${player.rank_tag?.name || 'Nenhum'}`,
        `\`•\` **Clan:** ${player.clan ? `[${player.clan.tag}] ${player.clan.name}` : 'Nenhum'}`,
        `\`•\` **Online:** ${acc.connected ? 'Sim' : 'Não'}`,
        `\`•\` **Conta:** ${acc.type || 'N/A'}`,
        `\`•\` **Skin:** ${skinLink}`,
        ``,
        `\`•\` **Primeiro login:** ${discordTs(player.first_login, 'R')}`,
        `\`•\` **Último login:** ${discordTs(player.last_login, 'R')}`,
        ``,
        `\`•\` **Banido:** ${player.banned ? 'Sim' : 'Não'}`,
        `\`•\` **Silenciado:** ${player.muted ? 'Sim' : 'Não'}`,
      ].join('\n'))
      .addFields(
        {
          name: '🛏️ BedWars (geral)',
          value: bw
            ? [
                `• Nível: **${bw.level ?? 0}✽**`,
                `• Vitórias: **${(bw.wins ?? 0).toLocaleString('pt-BR')}**`,
                `• FK: **${(bw.final_kills ?? 0).toLocaleString('pt-BR')}**`,
                `• Camas: **${(bw.beds_broken ?? 0).toLocaleString('pt-BR')}**`,
              ].join('\n')
            : 'Sem dados.',
          inline: true
        },
        {
          name: '⭐ SkyWars (total)',
          value: sw
            ? [
                `• Nível: **${sw.level ?? 0}✫**`,
                `• Vitórias: **${(sw.wins ?? 0).toLocaleString('pt-BR')}**`,
                `• Kills: **${(sw.kills ?? 0).toLocaleString('pt-BR')}**`,
              ].join('\n')
            : 'Sem dados.',
          inline: true
        },
        {
          name: '⚔️ Duels (geral)',
          value: duels
            ? 'Dados disponíveis ✅'
            : 'Sem dados.',
          inline: true
        }
      )
      .setFooter({ text: 'Desenvolvido por Lynn' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }
};
