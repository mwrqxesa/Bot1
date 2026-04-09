const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("clanmembros")
    .setDescription("Executa /clan membros <tag> no Minecraft e retorna no Discord.")
    .addStringOption((option) =>
      option
        .setName("tag")
        .setDescription("Tag do clan")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

  async execute(interaction) {
    const tag = interaction.options.getString("tag", true).trim();
    await interaction.deferReply({ ephemeral: true });

    const bridge = interaction.client.minecraftBridge;
    if (!bridge || !bridge.isReady()) {
      return interaction.editReply("❌ A ponte com Minecraft não está conectada no momento.");
    }

    try {
      const lines = await bridge.runGameCommandAndCollect(`/clan membros ${tag}`, {
        timeoutMs: 7000,
        maxLines: 12,
      });

      if (!lines.length) {
        return interaction.editReply("⚠️ Não recebi resposta do jogo a tempo. Tente novamente.");
      }

      return interaction.editReply(`✅ Resposta do jogo para **${tag}**:\n\n\`\`\`\n${lines.join("\n").slice(0, 1800)}\n\`\`\``);
    } catch (error) {
      return interaction.editReply(`❌ Falha ao executar no jogo: ${error.message}`);
    }
  },
};
