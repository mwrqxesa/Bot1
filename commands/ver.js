const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

function discordTs(ms, style = 'R') {
  if (!ms) return 'Desconhecido';
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ver')
    .setDescription('[Mush] Mostra principais dados da conta (ban/mute/tempo/infos).')
    .addStringOption(option =>
      option
        .setName('nick')
        .setDescription('Nick do jogador')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const nick = interaction.options.getString('nick');

    let player;
    try {
      const res = await axios.get(`https://mush.com.br/api/player/${encodeURIComponent(nick)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      if (!res.data?.success || !res.data?.response) {
        return interaction.editReply('❌ Jogador não encontrado. (Pode estar nicked.)');
      }

      player = res.data.response;
    } catch {
      return interaction.editReply('❌ Jogador não encontrado. (Pode estar nicked.)');
    }

    // Parkour (opcional)
    let parkourRecord = 'Nenhum';
    try {
      const park = await axios.get(`https://mush.com.br/api/player/name/${encodeURIComponent(nick)}/parkour`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      if (park.data?.success && park.data?.response) {
        parkourRecord = park.data.response?.record ?? park.data.response?.bedwars ?? 'Nenhum';
      }
    } catch {}

    const acc = player.account || {};
    const uniqueId = acc.unique_id;
    const username = acc.username || nick;

    // Link clicável da skin (texto azul "Clique aqui")
    // Você pode trocar "full" por "face" se quiser só rosto:
    // https://visage.surgeplay.com/face/512/${uniqueId}
    const skinUrl = uniqueId ? `https://visage.surgeplay.com/full/512/${uniqueId}` : null;
    const skinText = skinUrl ? `[Clique aqui](${skinUrl})` : 'N/A';

    const clanText = player.clan ? `[${player.clan.tag}] ${player.clan.name}` : 'Nenhum';
    const friendsText = player.friends ? `${player.friends.count}/${player.friends.limit}` : '0/0';

    const embed = new EmbedBuilder()
      .setTitle(`📌 Menu: ${username}`)
      .setColor(player.profile_tag?.color || '#0099ff')
      .setThumbnail(uniqueId ? `https://visage.surgeplay.com/face/256/${uniqueId}` : null)
      .setDescription([
        `\`•\` **Rank**: ${player.rank_tag?.name || 'Nenhum'}`,
        `\`•\` **Tag de Perfil**: ${player.profile_tag?.name || 'Nenhuma'}`,
        `\`•\` **Conta**: ${acc.type || 'N/A'}`,
        `\`•\` **Online**: ${player.connected ? 'Sim' : 'Não'}`,
        `\`•\` **Clan**: ${clanText}`,
        `\`•\` **Amigos**: ${friendsText}`,
        `\`•\` **Skin**: ${skinText}`,
        ``,
        `\`•\` **Recorde do Parkour**: ${parkourRecord}`,
        `\`•\` **Primeiro login**: ${discordTs(player.first_login, 'R')}`,
        `\`•\` **Último login**: ${discordTs(player.last_login, 'R')}`,
        ``,
        `\`•\` **Banido**: ${player.banned ? 'Sim' : 'Não'}`,
        `\`•\` **Silenciado**: ${player.muted ? 'Sim' : 'Não'}`,
        `\`•\` **Bans para Blacklist (#)**: ${Number(player.ban_blacklist_count || 0)}/3`,
        `\`•\` **Contagem de Mutes (#)**: ${Number(player.mute_blacklist_count || 0)}`
      ].join('\n'))
      .setFooter({
        text: 'Desenvolvido por Lynn',
        iconURL: 'https://cdn.discordapp.com/avatars/826501596702965850/813268a3df7c76fe40f082f459f08da6.png?size=2048'
      })
      .setTimestamp();

    // Sem "Entre no servidor..." — apenas o embed
    return interaction.editReply({
      embeds: [embed]
    });
  }
};
