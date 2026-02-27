require('dotenv').config();

const { Client, Collection, GatewayIntentBits, Events, ActivityType } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const { joinVoiceChannel, entersState, VoiceConnectionStatus, getVoiceConnection } = require('@discordjs/voice');
const fs = require('node:fs');
const path = require('node:path');

const RecruitmentManager = require('./utils/RecruitmentManager');
const LicenseManager = require('./handlers/LicenseManager');
const ClanManager = require('./handlers/ClanManager');
const PlayerManager = require('./utils/PlayerManager');
const GuildSettingsManager = require('./managers/GuildSettingsManager');
const CallRankingManager = require('./managers/CallRankingManager');

// =====================
// CONFIG
// =====================
const TOKEN = process.env.BOT_TOKEN || process.env.DISCORD_TOKEN;
const AUTO_VOICE_CHANNEL_ID = '1476401616784724030'; // call fixa
const AUTO_VOICE_REJOIN_DELAY_MS = 5000;
let autoVoiceReconnectTimeout = null;

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
    GatewayIntentBits.GuildVoiceStates,
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
      status: 'online',
      activities: [activity],
    });

    index++;
  };

  applyPresence();
  setInterval(applyPresence, 60_000);
}

// =====================
// AUTO JOIN / REJOIN VOICE
// =====================
function scheduleAutoRejoinVoice(clientInstance, reason = 'desconectada') {
  if (autoVoiceReconnectTimeout) return;

  console.log(`ℹ️ Lynn Bot saiu da call alvo (${reason}). Tentando voltar em ${AUTO_VOICE_REJOIN_DELAY_MS / 1000}s...`);

  autoVoiceReconnectTimeout = setTimeout(async () => {
    autoVoiceReconnectTimeout = null;
    await autoJoinSpecificVoiceChannel(clientInstance);
  }, AUTO_VOICE_REJOIN_DELAY_MS);
}

