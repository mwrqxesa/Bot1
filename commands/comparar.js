const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage, registerFont } = require('canvas');
const axios = require('axios');
const path = require('path');

// Registrar fonte
registerFont(path.join(__dirname, '..', 'assets', 'Minecraft.ttf'), { family: 'Minecraft' });

// Configurações
const CONFIG = {
  timeout: 30000,
  headers: {
    'User-Agent': 'MizuBot/1.0',
    'Accept': 'application/json',
  },
  apiUrl: 'https://mush.com.br/api/player',
};

// =========================
// IMAGEM
// =========================
async function createComparisonImage(player1, player2, stats1, stats2, gameTitle, metrics) {
  const canvas = createCanvas(1200, 600);
  const ctx = canvas.getContext('2d');

  try {
    const backgroundPath = path.join(__dirname, '..', 'assets', 'background.png');
    const background = await loadImage(backgroundPath);

    // Fundo
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Background leve
    ctx.filter = 'blur(1px)';
    ctx.globalAlpha = 0.3;
    ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;

    // Linha central
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 100);
    ctx.lineTo(canvas.width / 2, 500);
    ctx.stroke();

    // VS estilizado
    function drawStylizedVS() {
      ctx.save();

      ctx.shadowColor = '#ff0000';
      ctx.shadowBlur = 25;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      const vsY = canvas.height / 2 + 20;

      ctx.font = 'bold 100px Minecraft';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#660000';
      ctx.fillText('VS', canvas.width / 2, vsY);

      ctx.shadowBlur = 15;
      ctx.fillStyle = '#990000';
      ctx.font = 'bold 95px Minecraft';
      ctx.fillText('VS', canvas.width / 2, vsY);

      ctx.shadowBlur = 10;
      ctx.fillStyle = '#ff3333';
      ctx.font = 'bold 90px Minecraft';
      ctx.fillText('VS', canvas.width / 2, vsY);

      ctx.shadowBlur = 5;
      ctx.fillStyle = '#ff6666';
      ctx.font = 'bold 85px Minecraft';
      ctx.fillText('VS', canvas.width / 2, vsY);

      ctx.restore();
    }

    drawStylizedVS();

    // Skins
    const [skin1, skin2] = await Promise.all([
      loadImage(`https://mc-heads.net/body/${encodeURIComponent(player1)}/180`),
      loadImage(`https://mc-heads.net/body/${encodeURIComponent(player2)}/180`),
    ]);

    const skinWidth = 140;
    const skinHeight = 350;
    const skinY = 150;

    const skin1X = 80;
    const skin2X = 1120;

    ctx.drawImage(skin1, skin1X, skinY, skinWidth, skinHeight);
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(skin2, -skin2X, skinY, skinWidth, skinHeight);
    ctx.restore();

    function drawPlayerInfo(name, level, skinX, align) {
      ctx.save();

      const centerX = align === 'left'
        ? skinX + (skinWidth / 2)
        : skinX - (skinWidth / 2);

      ctx.font = 'bold 40px Minecraft';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(name, centerX, 110);

      ctx.font = 'bold 32px Minecraft';
      ctx.fillStyle = '#ffaa00';
      ctx.fillText(`NÍVEL ${level ?? 0}`, centerX, 145);

      ctx.restore();
    }

    drawPlayerInfo(player1, stats1.level || 0, skin1X, 'left');
    drawPlayerInfo(player2, stats2.level || 0, skin2X, 'right');

    // Métricas
    metrics.forEach(([label, getValue], i) => {
      if (typeof getValue !== 'function') return;

      const y = 220 + (i * 55)*
