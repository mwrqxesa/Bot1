const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { isBotAdmin } = require('../utils/botPerms');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('limpar')
    .setDescription('Apaga uma quantidade de mensagens.')
    .addIntegerOption(opt =>
      opt.setName('quantidade')
        .setDescription('Quantidade (1 a 100)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    ),

  async execute(interaction) {
    const amount = interaction.options.getInteger('quantidade', true);

    const serverCan = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageMessages);
    const botAdmin = isBotAdmin(interaction.user.id);

    if (!serverCan && !botAdmin) {
      return interaction.reply({
        content: '🔒 Você precisa de **Gerenciar Mensagens** ou ser **admin do bot**.',
        ephemeral: true
      });
    }

    if (!interaction.channel || !interaction.channel.isTextBased()) {
      return interaction.reply({ content: '❌ Canal inválido.', ephemeral: true });
    }

    try {
      const deleted = await interaction.channel.bulkDelete(amount, true);

      return interaction.reply({
        content: `✅ Apaguei **${deleted.size}** mensagem(ns).`,
        ephemeral: true
      });
    } catch (err) {
      console.error('Erro no /limpar:', err);
      return interaction.reply({
        content: '❌ Não consegui apagar as mensagens. (Mensagens muito antigas não podem ser apagadas em massa.)',
        ephemeral: true
      });
    }
  }
};