async function autoJoinSpecificVoiceChannel(clientInstance) {
  try {
    if (!AUTO_VOICE_CHANNEL_ID) return;

    let voiceChannel = null;

    // 1) Busca no cache
    for (const guild of clientInstance.guilds.cache.values()) {
      const ch = guild.channels.cache.get(AUTO_VOICE_CHANNEL_ID);
      if (ch) {
        voiceChannel = ch;
        break;
      }
    }

    // 2) Fallback com fetch
    if (!voiceChannel) {
      for (const guild of clientInstance.guilds.cache.values()) {
        const ch = await guild.channels.fetch(AUTO_VOICE_CHANNEL_ID).catch(() => null);
        if (ch) {
          voiceChannel = ch;
          break;
        }
      }
    }

    if (!voiceChannel) {
      console.warn(`⚠️ Canal ${AUTO_VOICE_CHANNEL_ID} não encontrado.`);
      return;
    }

    if (!voiceChannel.isVoiceBased?.()) {
      console.warn(`⚠️ O canal ${AUTO_VOICE_CHANNEL_ID} não é de voz.`);
      return;
    }

    const existing = getVoiceConnection(voiceChannel.guild.id);
    if (existing) {
      const currentJoinConfig = existing.joinConfig || {};

      if (currentJoinConfig.channelId === AUTO_VOICE_CHANNEL_ID) {
        console.log(`ℹ️ Lynn Bot já está conectada na call alvo (${AUTO_VOICE_CHANNEL_ID}).`);

        // ✅ Garante sessão no ranking mesmo se a conexão já existia
        try {
          if (clientInstance.callRanking && clientInstance.user) {
            await clientInstance.callRanking.touchUser(clientInstance.user);
            await clientInstance.callRanking.startSession(voiceChannel.guild.id, clientInstance.user.id);
            await clientInstance.callRanking.updateRankingMessage().catch(() => {});
            console.log('✅ Sessão da Lynn Bot registrada no CallRanking (conexão já existente).');
          }
        } catch (e) {
          console.error('❌ Erro ao registrar Lynn Bot no CallRanking (conexão existente):', e);
        }

        return;
      }

      try { existing.destroy(); } catch {}
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

    // ✅ Garante contagem da Lynn Bot no ranking
    try {
      if (clientInstance.callRanking && clientInstance.user) {
        await clientInstance.callRanking.touchUser(clientInstance.user);
        await clientInstance.callRanking.startSession(voiceChannel.guild.id, clientInstance.user.id);
        await clientInstance.callRanking.updateRankingMessage().catch(() => {});
        console.log('✅ Sessão da Lynn Bot registrada no CallRanking.');
      }
    } catch (e) {
      console.error('❌ Erro ao registrar Lynn Bot no CallRanking:', e);
    }

    // Observa desconexão e agenda retorno
    connection.on('stateChange', (_oldState, newState) => {
      const status = newState?.status;
      if (
        status === VoiceConnectionStatus.Disconnected ||
        status === VoiceConnectionStatus.Destroyed
      ) {
        scheduleAutoRejoinVoice(clientInstance, `voice status: ${status}`);
      }
    });

    console.log(`✅ Lynn Bot entrou automaticamente na call: ${voiceChannel.name} (${voiceChannel.id})`);
  } catch (error) {
    console.error('❌ Erro ao entrar automaticamente na call:', error);
    scheduleAutoRejoinVoice(clientInstance, 'erro ao conectar');
  }
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
// REGISTRO SLASH COMMANDS
// =====================
const rest = new REST({ version: '9' }).setToken(TOKEN);

// =====================
// READY
// =====================
client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot iniciado como ${client.user.tag}`);

  // presença da Lynn
  startLynnPresence(client);

  // registra slash commands
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

  // ✅ ORDEM IMPORTANTE: init ranking antes de entrar na call
  try {
    await client.licenses.init();
    console.log('✅ Sistema de licenças inicializado');

    await client.players.init();
    await client.clans.init();

    client.recruitmentManager = new RecruitmentManager(client);

    await client.callRanking.init();
    console.log('✅ Ranking de call inicializado');

    // ✅ entra na call depois do ranking
    await autoJoinSpecificVoiceChannel(client);

    console.log('✅ Todos os sistemas inicializados com sucesso');
  } catch (error) {
    console.error('❌ Erro ao inicializar sistemas:', error);
  }
});

// =====================
// INTERAÇÕES
// =====================
client.on('interactionCreate', async (interaction) => {
  try {
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

    if (interaction.isButton()) {
      const id = interaction.customId;

      if (['apply_recruitment', 'apply_aranked', 'close_ticket'].includes(id)) {
        await client.recruitmentManager.handleButton(interaction);
        return;
      }

      if (['cxc', 'parceria', 'accept_cxc', 'decline_cxc'].includes(id)) {
        const adminCxcCommand = client.commands.get('admincxc');
        if (adminCxcCommand?.handleButton) {
          await adminCxcCommand.handleButton(interaction);
        }
        return;
      }

      return;
    }

    if (interaction.isModalSubmit()) {
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
// TRACKING DE CALL (ranking)
// =====================
client.on('voiceStateUpdate', (oldState, newState) => {
  try {
    client.callRanking?.handleVoiceStateUpdate(oldState, newState);
  } catch (err) {
    console.error('Erro no voiceStateUpdate do ranking:', err);
  }
});

// =====================
// AUTO-REJOIN DA LYNN BOT
// =====================
client.on('voiceStateUpdate', async (oldState, newState) => {
  try {
    if (!client.user) return;
    if (newState.id !== client.user.id) return;

    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;

    // saiu da call alvo
    if (oldChannelId === AUTO_VOICE_CHANNEL_ID && newChannelId !== AUTO_VOICE_CHANNEL_ID) {
      try {
        if (client.callRanking && client.user) {
          await client.callRanking.stopSession(oldState.guild.id, client.user.id);
          await client.callRanking.updateRankingMessage().catch(() => {});
          console.log('ℹ️ Sessão da Lynn Bot encerrada no CallRanking (saiu da call alvo).');
        }
      } catch (e) {
        console.error('Erro ao encerrar sessão da Lynn Bot no CallRanking:', e);
      }

      scheduleAutoRejoinVoice(client, 'foi removida/movida');
      return;
    }

    // entrou em canal diferente da call alvo
    if (newChannelId && newChannelId !== AUTO_VOICE_CHANNEL_ID) {
      scheduleAutoRejoinVoice(client, 'entrou em canal diferente');
      return;
    }
  } catch (err) {
    console.error('Erro no auto-rejoin de voice:', err);
  }
});

// =====================
// LOGS / ERROS
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
// LOGIN
// =====================
client.login(TOKEN).catch((err) => {
  console.error('❌ Falha ao logar no Discord:', err);
  process.exit(1);
});      
    }

    // fetch fallback
    if (!voiceChannel) {
      for (const guild of clientInstance.guilds.cache.values()) {
        const ch = await guild.channels.fetch(AUTO_VOICE_CHANNEL_ID).catch(() => null);
        if (ch) {
          voiceChannel = ch;
          break;
        }
      }
    }

    if (!voiceChannel) {
      console.warn(`⚠️ Canal ${AUTO_VOICE_CHANNEL_ID} não encontrado.`);
      return;
    }

    if (!voiceChannel.isVoiceBased?.()) {
      console.warn(`⚠️ O canal ${AUTO_VOICE_CHANNEL_ID} não é de voz.`);
      return;
    }

    const existing = getVoiceConnection(voiceChannel.guild.id);
    if (existing) {
      const currentJoinConfig = existing.joinConfig || {};

      if (currentJoinConfig.channelId === AUTO_VOICE_CHANNEL_ID) {
        console.log(`ℹ️ Lynn Bot já está conectada na call alvo (${AUTO_VOICE_CHANNEL_ID}).`);

        // ✅ garante sessão no ranking mesmo se já estava conectada
        try {
          if (clientInstance.callRanking && clientInstance.user) {
            await clientInstance.callRanking.touchUser(clientInstance.user);
            await clientInstance.callRanking.startSession(voiceChannel.guild.id, clientInstance.user.id);
            console.log('✅ Sessão da Lynn Bot registrada no CallRanking (conexão já existente).');
          }
        } catch (e) {
          console.error('❌ Erro ao registrar Lynn Bot no CallRanking (conexão existente):', e);
        }

        return;
      }

      try { existing.destroy(); } catch {}
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

    // ✅ Garante contagem da Lynn Bot no ranking
    try {
      if (clientInstance.callRanking && clientInstance.user) {
        await clientInstance.callRanking.touchUser(clientInstance.user);
        await clientInstance.callRanking.startSession(voiceChannel.guild.id, clientInstance.user.id);
        console.log('✅ Sessão da Lynn Bot registrada no CallRanking.');
      }
    } catch (e) {
      console.error('❌ Erro ao registrar Lynn Bot no CallRanking:', e);
    }

    // Observa desconexão e agenda retorno
    connection.on('stateChange', (_oldState, newState) => {
      const status = newState?.status;
      if (
        status === VoiceConnectionStatus.Disconnected ||
        status === VoiceConnectionStatus.Destroyed
      ) {
        scheduleAutoRejoinVoice(clientInstance, `voice status: ${status}`);
      }
    });

    console.log(`✅ Lynn Bot entrou automaticamente na call: ${voiceChannel.name} (${voiceChannel.id})`);
  } catch (error) {
    console.error('❌ Erro ao entrar automaticamente na call:', error);
    scheduleAutoRejoinVoice(clientInstance, 'erro ao conectar');
  }
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
// REGISTRO SLASH COMMANDS
// =====================
const rest = new REST({ version: '9' }).setToken(TOKEN);

// =====================
// READY
// =====================
client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot iniciado como ${client.user.tag}`);

  // presença
  startLynnPresence(client);

  // slash commands
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

  // ✅ ORDEM IMPORTANTE: inicia ranking primeiro, depois entra na call
  try {
    await client.licenses.init();
    console.log('✅ Sistema de licenças inicializado');

    await client.players.init();
    await client.clans.init();

    client.recruitmentManager = new RecruitmentManager(client);

    await client.callRanking.init();
    console.log('✅ Ranking de call inicializado');

    // ✅ entra na call depois do ranking estar pronto
    await autoJoinSpecificVoiceChannel(client);

    console.log('✅ Todos os sistemas inicializados com sucesso');
  } catch (error) {
    console.error('❌ Erro ao inicializar sistemas:', error);
  }
});

