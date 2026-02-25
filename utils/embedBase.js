const { EmbedBuilder } = require('discord.js');

const LYNN_ICON =
  'https://cdn.discordapp.com/avatars/826501596702965850/813268a3df7c76fe40f082f459f08da6.png?size=2048';

function baseEmbed(title) {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor('#0099ff')
    .setFooter({ text: 'Desenvolvido por Lynn', iconURL: LYNN_ICON })
    .setTimestamp();
}

module.exports = { baseEmbed, LYNN_ICON };
