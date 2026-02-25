const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('canvas');

// IDs fixos
const USER1_ID = '826501596702965850'; // Zangwda
const USER2_ID = '701959666678366229'; // Zangwdo

function drawRoundedRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }

  // fallback
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function clipCircle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
}

function drawHeart(ctx, x, y, size = 1, colorA = '#ff4d6d', colorB = '#ff9eb5') {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);

  ctx.beginPath();
  ctx.moveTo(0, 12);
  ctx.bezierCurveTo(0, -6, -26, -6, -26, 14);
  ctx.bezierCurveTo(-26, 32, -6, 42, 0, 52);
  ctx.bezierCurveTo(6, 42, 26, 32, 26, 14);
  ctx.bezierCurveTo(26, -6, 0, -6, 0, 12);
  ctx.closePath();

  const g = ctx.createLinearGradient(-26, -6, 26, 52);
  g.addColorStop(0, colorA);
  g.addColorStop(1, colorB);
  ctx.fillStyle = g;
  ctx.shadowColor = 'rgba(255, 64, 128, 0.55)';
  ctx.shadowBlur = 22;
  ctx.fill();

  ctx.restore();
}

function drawSparkles(ctx, W, H) {
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const r = Math.random() * 1.8 + 0.4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.2})`;
    ctx.fill();
  }
}

function userFlagsToLabels(user) {
  const flags = user.flags?.toArray?.() || [];
  const labels = [];

  // badges básicos (texto)
  const map = {
    Staff: 'STAFF',
    Partner: 'PARTNER',
    Hypesquad: 'HYPESQUAD',
    BugHunterLevel1: 'BUG HUNTER',
    BugHunterLevel2: 'BUG HUNTER+',
    HypeSquadOnlineHouse1: 'BRAVERY',
    HypeSquadOnlineHouse2: 'BRILLIANCE',
    HypeSquadOnlineHouse3: 'BALANCE',
    PremiumEarlySupporter: 'EARLY SUPPORTER',
    VerifiedDeveloper: 'EARLY VERIFIED BOT DEV',
    ActiveDeveloper: 'ACTIVE DEVELOPER',
    CertifiedModerator: 'MODERATOR',
    VerifiedBot: 'VERIFIED BOT',
  };

  for (const f of flags) {
    if (map[f]) labels.push(map[f]);
  }

  // Nitro (heurística simples)
  if (user.avatar && user.avatar.startsWith('a_')) labels.push('NITRO');

  // Se não tiver nada
  if (!labels.length) labels.push('SEM INSÍGNIAS');

  return labels.slice(0, 4); // limita pra não poluir
}

function drawBadgeChips(ctx, labels, x, y, align = 'center') {
  ctx.save();
  ctx.font = 'bold 14px sans-serif';
  ctx.textBaseline = 'middle';

  const chips = labels.map((label) => {
    const width = Math.ceil(ctx.measureText(label).width) + 20;
    return { label, width, height: 26 };
  });

  const gap = 8;
  const totalWidth = chips.reduce((a, c) => a + c.width, 0) + (chips.length - 1) * gap;

  let startX = x;
  if (align === 'center') startX = x - totalWidth / 2;
  if (align === 'right') startX = x - totalWidth;

  for (const chip of chips) {
    drawRoundedRect(ctx, startX, y, chip.width, chip.height, 13);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(chip.label, startX + chip.width / 2, y + chip.height / 2 + 0.5);

    startX += chip.width + gap;
  }

  ctx.restore();
}

function drawAvatarCard(ctx, img, x, y, r, accent = '#ff7aa2') {
  // glow exterior
  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 28;
  ctx.beginPath();
  ctx.arc(x, y, r + 10, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();
  ctx.restore();

  // ring gradiente
  const ring = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  ring.addColorStop(0, '#ffffff');
  ring.addColorStop(1, accent);

  ctx.beginPath();
  ctx.arc(x, y, r + 6, 0, Math.PI * 2);
  ctx.fillStyle = ring;
  ctx.fill();

  // avatar circular
  ctx.save();
  clipCircle(ctx, x, y, r);
  ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
  ctx.restore();

  // ring interno
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.stroke();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('zangwdos')
    .setDescription('💘 Match fixo perfeito entre Zangwda e Zangwdo.'),

  async execute(interaction) {
    await interaction.deferReply();

    let u1, u2;
    try {
      // fetch force para carregar flags
      u1 = await interaction.client.users.fetch(USER1_ID, { force: true });
      u2 = await interaction.client.users.fetch(USER2_ID, { force: true });
    } catch (err) {
      console.error('Erro ao buscar usuários fixos:', err);
      return interaction.editReply('❌ Não consegui encontrar os usuários configurados.');
    }

    try {
      const W = 1100;
      const H = 560;
      const canvas = createCanvas(W, H);
      const ctx = canvas.getContext('2d');

      // ===== Fundo =====
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#140910');
      bg.addColorStop(0.5, '#220d19');
      bg.addColorStop(1, '#10070f');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // manchas suaves
      const orb1 = ctx.createRadialGradient(220, 120, 20, 220, 120, 260);
      orb1.addColorStop(0, 'rgba(255, 80, 130, 0.20)');
      orb1.addColorStop(1, 'rgba(255, 80, 130, 0)');
      ctx.fillStyle = orb1;
      ctx.fillRect(0, 0, W, H);

      const orb2 = ctx.createRadialGradient(900, 420, 20, 900, 420, 280);
      orb2.addColorStop(0, 'rgba(255, 140, 180, 0.18)');
      orb2.addColorStop(1, 'rgba(255, 140, 180, 0)');
      ctx.fillStyle = orb2;
      ctx.fillRect(0, 0, W, H);

      drawSparkles(ctx, W, H);

      // ===== Card principal =====
      const cardX = 45, cardY = 45, cardW = W - 90, cardH = H - 90;

      ctx.save();
      ctx.shadowColor = 'rgba(255, 70, 120, 0.22)';
      ctx.shadowBlur = 24;
      drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 28);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fill();
      ctx.restore();

      drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 28);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // brilho interno topo
      const topGlow = ctx.createLinearGradient(0, cardY, 0, cardY + 120);
      topGlow.addColorStop(0, 'rgba(255,255,255,0.08)');
      topGlow.addColorStop(1, 'rgba(255,255,255,0)');
      drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 28);
      ctx.fillStyle = topGlow;
      ctx.fill();

      // ===== Avatares =====
      const a1 = u1.displayAvatarURL({ extension: 'png', size: 512 });
      const a2 = u2.displayAvatarURL({ extension: 'png', size: 512 });
      const [img1, img2] = await Promise.all([loadImage(a1), loadImage(a2)]);

      const avatarR = 125;
      const leftX = 285;
      const rightX = 815;
      const avatarY = 285;

      drawAvatarCard(ctx, img1, leftX, avatarY, avatarR, '#ff88b0');
      drawAvatarCard(ctx, img2, rightX, avatarY, avatarR, '#ff88b0');

      // ===== Coração central =====
      drawHeart(ctx, W / 2, avatarY - 20, 2.2);

      // 100%
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = 'bold 40px sans-serif';
      ctx.fillStyle = '#ffd4e0';
      ctx.shadowColor = 'rgba(255, 120, 170, 0.45)';
      ctx.shadowBlur = 14;
      ctx.fillText('100%', W / 2, avatarY + 105);

      ctx.font = 'bold 16px sans-serif';
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText('MATCH PERFEITO', W / 2, avatarY + 132);
      ctx.restore();

      // ===== Título topo =====
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = 'bold 38px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('💘 ZANGWDOS MATCH', W / 2, 105);

      ctx.font = '16px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText('união lendária • compatibilidade absoluta', W / 2, 132);
      ctx.restore();

      // ===== Nomes =====
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = 'bold 28px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(u1.username, leftX, 455);
      ctx.fillText(u2.username, rightX, 455);

      ctx.font = '15px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillText(`ID: ${u1.id}`, leftX, 480);
      ctx.fillText(`ID: ${u2.id}`, rightX, 480);
      ctx.restore();

      // ===== Insígnias (badges) =====
      const badges1 = userFlagsToLabels(u1);
      const badges2 = userFlagsToLabels(u2);

      drawBadgeChips(ctx, badges1, leftX, 500, 'center');
      drawBadgeChips(ctx, badges2, rightX, 500, 'center');

      // ===== Rodapé =====
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '14px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.60)';
      ctx.fillText('feito com carinho ✨', W / 2, H - 18);
      ctx.restore();

      const attachment = new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'zangwdos.png' });

      return interaction.editReply({
        content: `💘 ${u1} x ${u2} — **100%**`,
        files: [attachment]
      });
    } catch (err) {
      console.error('Erro no comando /zangwdos:', err);
      return interaction.editReply('❌ Não consegui gerar a imagem agora. Tente novamente.');
    }
  }
};
