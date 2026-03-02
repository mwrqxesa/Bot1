const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("horas")
    .setDescription("Gerencia ranking de horas em call")
    // opcional: restringir só admins
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName("transferir")
        .setDescription("Transfere X horas (ms) do usuário origem para o destino")
        .addUserOption((opt) =>
          opt
            .setName("origem")
            .setDescription("Quem vai perder as horas")
            .setRequired(true)
        )
        .addUserOption((opt) =>
          opt
            .setName("destino")
            .setDescription("Quem vai receber as horas")
            .setRequired(true)
        )
        .addNumberOption((opt) =>
          opt
            .setName("horas")
            .setDescription("Quantidade de horas para transferir (ex: 10 ou 10.5)")
            .setRequired(true)
            .setMinValue(0.01)
        )
    ),

  async execute(interaction) {
    try {
      const origem = interaction.options.getUser("origem", true);
      const destino = interaction.options.getUser("destino", true);
      const horas = interaction.options.getNumber("horas", true);

      if (origem.id === destino.id) {
        return interaction.reply({ content: "❌ Origem e destino não podem ser o mesmo usuário.", ephemeral: true });
      }

      // se quiser fixar só na Yakuza, descomente:
      // if (interaction.guildId !== process.env.CALL_RANKING_GUILD_ID) {
      //   return interaction.reply({ content: "❌ Esse comando só funciona no servidor configurado.", ephemeral: true });
      // }

      const guildId = String(interaction.guildId);
      const ms = Math.round(horas * 60 * 60 * 1000);

      // ✅ Pega o Pool do seu CallRankingManager (veja passo 2)
      const pool = interaction.client.callRanking?.pool;
      if (!pool) {
        return interaction.reply({
          content: "❌ Banco não inicializado (pool null). Verifique se o CallRankingManager conectou no Neon.",
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });

      // Transação segura
      await pool.query("BEGIN");

      // garante que ambos existem
      await pool.query(
        `INSERT INTO call_users (guild_id, user_id, username, total_ms)
         VALUES ($1,$2,$3,0)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET username = EXCLUDED.username`,
        [guildId, String(origem.id), origem.username]
      );

      await pool.query(
        `INSERT INTO call_users (guild_id, user_id, username, total_ms)
         VALUES ($1,$2,$3,0)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET username = EXCLUDED.username`,
        [guildId, String(destino.id), destino.username]
      );

      // checa saldo
      const res = await pool.query(
        `SELECT total_ms FROM call_users WHERE guild_id = $1 AND user_id = $2`,
        [guildId, String(origem.id)]
      );
      const origemMs = Number(res.rows?.[0]?.total_ms || 0);

      if (origemMs < ms) {
        await pool.query("ROLLBACK");
        return interaction.editReply(
          `❌ ${origem} não tem horas suficientes.\n` +
          `Disponível: ${(origemMs / 3600000).toFixed(2)}h | Tentou transferir: ${horas}h`
        );
      }

      // soma no destino
      await pool.query(
        `UPDATE call_users
         SET total_ms = total_ms + $1
         WHERE guild_id = $2 AND user_id = $3`,
        [ms, guildId, String(destino.id)]
      );

      // subtrai da origem
      await pool.query(
        `UPDATE call_users
         SET total_ms = total_ms - $1
         WHERE guild_id = $2 AND user_id = $3`,
        [ms, guildId, String(origem.id)]
      );

      await pool.query("COMMIT");

      // (opcional) forçar update do ranking na hora
      if (interaction.client.callRanking?.updateRankingMessage) {
        interaction.client.callRanking.updateRankingMessage().catch(() => {});
      }

      return interaction.editReply(
        `✅ Transferido **${horas}h** (${ms} ms)\n` +
        `De: ${origem}\nPara: ${destino}`
      );
    } catch (err) {
      try {
        const pool = interaction.client.callRanking?.pool;
        if (pool) await pool.query("ROLLBACK");
      } catch {}
      console.error("Erro /horas transferir:", err);
      return interaction.reply({ content: "❌ Erro ao transferir horas. Veja os logs.", ephemeral: true });
    }
  },
};
