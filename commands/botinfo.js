const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const LYNN_ICON =
  'https://cdn.discordapp.com/avatars/826501596702965850/813268a3df7c76fe40f082f459f08da6.png?size=2048';

function formatUptime(ms) {
  const totalSec = Math.floor((ms || 0) / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('botinfo')
    .setDescription('Informações sobre o bot.'),

  async execute(interaction) {
    const client = interaction.client;

    const ping = Math.round(client.ws.ping);
    const uptime = formatUptime(client.uptime);

    const guilds = client.guilds.cache.size;
    const users = client.users.cache.size;

    const embed = new EmbedBuilder()
      .setTitle('🤖 Informações do Bot')
      .setColor('#0099ff')
      .setDescription([
        `\`•\` **Linguagem:** JavaScript (Node.js)`,
        `\`•\` **Biblioteca:** discord.js`,
        `\`•\` **Ping:** ${ping}ms`,
        `\`•\` **Uptime:** ${uptime}`,
        `\`•\` **Servidores:** ${guilds}`,
        `\`•\` **Usuários (cache):** ${users}`,
        ``,
        `\`•\` **Documentações:**`,
        `- [JavaScript (MDN)](https://developer.mozilla.org/docs/Web/JavaScript)`,
        `- [Node.js](https://nodejs.org/en/docs)`,
        `- [discord.js](https://discord.js.org/#/docs)`
      ].join('\n'))
      .setFooter({ text: 'Desenvolvido por Lynn', iconURL: LYNN_ICON })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Me Adicione')
        .setURL('https://discord.com/oauth2/authorize?client_id=1324388124595589152&permissions=8&integration_type=0&scope=bot')
        .setStyle(ButtonStyle.Link)
    );

    return interaction.reply({
      embeds: [embed],
      components: [row]
    });
  }
};