// =====================
// INTERAÇÕES
// =====================
client.on('interactionCreate', async (interaction) => {
  try {
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

    if (interaction.isButton()) {
      const id = interaction.customId;

      if (['apply_recruitment', 'apply_aranked', 'close_ticket'].includes(id)) {
        await client.recruitmentManager.handleButton(interaction);
        return;
      }

      if (['cxc', 'parceria', 'accept_cxc', 'decline_cxc'].includes(id)) {
        const adminCxcCommand = client.commands.get('admincxc');
        if (adminCxcCommand?.handleButton) {
          await adminCxcCommand.handleButton(interaction);
        }
        return;
      }

      return;
    }

    if (interaction.isModalSubmit()) {
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
// TRACKING DE CALL (ranking)
// =====================
client.on('voiceStateUpdate', (oldState, newState) => {
  try {
    client.callRanking?.handleVoiceStateUpdate(oldState, newState);
  } catch (err) {
    console.error('Erro no voiceStateUpdate do ranking:', err);
  }
});

// =====================
// AUTO-REJOIN DA LYNN BOT
// =====================
client.on('voiceStateUpdate', async (oldState, newState) => {
  try {
    if (!client.user) return;
    if (newState.id !== client.user.id) return;

    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;

    // saiu da call alvo
    if (oldChannelId === AUTO_VOICE_CHANNEL_ID && newChannelId !== AUTO_VOICE_CHANNEL_ID) {
      // encerra sessão atual da Lynn no ranking
      try {
        if (client.callRanking && client.user) {
          await client.callRanking.stopSession(oldState.guild.id, client.user.id);
          console.log('ℹ️ Sessão da Lynn Bot encerrada no CallRanking (saiu da call alvo).');
        }
      } catch (e) {
        console.error('Erro ao encerrar sessão da Lynn Bot no CallRanking:', e);
      }

      scheduleAutoRejoinVoice(client, 'foi removida/movida');
      return;
    }

    // entrou em canal diferente da call alvo
    if (newChannelId && newChannelId !== AUTO_VOICE_CHANNEL_ID) {
      scheduleAutoRejoinVoice(client, 'entrou em canal diferente');
      return;
    }
  } catch (err) {
    console.error('Erro no auto-rejoin de voice:', err);
  }
});

// =====================
// LOGS / ERROS
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
// LOGIN
// =====================
client.login(TOKEN).catch((err) => {
  console.error('❌ Falha ao logar no Discord:', err);
  process.exit(1);
});
