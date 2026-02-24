const { SlashCommandBuilder } = require('discord.js');
const { baseEmbed } = require('../utils/embedBase');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Mostra informações de um usuário.')
    .addUserOption(o => o.setName('usuario').setDescription('Usuário').setRequired(false)),

  async execute(interaction) {
    const user = interaction.options.getUser('usuario') || interaction.user;
    const member = interaction.guild ? await interaction.guild.members.fetch(user.id).catch(() => null) : null;

    const created = `<t:${Math.floor(user.createdTimestamp / 1000)}:F>`;
    const joined = member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : 'N/A';

    const embed = baseEmbed(`👤 UserInfo: ${user.username}`)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .setDescription([
        `\`•\` **ID:** ${user.id}`,
        `\`•\` **Criado em:** ${created}`,
        `\`•\` **Entrou no servidor:** ${joined}`,
        `\`•\` **Bot:** ${user.bot ? 'Sim' : 'Não'}`,
      ].join('\n'));

    return interaction.reply({ embeds: [embed] });
  }
};
