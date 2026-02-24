const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { baseEmbed } = require('../utils/embedBase');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Mostra o avatar de um usuário em alta qualidade.')
    .addUserOption(o => o.setName('usuario').setDescription('Usuário').setRequired(false)),

  async execute(interaction) {
    const user = interaction.options.getUser('usuario') || interaction.user;
    const url = user.displayAvatarURL({ size: 2048, extension: 'png' });

    const embed = baseEmbed(`🖼️ Avatar de ${user.username}`)
      .setImage(url);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Abrir').setStyle(ButtonStyle.Link).setURL(url)
    );

    return interaction.reply({ embeds: [embed], components: [row] });
  }
};
