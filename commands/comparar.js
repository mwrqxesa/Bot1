const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('canvas');
const axios = require('axios');

const API_BASE = 'https://mush.com.br/api/player';

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function ratio(a, b) {
  a = safeNum(a);
  b = safeNum(b);
  return b > 0 ? a / b : 0;
}

function fmt(n) {
  return safeNum(n).toLocaleString('pt-BR');
}

function getBedwarsStats(player) {
  return player?.response?.stats?.bedwars || player?.stats?.bedwars || null;
}

async function fetchPlayer(nick) {
  try {
    const res = await axios.get(`${API_BASE}/${encodeURIComponent(nick)}`, {
      headers: { 'User-Agent': 'MizuBot/1.0', Accept: 'application/json' },
      timeout: 20000,
    });

    const data = res.data;
    if (!data?.success || !data?.response) return null;
    return data.response;
  } catch {
    return null;
  }
}

async function createComparisonImage(p1Name, p2Name, s1, s2) {
  const W = 1100;
  const H = 620;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Fundo
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0f1116');
  bg.addColorStop(1, '#1b1f2a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Card central
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(30, 30, W - 60, H - 60, 20);
  } else {
    ctx.rect(30, 30, W - 60, H - 60);
  }
  ctx.fill();
  ctx.stroke();

  // Linha central
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(W / 2, 90);
  ctx.lineTo(W / 2, H - 80);
  ctx.stroke();

  // Carrega skins (corpo)
  let skin1 = null;
  let skin2 = null;
  try {
    [skin1, skin2] = await Promise.all([
      loadImage(`https://mc-heads.net/body/${encodeURIComponent(p1Name)}/180`),
      loadImage(`https://mc-heads.net/body/${encodeURIComponent(p2Name)}/180`)
    ]);
  } catch {}

  const leftX = 120;
  const rightX = W - 260;
  const skinY = 130;
  const skinW = 140;
  const skinH = 330;

  if (skin1) ctx.drawImage(skin1, leftX, skinY, skinW, skinH);
  if (skin2) {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(skin2, -(rightX + skinW), skinY, skinW, skinH);
    ctx.restore();
  }

  // Títulos
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 32px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(p1Name, 230, 95);
  ctx.fillText(p2Name, W - 230, 95);

  ctx.fillStyle = '#ffd166';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(`Nível ${safeNum(s1.level)}`, 230, 122);
  ctx.fillText(`Nível ${safeNum(s2.level)}`, W - 230, 122);

  // VS
  ctx.fillStyle = '#ff5c5c';
  ctx.font = 'bold 58px sans-serif';
  ctx.fillText('VS', W / 2, 190);

  // Métricas
  const metrics = [
    ['Vitórias', safeNum(s1.wins), safeNum(s2.wins)],
    ['FK', safeNum(s1.final_kills), safeNum(s2.final_kills)],
    ['Camas', safeNum(s1.beds_broken), safeNum(s2.beds_broken)],
    ['KDR', ratio(s1.kills, s1.deaths).toFixed(2), ratio(s2.kills, s2.deaths).toFixed(2)],
    ['FKDR', ratio(s1.final_kills, s1.final_deaths).toFixed(2), ratio(s2.final_kills, s2.final_deaths).toFixed(2)],
    ['WLR', ratio(s1.wins, s1.losses).toFixed(2), ratio(s2.wins, s2.losses).toFixed(2)],
    ['BBLR', ratio(s1.beds_broken, s1.beds_lost).toFixed(2), ratio(s2.beds_broken, s2.beds_lost).toFixed(2)],
  ];

  let y = 250;
  for (const [label, v1, v2] of metrics) {
    const left = String(v1);
    const right = String(v2);

    // Label
    ctx.fillStyle = '#cfd6e6';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(label, W / 2, y);

    // Valores
    ctx.fillStyle = '#ffffff';
    ctx.font = '18px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(left, W / 2 - 40, y + 28);

    ctx.textAlign = 'left';
    ctx.fillText(right, W / 2 + 40, y + 28);

    // Linha separadora
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(330, y + 42);
    ctx.lineTo(W - 330, y + 42);
    ctx.stroke();

    y += 52;
    ctx.textAlign = 'center';
  }

  return canvas.toBuffer('image/png');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('comparar')
    .setDescription('[Mush] Compara dois jogadores no BedWars (geral).')
    .addStringOption(opt =>
      opt.setName('jogador1')
        .setDescription('Primeiro jogador')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('jogador2')
        .setDescription('Segundo jogador')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const nick1 = interaction.options.getString('jogador1', true);
    const nick2 = interaction.options.getString('jogador2', true);

    const [p1, p2] = await Promise.all([fetchPlayer(nick1), fetchPlayer(nick2)]);

    if (!p1) {
      return interaction.editReply(`❌ Não foi possível encontrar o jogador **${nick1}**.`);
    }
    if (!p2) {
      return interaction.editReply(`❌ Não foi possível encontrar o jogador **${nick2}**.`);
    }

    const s1 = getBedwarsStats(p1);
    const s2 = getBedwarsStats(p2);

    if (!s1) {
      return interaction.editReply(`❌ Não foi possível encontrar stats de BedWars para **${nick1}**.`);
    }
    if (!s2) {
      return interaction.editReply(`❌ Não foi possível encontrar stats de BedWars para **${nick2}**.`);
    }

    const name1 = p1.account?.username || nick1;
    const name2 = p2.account?.username || nick2;

    const score1 =
      safeNum(s1.wins) * 2 +
      safeNum(s1.final_kills) * 1.5 +
      safeNum(s1.beds_broken) * 1.2 +
      ratio(s1.final_kills, s1.final_deaths || 1) * 100;

    const score2 =
      safeNum(s2.wins) * 2 +
      safeNum(s2.final_kills) * 1.5 +
      safeNum(s2.beds_broken) * 1.2 +
      ratio(s2.final_kills, s2.final_deaths || 1) * 100;

    const winner = score1 === score2 ? 'Empate' : (score1 > score2 ? name1 : name2);

    const embed = new EmbedBuilder()
      .setTitle('⚔️ Comparação BedWars (Geral)')
      .setColor('#0099ff')
      .setDescription([
        `**${name1}** vs **${name2}**`,
        `🏁 **Vantagem:** ${winner}`,
        '',
        `**${name1}** → Wins: **${fmt(s1.wins)}** | FK: **${fmt(s1.final_kills)}** | Camas: **${fmt(s1.beds_broken)}** | FKDR: **${ratio(s1.final_kills, s1.final_deaths || 1).toFixed(2)}**`,
        `**${name2}** → Wins: **${fmt(s2.wins)}** | FK: **${fmt(s2.final_kills)}** | Camas: **${fmt(s2.beds_broken)}** | FKDR: **${ratio(s2.final_kills, s2.final_deaths || 1).toFixed(2)}**`,
      ].join('\n'))
      .setFooter({ text: 'Desenvolvido por Lynn' })
      .setTimestamp();

    try {
      const img = await createComparisonImage(name1, name2, s1, s2);
      const attachment = new AttachmentBuilder(img, { name: 'comparar.png' });
      return interaction.editReply({ embeds: [embed], files: [attachment] });
    } catch (err) {
      console.error('Erro ao gerar imagem de comparação:', err);
      return interaction.editReply({ embeds: [embed] });
    }
  },
};
