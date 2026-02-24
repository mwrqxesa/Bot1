const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('[Mush] Verifica se a API está online.'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const start = Date.now();
    try {
      const res = await axios.get('https://mush.com.br/api/player/UnknownPlayer123', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
      });
      const ms = Date.now() - start;

      // Mesmo sendo 404, se respondeu rápido, a API está “online”
      const ok = typeof res.data !== 'undefined';

      const embed = new EmbedBuilder()
        .setTitle('📡 Status da API Mush')
        .setColor(ok ? '#00ff7f' : '#ff5555')
        .setDescription([
          `\`•\` **Online:** ${ok ? 'Sim' : 'Não'}`,
          `\`•\` **Latência:** ${ms}ms`,
          `\`•\` **Endpoint testado:** /api/player/...`,
        ].join('\n'))
        .setFooter({ text: 'Desenvolvido por Lynn' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      const ms = Date.now() - start;

      const embed = new EmbedBuilder()
        .setTitle('📡 Status da API Mush')
        .setColor('#ff5555')
        .setDescription([
          `\`•\` **Online:** Não / instável`,
          `\`•\` **Latência:** ${ms}ms`,
          `\`•\` **Erro:** ${err?.code || 'Falha na requisição'}`,
        ].join('\n'))
        .setFooter({ text: 'Desenvolvido por Lynn' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }
  }
};
