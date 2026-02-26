const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireBotAdmin, requireBotOwner } = require('../utils/botPerms');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('callranking')
    .setDescription('Controle do ranking de call.')
    .addSubcommand(sub =>
      sub.setName('status').setDescription('Mostra status do ranking de call')
    )
    .addSubcommand(sub =>
      sub.setName('atualizar').setDescription('Força atualização do ranking agora')
    )
    .addSubcommand(sub =>
      sub.setName('reset').setDescription('Zera o ranking de call (somente dona do bot)')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const manager = interaction.client.callRanking;

    if (!manager) {
      return interaction.reply({
        content: '❌ CallRankingManager não está inicializado.',
        ephemeral: true
      });
    }

    // Permissões por subcomando
    if (sub === 'status' || sub === 'atualizar') {
      if (!(await requireBotAdmin(interaction))) return;
    }

    if (sub === 'reset') {
      if (!(await requireBotOwner(interaction))) return;
    }

    if (sub === 'status') {
      const embed = new EmbedBuilder()
        .setTitle('📞 Status do Call Ranking')
        .setColor('#0099ff')
        .setDescription([
          `\`•\` **Guild ID:** ${manager.targetGuildId || 'Não configurado'}`,
          `\`•\` **Canal ID:** ${manager.targetChannelId || 'Não configurado'}`,
          `\`•\` **Mensagem ID:** ${manager.data?.rankingMessageId || 'Nenhuma'}`,
          `\`•\` **Sessões ativas:** ${manager.activeSessions?.size ?? 0}`,
          `\`•\` **Usuários registrados:** ${Object.keys(manager.data?.users || {}).length}`,
          `\`•\` **Intervalo:** 5 minutos`,
        ].join('\n'))
        .setFooter({ text: 'Desenvolvido por Lynn' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'atualizar') {
      await interaction.deferReply({ ephemeral: true });

      try {
        await manager.updateRankingMessage();
        return interaction.editReply('✅ Ranking de call atualizado manualmente.');
      } catch (err) {
        console.error('Erro ao atualizar call ranking manualmente:', err);
        return interaction.editReply('❌ Não foi possível atualizar o ranking agora.');
      }
    }

    if (sub === 'reset') {
      // reseta dados e força nova mensagem na próxima atualização
      manager.data.users = {};
      manager.data.rankingMessageId = null;
      manager.activeSessions.clear();
      manager.save();

      return interaction.reply({
        content: '✅ Ranking de call resetado com sucesso.',
        ephemeral: true
      });
    }
  }
};
