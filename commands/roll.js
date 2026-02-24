const { SlashCommandBuilder } = require('discord.js');
const { baseEmbed } = require('../utils/embedBase');

function parseDice(s) {
  // ex: 2d20
  const m = /^(\d{1,2})d(\d{1,4})$/i.exec((s || '').trim());
  if (!m) return null;
  const n = Math.max(1, Math.min(25, Number(m[1])));
  const faces = Math.max(2, Math.min(100000, Number(m[2])));
  return { n, faces };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Rola dados (ex: 1d20, 2d6).')
    .addStringOption(o => o.setName('dado').setDescription('Formato NdX').setRequired(true)),

  async execute(interaction) {
    const dice = parseDice(interaction.options.getString('dado', true));
    if (!dice) return interaction.reply({ content: '❌ Use formato tipo **2d20**.', ephemeral: true });

    const rolls = Array.from({ length: dice.n }, () => 1 + Math.floor(Math.random() * dice.faces));
    const sum = rolls.reduce((a, b) => a + b, 0);

    const embed = baseEmbed('🎲 Resultado')
      .setDescription([
        `\`•\` **Dados:** ${dice.n}d${dice.faces}`,
        `\`•\` **Rolagens:** ${rolls.join(', ')}`,
        `\`•\` **Soma:** **${sum}**`,
      ].join('\n'));

    return interaction.reply({ embeds: [embed] });
  }
};
