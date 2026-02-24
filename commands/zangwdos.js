const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('canvas');

// IDs fixos
const USER1_ID = '826501596702965850'; // Zangwda
const USER2_ID = '701959666678366229'; // Zangwdo

function hashToPercent(a, b) {
  const s = `${a}:${b}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 101);
}

function drawHeart(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);

  ctx.beginPath();
  ctx.moveTo(0, 0.35);
  ctx.bezierCurveTo(0, 0.05, -0.5, 0.05, -0.5, 0.35);
  ctx.bezierCurveTo(-0.5, 0.65, 0, 0.9, 0, 1);
  ctx.bezierCurveTo(0, 0.9, 0.5, 0.65, 0.5, 0.35);
  ctx.bezierCurveTo(0.5, 0.05, 0, 0.05, 0, 0.35);
  ctx.closePath();

  const grad = ctx.createLinearGradient(-0.5, 0, 0.5, 1);
  grad.addColorStop(0, '#ff4d6d');
  grad.addColorStop(1, '#ff99ac');
  ctx.fillStyle = grad;

  ctx.shadowColor = 'rgba(255, 0, 85, 0.55)';
  ctx.shadowBlur = 18;
  ctx.fill();
  ctx.restore();
}

function clipCircle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('zangwdos')
    .setDescription('💘 Overlay amorosa (Zangwda + Zangwdo).'),

  async execute(interaction) {
    await interaction.deferReply();

    // Busca os 2 usuários fixos
    let u1, u2;
    try {
      u1 = await interaction.client.users.fetch(USER1_ID);
      u2 = await interaction.client.users.fetch(USER2_ID);
    } catch (err) {
      console.error('Erro ao buscar usuários fixos:', err);
      return interaction.editReply('❌ Não consegui encontrar os usuários configurados.');
    }

    try {
      const W = 900, H = 420;
      const canvas = createCanvas(W, H);
      const ctx = canvas.getContext('2d');

      // Fundo (degradê)
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#1b0b12');
      bg.addColorStop(1, '#2a0d1a');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Corações no fundo
      ctx.globalAlpha = 0.12;
      for (let i = 0; i < 30; i++) {
        const x = Math.random() * W;
        const y = Math.random() * H;
        const s = 14 + Math.random() * 18;
        drawHeart(ctx, x, y, s / 100);
      }
      ctx.globalAlpha = 1;

      // Card central
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 2;

      const cardX = 40, cardY = 40, cardW = W - 80, cardH = H - 80;
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(cardX, cardY, cardW, cardH, 24);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(cardX, cardY, cardW, cardH);
        ctx.strokeRect(cardX, cardY, cardW, cardH);
      }

      // Avatares
      const a1 = u1.displayAvatarURL({ extension: 'png', size: 512 });
      const a2 = u2.displayAvatarURL({ extension: 'png', size: 512 });
      const [img1, img2] = await Promise.all([loadImage(a1), loadImage(a2)]);

      const r = 110;
      const leftX = W * 0.28;
      const rightX = W * 0.72;
      const centerY = H * 0.52;

      function drawAvatar(img, x) {
        ctx.save();
        ctx.shadowColor = 'rgba(255, 102, 178, 0.55)';
        ctx.shadowBlur = 22;
        ctx.fillStyle = 'rgba(255,255,255,0.10)';
        ctx.beginPath();
        ctx.arc(x, centerY, r + 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.save();
        clipCircle(ctx, x, centerY, r);
        ctx.drawImage(img, x - r, centerY - r, r * 2, r * 2);
        ctx.restore();

        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(x, centerY, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      drawAvatar(img1, leftX);
      drawAvatar(img2, rightX);

      // Coração no meio
      drawHeart(ctx, W / 2, centerY - 10, 1.4);

      // Texto
      const percent = hashToPercent(u1.id, u2.id);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.font = 'bold 34px sans-serif';
      ctx.fillText(`${u1.username}  💞  ${u2.username}`, W / 2, 110);

      ctx.font = 'bold 28px sans-serif';
      ctx.fillStyle = '#ff8fb1';
      ctx.fillText(`Compatibilidade: ${percent}%`, W / 2, 155);

      ctx.font = '16px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.70)';
      ctx.fillText('feito com carinho ✨', W / 2, H - 70);

      const attachment = new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'zangwdos.png' });

      return interaction.editReply({
        content: `💘 ${u1} x ${u2}`,
        files: [attachment],
      });
    } catch (err) {
      console.error('Erro no comando /zangwdos:', err);
      return interaction.editReply('❌ Não consegui gerar a imagem agora. Tente novamente.');
    }
  }
};
