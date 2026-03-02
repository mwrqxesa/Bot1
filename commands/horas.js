const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("horas")
    .setDescription("Sistema de horas em call (Yakuza).")
    .addSubcommand((sub) =>
      sub
        .setName("ver")
        .setDescription("Ver horas de um usuário.")
        .addUserOption((opt) =>
          opt.setName("usuario").setDescription("Usuário para consultar.").setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("transferir")
        .setDescription("Transferir horas/minutos de uma pessoa para outra.")
        .addUserOption((opt) =>
          opt.setName("de").setDescription("Quem vai transferir.").setRequired(true)
        )
        .addUserOption((opt) =>
          opt.setName("para").setDescription("Quem vai receber.").setRequired(true)
        )
        .addNumberOption((opt) =>
          opt
            .setName("quantidade")
            .setDescription("Quantidade (ex: 2.5 ou 150).")
            .setRequired(true)
            .setMinValue(0.01)
        )
        .addStringOption((opt) =>
          opt
            .setName("unidade")
            .setDescription("Escolha se a quantidade é horas ou minutos.")
            .setRequired(true)
            .addChoices(
              { name: "horas", value: "hours" },
              { name: "minutos", value: "minutes" }
            )
        )
    )
    // 🔒 recomendo admin only
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const cr = interaction.client.callRanking;

    if (!cr?.enabled) {
      return interaction.reply({ content: "❌ Ranking/DB não está ativo agora.", ephemeral: true });
    }

    // ✅ trava pra Yakuza (igual seu ranking)
    if (String(interaction.guildId) !== String(cr.targetGuildId)) {
      return interaction.reply({
        content: "❌ Este comando só pode ser usado na **Yakuza**.",
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === "ver") {
      const user = interaction.options.getUser("usuario") || interaction.user;
      const ms = await cr.getUserTotalMs(interaction.guildId, user.id);
      const hours = ms / 1000 / 60 / 60;

      return interaction.reply({
        content: `⏱️ <@${user.id}> tem **${hours.toFixed(2)} horas** (**${cr.formatMs(ms)}**) em call (Yakuza).`,
        ephemeral: false,
      });
    }

    if (sub === "transferir") {
      const fromUser = interaction.options.getUser("de");
      const toUser = interaction.options.getUser("para");
      const quantidade = interaction.options.getNumber("quantidade");
      const unidade = interaction.options.getString("unidade");

      try {
        const ms = await cr.transferTime(interaction.guildId, fromUser, toUser, quantidade, unidade);

        // atualiza embed logo após
        await cr.updateRankingMessage().catch(() => {});

        return interaction.reply({
          content:
            `✅ Transferido **${cr.formatMs(ms)}** de ${fromUser} para ${toUser}.\n` +
            `📌 Unidade: **${unidade === "minutes" ? "minutos" : "horas"}** (${quantidade})`,
          ephemeral: false,
        });
      } catch (e) {
        return interaction.reply({
          content: `❌ Falha ao transferir: ${e?.message || e}`,
          ephemeral: true,
        });
      }
    }
  },
};
