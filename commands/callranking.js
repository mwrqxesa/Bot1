const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { requireBotAdmin } = require('../utils/botPerms');

function formatMs(ms) {
  const totalSec = Math.floor((ms || 0) / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);

  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('callranking')
    .setDescription('Controle do ranking de call.')
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Mostra status do ranking de call')
    )
    .addSubcommand(sub =>
      sub
        .setName('atualizar')
        .setDescription('Força atualização do ranking agora')
    )
    .addSubcommand(sub =>
      sub
        .setName('exportar')
        .setDescription('Exporta o backup do ranking em JSON')
    )
    .addSubcommand(sub =>
      sub
        .setName('tempo')
        .setDescription('Mostra o tempo acumulado de call de um membro')
        .addUserOption(opt =>
          opt
            .setName('membro')
            .setDescription('Membro para consultar')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    if (!(await requireBotAdmin(interaction))) return;

    const sub = interaction.options.getSubcommand();
    const manager = interaction.client.callRanking;

    if (!manager) {
      return interaction.reply({
        content: '❌ CallRankingManager não está inicializado.',
        ephemeral: true
      });
    }

    // =========================
    // STATUS
    // =========================
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
          `\`•\` **Arquivo principal:** data/call_ranking.json`,
          `\`•\` **Backup:** data/call_ranking.backup.json`,
        ].join('\n'))
        .setFooter({ text: 'Desenvolvido por Lynn' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // =========================
    // ATUALIZAR
    // =========================
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

    // =========================
    // EXPORTAR
    // =========================
    if (sub === 'exportar') {
      await interaction.deferReply({ ephemeral: true });

      try {
        const payload = JSON.stringify(manager.data || { users: {}, rankingMessageId: null }, null, 2);
        const file = new AttachmentBuilder(Buffer.from(payload, 'utf8'), {
          name: 'call_ranking_export.json'
        });

        return interaction.editReply({
          content: '✅ Exportação do ranking de call:',
          files: [file]
        });
      } catch (err) {
        console.error('Erro ao exportar call ranking:', err);
        return interaction.editReply('❌ Não foi possível exportar o ranking.');
      }
    }

    // =========================
    // TEMPO
    // =========================
    if (sub === 'tempo') {
      const member = interaction.options.getUser('membro', true);
      const userId = member.id;

      const baseMs = manager.data?.users?.[userId]?.totalMs || 0;
      const liveMs = typeof manager.getLiveMs === 'function' ? manager.getLiveMs(userId) : 0;
      const totalMs = baseMs + liveMs;

      const isInCallNow = [...(manager.activeSessions?.keys?.() || [])].some(k => k.endsWith(`:${userId}`));

      const embed = new EmbedBuilder()
        .setTitle(`⏱️ Tempo em Call: ${member.username}`)
        .setColor('#0099ff')
        .setThumbnail(member.displayAvatarURL({ size: 256 }))
        .setDescription([
          `\`•\` **Tempo acumulado:** **${formatMs(totalMs)}**`,
          `\`•\` **Tempo salvo:** ${formatMs(baseMs)}`,
          `\`•\` **Sessão atual (ao vivo):** ${formatMs(liveMs)}`,
          `\`•\` **Em call agora:** ${isInCallNow ? 'Sim' : 'Não'}`,
        ].join('\n'))
        .setFooter({ text: 'Desenvolvido por Lynn' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
};
