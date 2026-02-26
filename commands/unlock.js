const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { isBotAdmin } = require('../utils/botPerms');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Destranca o canal atual para @everyone.')
    .addStringOption(opt =>
      opt.setName('motivo')
        .setDescription('Motivo do unlock')
        .setRequired(false)
    ),

  async execute(interaction) {
    const serverCan = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageChannels);
    const botAdmin = isBotAdmin(interaction.user.id);

    if (!serverCan && !botAdmin) {
      return interaction.reply({
        content: '🔒 Você precisa de **Gerenciar Canais** ou ser **admin do bot**.',
        ephemeral: true
      });
    }

    const channel = interaction.channel;
    if (!channel || !channel.isTextBased()) {
      return interaction.reply({ content: '❌ Canal inválido.', ephemeral: true });
    }

    const everyone = interaction.guild.roles.everyone;
    const motivo = interaction.options.getString('motivo') || 'Sem motivo informado';

    try {
      await channel.permissionOverwrites.edit(everyone, {
        SendMessages: null, // volta para padrão/herdado
      });

      return interaction.reply({
        content: `🔓 Canal destrancado. **Motivo:** ${motivo}`,
      });
    } catch (err) {
      console.error('Erro no /unlock:', err);
      return interaction.reply({
        content: '❌ Não consegui destrancar o canal.',
        ephemeral: true
      });
    }
  }
};
