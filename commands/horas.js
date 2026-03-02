const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

function formatUnit(unidade) {
  return unidade === "minutes" ? "minutos" : "horas";
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("horas")
    .setDescription("Sistema de horas em call (Yakuza).")
    .addSubcommand((sub) =>
      sub
        .setName("ver")
        .setDescription("Ver horas de um usuário (inclui tempo ao vivo).")
        .addUserOption((opt) =>
          opt.setName("usuario").setDescription("Usuário para consultar.").setRequired(false)
        )
        .addBooleanOption((opt) =>
          opt
            .setName("atualizar")
            .setDescription("Se true, materializa o tempo ao vivo no banco antes de mostrar.")
            .setRequired(false)
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
            .setDescription("Quantidade (ex: 2.5 horas ou 150 minutos).")
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
    .addSubcommand((sub) =>
      sub
        .setName("adicionar")
        .setDescription("Adicionar horas/minutos manualmente a um usuário (migração/ajuste).")
        .addUserOption((opt) =>
          opt.setName("usuario").setDescription("Quem vai receber o tempo.").setRequired(true)
        )
        .addNumberOption((opt) =>
          opt
            .setName("quantidade")
            .setDescription("Quantidade (ex: 98.16 horas ou 120 minutos).")
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
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const cr = interaction.client.callRanking;

    if (!cr?.enabled) {
      return interaction.reply({ content: "❌ Ranking/DB não está ativo agora.", ephemeral: true });
    }

    // trava pra Yakuza
    if (String(interaction.guildId) !== String(cr.targetGuildId)) {
      return interaction.reply({
        content: "❌ Este comando só pode ser usado na **Yakuza**.",
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();

    // =========================
    // /horas ver
    // =========================
    if (sub === "ver") {
      const user = interaction.options.getUser("usuario") || interaction.user;
      const atualizar = interaction.options.getBoolean("atualizar") || false;

      try {
        // garante registro
        await cr.touchUser(interaction.guildId, user);

        // opcionalmente materializa live no banco (zera “ao vivo”)
        let flushed = 0;
        if (atualizar) {
          flushed = await cr.flushLiveSessionToDb(interaction.guildId, user.id);
        }

        const ms = await cr.getUserTotalMs(interaction.guildId, user.id);
        const hours = ms / 1000 / 60 / 60;

        return interaction.reply({
          content:
            `⏱️ <@${user.id}> tem **${hours.toFixed(2)} horas** (**${cr.formatMs(ms)}**) em call.\n` +
            (atualizar ? `✅ Atualizado no banco agora (materializado **${cr.formatMs(flushed)}** ao vivo).` : ""),
          ephemeral: false,
        });
      } catch (e) {
        return interaction.reply({
          content: `❌ Falha ao consultar: ${e?.message || e}`,
          ephemeral: true,
        });
      }
    }

    // =========================
    // /horas transferir
    // =========================
    if (sub === "transferir") {
      const fromUser = interaction.options.getUser("de");
      const toUser = interaction.options.getUser("para");
      const quantidade = interaction.options.getNumber("quantidade");
      const unidade = interaction.options.getString("unidade");

      // evita transferir para si mesmo
      if (String(fromUser.id) === String(toUser.id)) {
        return interaction.reply({ content: "❌ Não pode transferir para si mesmo.", ephemeral: true });
      }

      try {
        await interaction.deferReply({ ephemeral: false });

        // Antes (já considerando live)
        await cr.touchUser(interaction.guildId, fromUser);
        await cr.touchUser(interaction.guildId, toUser);

        const beforeFrom = await cr.getUserTotalMs(interaction.guildId, fromUser.id);
        const beforeTo = await cr.getUserTotalMs(interaction.guildId, toUser.id);

        // ✅ transferência já faz flush live + transação no DB (pelo manager)
        const ms = await cr.transferTime(interaction.guildId, fromUser, toUser, quantidade, unidade);

        // Depois
        const afterFrom = await cr.getUserTotalMs(interaction.guildId, fromUser.id);
        const afterTo = await cr.getUserTotalMs(interaction.guildId, toUser.id);

        // atualiza embed
        await cr.updateRankingMessage().catch(() => {});

        return interaction.editReply({
          content:
            `✅ Transferido **${cr.formatMs(ms)}** de ${fromUser} para ${toUser}.\n` +
            `📌 Unidade: **${formatUnit(unidade)}** (${quantidade})\n\n` +
            `**Antes → Depois**\n` +
            `- ${fromUser}: **${cr.formatMs(beforeFrom)}** → **${cr.formatMs(afterFrom)}**\n` +
            `- ${toUser}: **${cr.formatMs(beforeTo)}** → **${cr.formatMs(afterTo)}**`,
        });
      } catch (e) {
        const msg = `❌ Falha ao transferir: ${e?.message || e}`;
        if (interaction.deferred || interaction.replied) {
          return interaction.editReply({ content: msg });
        }
        return interaction.reply({ content: msg, ephemeral: true });
      }
    }

    // =========================
    // /horas adicionar
    // =========================
    if (sub === "adicionar") {
      const user = interaction.options.getUser("usuario");
      const quantidade = interaction.options.getNumber("quantidade");
      const unidade = interaction.options.getString("unidade");

      try {
        await interaction.deferReply({ ephemeral: false });

        await cr.touchUser(interaction.guildId, user);

        // materializa live antes, pra não confundir “antes/depois”
        await cr.flushLiveSessionToDb(interaction.guildId, user.id).catch(() => {});

        const before = await cr.getUserTotalMs(interaction.guildId, user.id);
        const ms = await cr.addTimeToUser(interaction.guildId, user.id, user.username, quantidade, unidade);
        const after = await cr.getUserTotalMs(interaction.guildId, user.id);

        await cr.updateRankingMessage().catch(() => {});

        return interaction.editReply({
          content:
            `✅ Adicionado **${cr.formatMs(ms)}** para ${user}.\n` +
            `📌 Unidade: **${formatUnit(unidade)}** (${quantidade})\n` +
            `**Antes → Depois:** **${cr.formatMs(before)}** → **${cr.formatMs(after)}**`,
        });
      } catch (e) {
        const msg = `❌ Falha ao adicionar: ${e?.message || e}`;
        if (interaction.deferred || interaction.replied) {
          return interaction.editReply({ content: msg });
        }
        return interaction.reply({ content: msg, ephemeral: true });
      }
    }
  },
};
