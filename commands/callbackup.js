const { SlashCommandBuilder, AttachmentBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('callbackup')
    .setDescription('Gera um backup do ranking de call e envia no seu privado.'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    // ✅ (Opcional) Restrição para administrador
    // Se quiser liberar pra todos, pode remover este bloco.
    if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.editReply('❌ Você precisa ser **Administrador** para usar este comando.');
    }

    const manager = interaction.client.callRanking;
    if (!manager) {
      return interaction.editReply('❌ Sistema de ranking de call não está disponível.');
    }

    // Confirma se o método existe (segurança)
    if (typeof manager.createManualBackupPayload !== 'function') {
      return interaction.editReply('❌ O sistema de backup manual não está disponível neste momento.');
    }

    try {
      const payload = await manager.createManualBackupPayload();

      const attachment = new AttachmentBuilder(payload.buffer, {
        name: payload.fileName,
      });

      try {
        await interaction.user.send({
          content: '📦 **Backup do ranking de call**\nAqui está o arquivo solicitado:',
          files: [attachment],
        });

        return interaction.editReply('✅ Backup enviado no seu privado (DM).');
      } catch (dmError) {
        console.error('[callbackup] Erro ao enviar DM:', dmError);

        return interaction.editReply(
          '❌ Não consegui te enviar mensagem no privado.\n' +
          'Verifique se suas DMs estão abertas para membros do servidor.'
        );
      }
    } catch (error) {
      console.error('[callbackup] Erro ao gerar backup:', error);
      return interaction.editReply('❌ Ocorreu um erro ao gerar o backup.');
    }
  },
};
