const { SlashCommandBuilder } = require('discord.js');
const { baseEmbed } = require('../utils/embedBase');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Mostra informações do servidor.'),

  async execute(interaction) {
    const g = interaction.guild;
    if (!g) return interaction.reply({ content: '❌ Use em um servidor.', ephemeral: true });

    const created = `<t:${Math.floor(g.createdTimestamp / 1000)}:F>`;
    const embed = baseEmbed(`🏠 ServerInfo: ${g.name}`)
      .setThumbnail(g.iconURL({ size: 256 }))
      .setDescription([
        `\`•\` **ID:** ${g.id}`,
        `\`•\` **Criado em:** ${created}`,
        `\`•\` **Membros:** ${g.memberCount}`,
      ].join('\n'));

    return interaction.reply({ embeds: [embed] });
  }
};
