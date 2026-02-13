const {
  SlashCommandBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
} = require('discord.js');
const axios = require('axios');

const GAME = 'bedwars';

// 1) Modos (ajuste os values se sua API usar outros)
const MODES = [
  { label: 'Geral', value: 'overall' },
  { label: 'Solo', value: 'solo' },
  { label: 'Dupla', value: 'doubles' },
  { label: 'Trio', value: '3v3v3v3' },
  { label: 'Quarteto', value: '4v4v4v4' },
];

// 2) Categorias (ajuste/adicione as que sua API suportar)
const CATEGORIES = [
  { label: 'Nível (XP)', value: 'level' },
  { label: 'Vitórias', value: 'wins' },
  { label: 'Winstreak', value: 'winstreak' },
  { label: 'Abates finais', value: 'final_kills' },
  { label: 'Abates', value: 'kills' },
  { label: 'Camas quebradas', value: 'beds_broken' },
];

// 3) Top (quantidade)
const TOPS = [
  { label: 'Top 10', value: '10' },
  { label: 'Top 25', value: '25' },
  { label: 'Top 50', value: '50' },
  { label: 'Top 100', value: '100' },
];

// Títulos bonitos
function titleFor(mode, category, top) {
  const modeName = MODES.find(m => m.value === mode)?.label ?? 'Geral';
  const catName = CATEGORIES.find(c => c.value === category)?.label ?? category;
  return `🏆 Ranking BedWars — ${catName} (${modeName}) • Top ${top}`;
}

// Remove códigos de cor (&a, &b, etc.)
function stripColors(text = '') {
  return String(text).replace(/&[0-9a-fk-or]/gi, '');
}

/**
 * Monta o endpoint. Aqui é a parte que pode variar conforme a API.
 * Hoje você usa: /api/leaderboards/bedwars/${type}
 *
 * Vou tentar suportar modos assim:
 * - overall -> /bedwars/${category}
 * - solo/doubles/3v3v3v3/4v4v4v4 -> /bedwars/${mode}_${category}
 *
 * Se a API do Mush for diferente, me manda 1 exemplo de URL que funcione
 * para SOLO ou QUARTETO que eu ajusto em 1 minuto.
 */
function buildUrl(mode, category) {
  if (mode === 'overall') {
    return `https://mush.com.br/api/leaderboards/${GAME}/${category}`;
  }
  return `https://mush.com.br/api/leaderboards/${GAME}/${mode}_${category}`;
}

function formatStatLine(category, player) {
  // Alguns campos comuns
  const badge = stripColors(player.level_badge?.format || '');
  const xp = Number(player.xp || 0);

  // A API pode devolver o valor já na chave do category
  // Ex: player.wins, player.kills, player.beds_broken...
  const val = Number(player[category] || 0);

  switch (category) {
    case 'level':
      return `${badge ? `${badge} • ` : ''}XP: **${xp.toLocaleString('pt-BR')}**`;
    case 'wins':
      return `Vitórias: **${val.toLocaleString('pt-BR')}**`;
    case 'winstreak':
      return `Winstreak: **${val.toLocaleString('pt-BR')}**`;
    case 'final_kills':
      return `Abates finais: **${val.toLocaleString('pt-BR')}**`;
    case 'kills':
      return `Abates: **${val.toLocaleString('pt-BR')}**`;
    case 'beds_broken':
      return `Camas quebradas: **${val.toLocaleString('pt-BR')}**`;
    default:
      return `Valor: **${val.toLocaleString('pt-BR')}**`;
  }
}

