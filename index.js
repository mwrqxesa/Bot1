require('dotenv').config();

const { Client, Collection, GatewayIntentBits, Events, ActivityType } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const fs = require('node:fs');
const path = require('node:path');

const RecruitmentManager = require('./utils/RecruitmentManager');
const LicenseManager = require('./handlers/LicenseManager');
const ClanManager = require('./handlers/ClanManager');
const PlayerManager = require('./utils/PlayerManager');
const GuildSettingsManager = require('./managers/GuildSettingsManager');
const CallRankingManager = require('./managers/CallRankingManager');

// =====================
// TOKEN
// =====================
const TOKEN = process.env.BOT_TOKEN || process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error('❌ Nenhum token encontrado. Configure BOT_TOKEN (ou DISCORD_TOKEN).');
  process.exit(1);
}

// =====================
// CLIENT
// =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates, // ✅ necessário pro ranking de call
  ],
  shards: 'auto',
  failIfNotExists: false,
  allowedMentions: {
    parse: ['users', 'roles'],
    repliedUser: true,
  },
});

client.commands = new Collection();

// =====================
// PRESENCE (Lynn Bot)
// =====================
function startLynnPresence(clientInstance) {
  const activities = [
    { name: 'Amando o Zangwdo', type: ActivityType.Watching },
    { name: 'Protegendo o Zangwdo na Yakuza', type: ActivityType.Playing },
    { name: 'Lealdade à Yakuza e ao Zangwdo', type: ActivityType.Listening },
    { name: 'Dominando as calls da Yakuza', type: ActivityType.Competing },
    { name: 'Guardando o coração do Zangwdo', type: ActivityType.Watching },
    { name: 'Operação: Amar o Zangwdo', type: ActivityType.Playing },
    { name: 'No submundo com Zangwdo', type: ActivityType.Watching },
    { name: 'Juramento Yakuza ao Zangwdo', type: ActivityType.Listening },
  ];

  let index = 0;

  const applyPresence = () => {
    if (!clientInstance.user) return;

    const activity = activities[index % activities.length];

    clientInstance.user.setPresence({
      status: 'online', // online | idle | dnd | invisible
      activities: [activity],
    });

    index++;
  };

  applyPresence(); // aplica imediatamente
  setInterval(applyPresence, 60_000); // troca a cada 1 minuto
}

// =====================
// MANAGERS / SISTEMAS
// =====================
client.licenses = new LicenseManager();
client.clans = new ClanManager(client);
client.players = new PlayerManager();
client.guildSettingsManager = new GuildSettingsManager(client);
client.recruitmentManager = new RecruitmentManager(client);
client.callRanking = new CallRankingManager(client);

// =====================
// CARREGAR COMANDOS
// =====================
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.existsSync(commandsPath)
  ? fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'))
  : [];

const commandsForAPI = [];

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);

  let command;
  try {
    command = require(filePath);
  } catch (err) {
    console.warn(`[AVISO] Falha ao carregar comando ${file}:`, err?.message || err);
    continue;
  }

  if (!command || !('data' in command) || !('execute' in command)) {
    console.warn(`[AVISO] O comando em ${filePath} está faltando 'data' ou 'execute'.`);
    continue;
  }

  // Compatibilidade com comandos em objeto simples
  if (typeof command.data === 'object' && typeof command.data.toJSON !== 'function') {
    const { name, description, options = [] } = command.data;
    command.data = {
      name,
      description,
      options,
      toJSON() {
        return {
          name: this.name,
          description: this.description,
          options: this.options,
        };
      },
    };
  }

  try {
    client.commands.set(command.data.name, command);
    commandsForAPI.push(command.data.toJSON());
  } catch (err) {
    console.warn(`[AVISO] Falha ao registrar slash do comando ${file}:`, err?.message || err);
  }
}

console.log(`✅ Comandos carregados: ${client.commands.size}`);

// =====================
// LOAD EVENTS
// =====================
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.existsSync(eventsPath)
  ? fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'))
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
    console.warn(`[AVISO] Evento inválido em ${filePath} (sem name/execute).`);
    continue;
  }

  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
}

console.log(`✅ Events carregados: ${eventFiles.length}`);

