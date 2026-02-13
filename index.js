require('dotenv').config();

const { Client, Collection, GatewayIntentBits, Events } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const fs = require('node:fs');
const path = require('node:path');

const RecruitmentManager = require('./utils/RecruitmentManager');
const LicenseManager = require('./handlers/LicenseManager');
const ClanManager = require('./handlers/ClanManager');
const PlayerManager = require('./utils/PlayerManager');
const GuildSettingsManager = require('./managers/GuildSettingsManager');

// =====================
// 1) TOKEN (1 só)
// =====================
const TOKEN = process.env.BOT_TOKEN || process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error('❌ ERRO: Nenhum token encontrado. Crie BOT_TOKEN (recomendado) ou DISCORD_TOKEN nas variáveis de ambiente.');
  process.exit(1);
}

// =====================
// 2) CLIENT
// =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  shards: 'auto',
  failIfNotExists: false,
  allowedMentions: {
    parse: ['users', 'roles'],
    repliedUser: true,
  },
});

client.commands = new Collection();

// Managers / Sistemas
client.licenses = new LicenseManager();
client.players = new PlayerManager();
client.clans = new ClanManager(client);
client.guildSettingsManager = new GuildSettingsManager(client);
client.recruitmentManager = new RecruitmentManager(client);

// =====================
// 3) CARREGAR COMANDOS
// =====================
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.existsSync(commandsPath)
  ? fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))
  : [];

const commandsForAPI = [];

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);

  let command;
  try {
    command = require(filePath);
  } catch (err) {
    console.warn(`[AVISO] Falha ao carregar ${file}:`, err?.message || err);
    continue;
  }

  // Precisa ter data e execute
  if (!command?.data || typeof command.execute !== 'function') {
    console.warn(`[AVISO] O comando ${file} está faltando 'data' e/ou 'execute'.`);
    continue;
  }

  // Se for comando em objeto simples (compatibilidade)
  if (typeof command.data === 'object' && typeof command.data.toJSON !== 'function') {
    const { name, description, options = [] } = command.data;

    if (!name || !description) {
      console.warn(`[AVISO] O comando ${file} tem data inválida (sem name/description).`);
      continue;
    }

    command.data = {
      name,
      description,
      options,
      toJSON() {
        return { name: this.name, description: this.description, options: this.options };
      }
    };
  }

  client.commands.set(command.data.name, command);

  // Para registrar no Discord
  try {
    commandsForAPI.push(command.data.toJSON());
  } catch (e) {
    console.warn(`[AVISO] Não foi possível converter data.toJSON() do comando ${file}.`);
  }
}

console.log(`✅ Comandos carregados: ${client.commands.size}`);

// =====================
// 4) CARREGAR EVENTS
// =====================
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.existsSync(eventsPath)
  ? fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'))
  : [];

for (const file of eventFiles) {
  const filePath = path.join(eventsPath, file);
  let event;

  try {
    event = require(filePath);
  } catch (err) {
    console.warn(`[AVISO] Falha ao carregar evento ${file}:`, err?.message || err);
    continue;
  }

  if (!event?.name || typeof event.execute !== 'function') {
    console.warn(`[AVISO] Evento inválido em ${file} (sem name/execute).`);
    continue;
  }

  if (event.once) client.once(event.name, (...args) => event.execute(...args));
  else client.on(event.name, (...args) => event.execute(...args));
}

console.log(`✅ Events carregados: ${eventFiles.length}`);

// =====================
// 5) REGISTRAR SLASH COMMANDS NO READY
// =====================
const rest = new REST({ version: '9' }).setToken(TOKEN);

client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot iniciado como ${client.user.tag}`);

  // Registra slash commands globalmente
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commandsForAPI }
    );
    console.log('✅ Comandos slash registrados com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao registrar comandos slash:', error);
  }

  // Inicializa seus sistemas
  try {
    client.ownerId = '1283948475742031912';

    await client.licenses.init();
    console.log('✅ Sistema de licenças inicializado');

    await client.players.init();
    await client.clans.init();

    client.recruitmentManager = new RecruitmentManager(client);

    console.log('✅ Todos os sistemas inicializados com sucesso');
  } catch (error) {
    console.error('❌ Erro ao inicializar sistemas:', error);
  }
});

// =====================
// 6) INTERACTIONS (comandos/botões/modais)
// =====================
client.on('interactionCreate', async (interaction) => {
  try {
    // Slash Commands
    if (interaction.isCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error('Command execution error:', error);

        const payload = {
          embeds: [{
            description: '❌ **Ocorreu um erro ao executar este comando!**',
            color: 0xff0000
          }],
          ephemeral: true
        };

        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply(payload);
        } else {
          await interaction.editReply(payload);
        }
      }
      return;
    }

    // Botões
    if (interaction.isButton()) {
      const id = interaction.customId;

      if (['apply_recruitment', 'apply_aranked', 'close_ticket'].includes(id)) {
        return client.recruitmentManager.handleButton(interaction);
      }

      if (['cxc', 'parceria', 'accept_cxc', 'decline_cxc'].includes(id)) {
        const adminCxcCommand = client.commands.get('admincxc');
        if (adminCxcCommand?.handleButton) {
          return adminCxcCommand.handleButton(interaction);
        }
      }

      return;
    }

    // Modais
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('paineledit_')) {
        const parts = interaction.customId.split('_');
        const channelId = parts[2];

        const channel = await interaction.guild?.channels.fetch(channelId).catch(() => null);
        if (!channel) {
          return interaction.reply({
            content: '❌ Canal não encontrado. O painel pode ter sido movido ou deletado.',
            ephemeral: true
          });
        }

        interaction.channel = channel;
        return client.recruitmentManager.handlePanelEditModal(interaction);
      }

      if (interaction.customId === 'recruitment_modal') {
        return client.recruitmentManager.handleRecruitmentModal(interaction);
      }

      if (interaction.customId === 'aranked_modal') {
        return client.recruitmentManager.handleArankedModal(interaction);
      }

      if (interaction.customId === 'cxc-modal') {
        return client.recruitmentManager.handleCxCModal(interaction);
      }

      if (interaction.customId === 'parceria-modal') {
        return client.recruitmentManager.handleParceriaModal(interaction);
      }
    }
  } catch (error) {
    console.error('Error handling interaction:', error);
  }
});

// =====================
// 7) ERROS (logs)
// =====================
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});
client.on('error', (error) => {
  console.error('Client Error:', error);
});

// =====================
// 8) LOGIN (no final)
// =====================
client.login(TOKEN).catch((err) => {
  console.error('❌ Falha ao logar no Discord:', err);
  process.exit(1);
});
