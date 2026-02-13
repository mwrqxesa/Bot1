const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nick')
    .setDescription('[Mush] Verifica se um nick existe (se não existir, provavelmente está nicked).')
    .addStringOption(option =>
      option.setName('nick')
        .setDescription('Nick para verificar')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const nick = interaction.options.getString('nick');

    try {
      const res = await axios.get(`https://mush.com.br/api/player/${encodeURIComponent(nick)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      const data = res.data;

      if (!data?.success || !data?.response?.account?.username) {
        return interaction.editReply(`❌ **${nick}** não foi encontrado. Provavelmente está **nicked**.`);
      }

      return interaction.editReply(`✅ **${data.response.account.username}** existe no Mush (não está nicked).`);
    } catch (e) {
      return interaction.editReply(`❌ **${nick}** não foi encontrado. Provavelmente está **nicked**.`);
    }
  }
};
