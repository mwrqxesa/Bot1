const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

// ✅ Você pediu essa senha específica:
const DEFAULT_PASSWORD = 'ZhangShandy';

// (Recomendado) Você pode colocar no Railway/ENV: PREMIUM_PASSWORD=ZhangShandy
const PASSWORD = process.env.PREMIUM_PASSWORD || DEFAULT_PASSWORD;

// Onde salvar
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'premium.json');

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ users: [] }, null, 2));
}

function loadPremium() {
  ensureStorage();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const json = JSON.parse(raw);
    if (!json.users) json.users = [];
    return json;
  } catch {
    return { users: [] };
  }
}

function savePremium(data) {
  ensureStorage();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function hasPremium(userId) {
  const db = loadPremium();
  return db.users.includes(userId);
}

function grantPremium(userId) {
  const db = loadPremium();
  if (!db.users.includes(userId)) {
    db.users.push(userId);
    savePremium(db);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('premium')
    .setDescription('Informações e ativação do Premium.')
    .addSubcommand(sub =>
      sub
        .setName('info')
        .setDescription('Ver informações sobre o Premium')
    )
    .addSubcommand(sub =>
      sub
        .setName('ativar')
        .setDescription('Ativar Premium com senha')
        .addStringOption(opt =>
          opt
            .setName('senha')
            .setDescription('Senha de ativação')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Ver se você já tem Premium')
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // /premium info
    if (sub === 'info') {
      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('✨ Premium')
        .setDescription([
          '### 🌟 Benefícios Premium',
          '• Acesso a recursos exclusivos',
          '• Suporte prioritário',
          '',
          '### 📝 Observações',
          '• Premium ativado por usuário',
          '• Ativação imediata'
        ].join('\n'))
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // /premium status
    if (sub === 'status') {
      const ok = hasPremium(interaction.user.id);

      const embed = new EmbedBuilder()
        .setColor(ok ? '#00ff7f' : '#ff5555')
        .setTitle('🔒 Status Premium')
        .setDescription(ok ? '✅ Você possui **Premium**.' : '❌ Você **não** possui Premium.')
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // /premium ativar senha:...
    if (sub === 'ativar') {
      const senha = interaction.options.getString('senha', true);

      if (senha !== PASSWORD) {
        return interaction.reply({
          content: '❌ Senha incorreta.',
          ephemeral: true
        });
      }

      // Concede Premium
      grantPremium(interaction.user.id);

      const embed = new EmbedBuilder()
        .setColor('#00ff7f')
        .setTitle('✅ Premium ativado!')
        .setDescription('Agora você já pode usar os comandos Premium.')
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
};
