const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const { requireBotAdmin } = require('../utils/botPerms');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('anunciar')
    .setDescription('Envia um anúncio em um canal (admin do bot).')
    .addChannelOption(opt =>
      opt.setName('canal')
        .setDescription('Canal onde será enviado')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('titulo')
        .setDescription('Título do anúncio')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('mensagem')
        .setDescription('Conteúdo do anúncio')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('cor')
        .setDescription('Cor em HEX (ex: #0099ff)')
        .setRequired(false)
    )
    .addBooleanOption(opt =>
      opt.setName('mencionar_todos')
        .setDescription('Mencionar @everyone')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!(await requireBotAdmin(interaction))) return;

    const channel = interaction.options.getChannel('canal', true);
    const title = interaction.options.getString('titulo', true);
    const message = interaction.options.getString('mensagem', true);
    const colorInput = interaction.options.getString('cor') || '#0099ff';
    const pingEveryone = interaction.options.getBoolean('mencionar_todos') || false;

    const color = /^#?[0-9a-fA-F]{6}$/.test(colorInput)
      ? (colorInput.startsWith('#') ? colorInput : `#${colorInput}`)
      : '#0099ff';

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(message)
      .setColor(color)
      .setFooter({ text: `Enviado por ${interaction.user.username}` })
      .setTimestamp();

    try {
      await channel.send({
        content: pingEveryone ? '@everyone' : undefined,
        embeds: [embed],
      });

      return interaction.reply({
        content: `✅ Anúncio enviado em ${channel}.`,
        ephemeral: true
      });
    } catch (err) {
      console.error('Erro no /anunciar:', err);
      return interaction.reply({
        content: '❌ Não consegui enviar o anúncio nesse canal (permissão/canal inválido).',
        ephemeral: true
      });
    }
  }
};
