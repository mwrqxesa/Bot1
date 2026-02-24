const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('canvas');

function drawHeart(ctx, x, y, size) {
  ctx.save(); ctx.translate(x, y); ctx.scale(size, size);
  ctx.beginPath();
  ctx.moveTo(0, 0.35);
  ctx.bezierCurveTo(0, 0.05, -0.5, 0.05, -0.5, 0.35);
  ctx.bezierCurveTo(-0.5, 0.65, 0, 0.9, 0, 1);
  ctx.bezierCurveTo(0, 0.9, 0.5, 0.65, 0.5, 0.35);
  ctx.bezierCurveTo(0.5, 0.05, 0, 0.05, 0, 0.35);
  ctx.closePath();
  ctx.fillStyle = '#ff4d6d';
  ctx.shadowColor = 'rgba(255, 0, 85, 0.55)';
  ctx.shadowBlur = 18;
  ctx.fill();
  ctx.restore();
}
function clipCircle(ctx, x, y, r) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ship')
    .setDescription('Cria uma overlay amorosa de dois perfis 💘')
    .addUserOption(o => o.setName('pessoa1').setDescription('Primeira pessoa').setRequired(true))
    .addUserOption(o => o.setName('pessoa2').setDescription('Segunda pessoa').setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();
    const u1 = interaction.options.getUser('pessoa1', true);
    const u2 = interaction.options.getUser('pessoa2', true);

    const W = 900, H = 420;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#1b0b12');
    bg.addColorStop(1, '#2a0d1a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // card
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 2;
    ctx.fillRect(40, 40, W - 80, H - 80);
    ctx.strokeRect(40, 40, W - 80, H - 80);

    const a1 = u1.displayAvatarURL({ extension: 'png', size: 512 });
    const a2 = u2.displayAvatarURL({ extension: 'png', size: 512 });
    const [img1, img2] = await Promise.all([loadImage(a1), loadImage(a2)]);

    const r = 110, leftX = W * 0.28, rightX = W * 0.72, centerY = H * 0.52;

    ctx.save(); clipCircle(ctx, leftX, centerY, r); ctx.drawImage(img1, leftX - r, centerY - r, r * 2, r * 2); ctx.restore();
    ctx.save(); clipCircle(ctx, rightX, centerY, r); ctx.drawImage(img2, rightX - r, centerY - r, r * 2, r * 2); ctx.restore();

    drawHeart(ctx, W / 2, centerY - 10, 1.4);

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText(`${u1.username}  💞  ${u2.username}`, W / 2, 110);

    const attachment = new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'ship.png' });
    return interaction.editReply({ content: `💘 ${u1} x ${u2}`, files: [attachment] });
  }
};