// =====================
// REGISTRO DE COMANDOS SLASH
// =====================
const rest = new REST({ version: '9' }).setToken(TOKEN);

// =====================
// READY
// =====================
client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot iniciado como ${client.user.tag}`);

  // ✅ Atividades da Lynn Bot (Yakuza + Zangwdo)
  startLynnPresence(client);

  // Registra slash commands (global)
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commandsForAPI }
    );
    console.log('✅ Comandos slash registrados com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao registrar comandos slash:', error);
  }

  client.ownerId = '1283948475742031912';

  // Inicializa sistemas
  try {
    await client.licenses.init();
    console.log('✅ Sistema de licenças inicializado');

    await client.players.init();
    await client.clans.init();

    // Se seu projeto depende dessa reinicialização
    client.recruitmentManager = new RecruitmentManager(client);

    await client.callRanking.init();
    console.log('✅ Ranking de call inicializado');

    console.log('✅ Todos os sistemas inicializados com sucesso');
  } catch (error) {
    console.error('❌ Erro ao inicializar sistemas:', error);
  }
});

// =====================
// INTERAÇÕES (slash, botões, modais)
// =====================
client.on('interactionCreate', async (interaction) => {
  try {
    // Slash commands
    if (interaction.isCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`Command execution error [/${interaction.commandName}]:`, error);

        const errorPayload = {
          embeds: [{
            description: '❌ **Ocorreu um erro ao executar este comando!**',
            color: 0xff0000,
          }],
          ephemeral: true,
        };

        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply(errorPayload);
        } else {
          await interaction.editReply(errorPayload).catch(() => {});
        }
      }

      return;
    }

    // Botões
    if (interaction.isButton()) {
      const id = interaction.customId;

      // Botões de recrutamento / tickets
      if (['apply_recruitment', 'apply_aranked', 'close_ticket'].includes(id)) {
        await client.recruitmentManager.handleButton(interaction);
        return;
      }

      // Botões do sistema CxC
      if (['cxc', 'parceria', 'accept_cxc', 'decline_cxc'].includes(id)) {
        const adminCxcCommand = client.commands.get('admincxc');
        if (adminCxcCommand?.handleButton) {
          await adminCxcCommand.handleButton(interaction);
        }
        return;
      }

      return;
    }

    // Modais
    if (interaction.isModalSubmit()) {
      // Modal de edição de painel
      if (interaction.customId.startsWith('paineledit_')) {
        const parts = interaction.customId.split('_');
        const channelId = parts[2];

        const channel = await interaction.guild?.channels.fetch(channelId).catch(() => null);

        if (!channel) {
          await interaction.reply({
            content: '❌ Canal não encontrado. O painel pode ter sido movido ou deletado.',
            ephemeral: true,
          });
          return;
        }

        // mantém sua lógica atual
        interaction.channel = channel;
        await client.recruitmentManager.handlePanelEditModal(interaction);
        return;
      }

      if (interaction.customId === 'recruitment_modal') {
        await client.recruitmentManager.handleRecruitmentModal(interaction);
        return;
      }

      if (interaction.customId === 'aranked_modal') {
        await client.recruitmentManager.handleArankedModal(interaction);
        return;
      }

      if (interaction.customId === 'cxc-modal') {
        await client.recruitmentManager.handleCxCModal(interaction);
        return;
      }

      if (interaction.customId === 'parceria-modal') {
        await client.recruitmentManager.handleParceriaModal(interaction);
        return;
      }
    }
  } catch (error) {
    console.error('Error handling interaction:', error);
  }
});

// =====================
// TRACKING DE CALL (voice state)
// =====================
client.on('voiceStateUpdate', (oldState, newState) => {
  try {
    client.callRanking?.handleVoiceStateUpdate(oldState, newState); // ✅ método correto
  } catch (err) {
    console.error('Erro no voiceStateUpdate do ranking:', err);
  }
});

// =====================
// ERROS / LOGS
// =====================
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

client.on('error', (error) => {
  console.error('Client Error:', error);
});

client.ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});

// =====================
// LOGIN (final do arquivo)
// =====================
client.login(TOKEN).catch((err) => {
  console.error('❌ Falha ao logar no Discord:', err);
  process.exit(1);
});