async function createLeaderboardEmbed(mode, category, top) {
  const url = buildUrl(mode, category);

  let res;
  try {
    res = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000
    });
  } catch (e) {
    // Se a combinação não existir na API
    return new EmbedBuilder()
      .setTitle(titleFor(mode, category, top))
      .setColor('#2b2d31')
      .setDescription(
        `❌ Esse ranking não está disponível na API.\n\n` +
        `• **Modo:** ${MODES.find(m => m.value === mode)?.label}\n` +
        `• **Categoria:** ${CATEGORIES.find(c => c.value === category)?.label}\n` +
        `• **Top:** ${top}\n\n` +
        `Se você me mandar uma URL do Mush que funcione pra esse modo/categoria, eu ajusto o endpoint certinho.`
      )
      .setTimestamp();
  }

  const list = Array.isArray(res.data) ? res.data : (res.data?.response ?? []);
  const n = Math.max(1, Math.min(Number(top || 10), 100));
  const players = list.slice(0, n);

  if (!players.length) {
    return new EmbedBuilder()
      .setTitle(titleFor(mode, category, top))
      .setColor('#2b2d31')
      .setDescription('❌ Nenhum dado retornado pela API para esse ranking.')
      .setTimestamp();
  }

  const desc = players.map((p, idx) => {
    const username = p.username || p.name || 'Desconhecido';
    return `**#${idx + 1}** ${username}\n➥ ${formatStatLine(category, p)}`;
  }).join('\n\n');

  return new EmbedBuilder()
    .setTitle(titleFor(mode, category, top))
    .setColor('#2b2d31')
    .setDescription(desc)
    .setFooter({
      text: 'Desenvolvido por Rezando',
      iconURL: 'https://cdn.discordapp.com/avatars/1283948475742031912/fb0b536e1dad49337d09d5d67504a8b2.png'
    })
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('[Mush] Veja os rankings do BedWars (modo + categoria + top).'),

  async execute(interaction) {
    await interaction.deferReply();

    // Estado inicial
    let mode = 'overall';
    let category = 'level';
    let top = '10';

    // Menus
    const modeMenu = new StringSelectMenuBuilder()
      .setCustomId('lb_mode')
      .setPlaceholder('Selecione o modo')
      .addOptions(MODES);

    const catMenu = new StringSelectMenuBuilder()
      .setCustomId('lb_category')
      .setPlaceholder('Selecione a categoria')
      .addOptions(CATEGORIES);

    const topMenu = new StringSelectMenuBuilder()
      .setCustomId('lb_top')
      .setPlaceholder('Selecione o Top')
      .addOptions(TOPS);

    const row1 = new ActionRowBuilder().addComponents(modeMenu);
    const row2 = new ActionRowBuilder().addComponents(catMenu);
    const row3 = new ActionRowBuilder().addComponents(topMenu);

    // Primeiro embed
    let embed = await createLeaderboardEmbed(mode, category, top);

    await interaction.editReply({
      embeds: [embed],
      components: [row1, row2, row3]
    });

    const filter = i =>
      ['lb_mode', 'lb_category', 'lb_top'].includes(i.customId) &&
      i.user.id === interaction.user.id;

    const collector = interaction.channel.createMessageComponentCollector({ filter, time: 90000 });

    collector.on('collect', async (i) => {
      try {
        if (i.customId === 'lb_mode') mode = i.values[0];
        if (i.customId === 'lb_category') category = i.values[0];
        if (i.customId === 'lb_top') top = i.values[0];

        embed = await createLeaderboardEmbed(mode, category, top);

        await i.update({
          embeds: [embed],
          components: [row1, row2, row3]
        });
      } catch (err) {
        console.error('Erro no collector leaderboard:', err);
        try {
          await i.reply({ content: '❌ Erro ao atualizar o ranking.', ephemeral: true });
        } catch {}
      }
    });

    collector.on('end', async () => {
      // Desativa menus
      try {
        const disabledRow1 = new ActionRowBuilder().addComponents(StringSelectMenuBuilder.from(modeMenu).setDisabled(true));
        const disabledRow2 = new ActionRowBuilder().addComponents(StringSelectMenuBuilder.from(catMenu).setDisabled(true));
        const disabledRow3 = new ActionRowBuilder().addComponents(StringSelectMenuBuilder.from(topMenu).setDisabled(true));

        await interaction.editReply({ components: [disabledRow1, disabledRow2, disabledRow3] });
      } catch {}
    });
  },
};
