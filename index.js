require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");

// libsodium (corrige erro "No compatible encryption modes")
const libsodium = require("libsodium-wrappers");

const {
  Client,
  Collection,
  GatewayIntentBits,
  Events,
  ActivityType,
  REST,
  Routes,
  PermissionFlagsBits,
} = require("discord.js");

const {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus,
  getVoiceConnection,
} = require("@discordjs/voice");

const RecruitmentManager = require("./utils/RecruitmentManager");
const LicenseManager = require("./handlers/LicenseManager");
const ClanManager = require("./handlers/ClanManager");
const PlayerManager = require("./utils/PlayerManager");
const GuildSettingsManager = require("./managers/GuildSettingsManager");
const CallRankingManager = require("./managers/CallRankingManager");
const MinecraftBridgeManager = require("./managers/MinecraftBridgeManager");

// =====================
// CONFIG
// =====================
const TOKEN = process.env.BOT_TOKEN || process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error("❌ Nenhum token encontrado. Configure BOT_TOKEN (ou DISCORD_TOKEN).");
  process.exit(1);
}

// Se TRUE, contabiliza o bot no ranking quando ele fica 24/7 em call.
// Por padrão: NÃO (pra não sujar ranking)
const COUNT_BOT_IN_RANKING = String(process.env.COUNT_BOT_IN_RANKING || "false").toLowerCase() === "true";

/**
 * Config 24/7 por servidor.
 */
const AUTO_247 = [
  {
    guildId: "1442765800984543244",
    guildName: "Cave",
    channelId: "1472461441452998727",
    label: "call_247",
  },
  {
    guildId: "1237058787093905510",
    guildName: "Yakuza",
    channelId: "1476401616784724030",
    label: "call_247",
  },
];

const AUTO_REJOIN_DELAY_MS = 5000;

// Um timeout de reconexão por guild (evita loop/spam)
const reconnectTimers = new Map(); // guildId -> Timeout

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
  shards: "auto",
  failIfNotExists: false,
  allowedMentions: {
    parse: ["users", "roles"],
    repliedUser: true,
  },
});

client.commands = new Collection();

// =====================
// PRESENCE (Lynn Bot)
// =====================
function startLynnPresence(clientInstance) {
  const activities = [
    { name: "Amando o Zangwdo", type: ActivityType.Watching },
    { name: "Jogando BW no Mush", type: ActivityType.Playing },
    { name: "Lealdade à Yakuza e ao Zangwdo", type: ActivityType.Listening },
    { name: "Dominando as calls da Yakuza", type: ActivityType.Competing },
    { name: "Guardando o coração do Zangwdo", type: ActivityType.Watching },
    { name: "Ligando VAPE V4", type: ActivityType.Playing },
    { name: "No submundo com Zangwdo", type: ActivityType.Watching },
    { name: "Juramento Yakuza ao Zangwdo", type: ActivityType.Listening },
    { name: "Carregando a Yakuza nas costas", type: ActivityType.Playing },
{ name: "Fiscalizando as calls 24/7", type: ActivityType.Watching },
{ name: "Treinando BW no Mush", type: ActivityType.Playing },
{ name: "Calculando horas do ranking", type: ActivityType.Watching },
{ name: "Protegendo território da Yakuza", type: ActivityType.Competing },
{ name: "Escutando os planos do submundo", type: ActivityType.Listening },
{ name: "Gerenciando as horas em call", type: ActivityType.Watching },
{ name: "Preparando a próxima dominação", type: ActivityType.Playing },
{ name: "Monitorando movimentações suspeitas", type: ActivityType.Watching },
{ name: "Organizando o império Yakuza", type: ActivityType.Competing },
{ name: "Operação silêncio absoluto", type: ActivityType.Listening },
{ name: "Contando cada minuto em call", type: ActivityType.Watching },
{ name: "Subindo no ranking da Yakuza", type: ActivityType.Competing },
{ name: "Protegendo o Zangwdo no BW", type: ActivityType.Playing },
{ name: "Observando tudo nas sombras", type: ActivityType.Watching },
{ name: "Planejando o próximo ataque", type: ActivityType.Playing },
{ name: "Leitura estratégica da call", type: ActivityType.Listening },
{ name: "Mantendo a disciplina da Yakuza", type: ActivityType.Competing },
{ name: "Gerenciando transferências de horas", type: ActivityType.Watching },
{ name: "Dominando o Mush em silêncio", type: ActivityType.Playing },
  ];

  let index = 0;

  const applyPresence = () => {
    if (!clientInstance.user) return;
    const activity = activities[index % activities.length];

    clientInstance.user.setPresence({
      status: "online",
      activities: [activity],
    });

    index++;
  };

  applyPresence();
  setInterval(applyPresence, 60_000);
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
client.minecraftBridge = new MinecraftBridgeManager(client);

// =====================
// HELPERS 24/7 VOICE
// =====================
function getAuto247Config(guildId) {
  return AUTO_247.find((x) => x.guildId === guildId) || null;
}

function scheduleReconnect(guildId, reason = "desconectado") {
  if (reconnectTimers.has(guildId)) return;

  const cfg = getAuto247Config(guildId);
  const name = cfg?.guildName || guildId;

  console.log(`ℹ️ [24/7:${name}] Caiu (${reason}). Tentando reconectar em ${AUTO_REJOIN_DELAY_MS / 1000}s...`);

  const t = setTimeout(async () => {
    reconnectTimers.delete(guildId);
    await ensure247Voice(guildId);
  }, AUTO_REJOIN_DELAY_MS);

  reconnectTimers.set(guildId, t);
}

async function ensure247Voice(guildId) {
  const cfg = getAuto247Config(guildId);
  if (!cfg) return;

  const guild = client.guilds.cache.get(cfg.guildId);
  if (!guild) {
    console.warn(`⚠️ [24/7:${cfg.guildName}] Guild não está no cache (o bot está no servidor?).`);
    return;
  }

  // pega canal (cache e fetch)
  let channel = guild.channels.cache.get(cfg.channelId);
  if (!channel) channel = await guild.channels.fetch(cfg.channelId).catch(() => null);

  if (!channel) {
    console.warn(`⚠️ [24/7:${cfg.guildName}] Canal não encontrado: ${cfg.channelId}`);
    return;
  }

  if (!channel.isVoiceBased?.()) {
    console.warn(`⚠️ [24/7:${cfg.guildName}] Canal ${cfg.channelId} não é de voz.`);
    return;
  }

  // permissões básicas (Connect)
  const me = guild.members.me;
  if (me) {
    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.Connect)) {
      console.warn(`⛔ [24/7:${cfg.guildName}] Sem permissão CONNECT em ${channel.name} (${channel.id}).`);
      return;
    }
  }

  // Se já existe conexão no canal correto, não faz nada
  const existing = getVoiceConnection(guild.id);
  if (existing?.joinConfig?.channelId === cfg.channelId) return;

  // se existe conexão em outro canal na mesma guild, destrói e recria
  if (existing) {
    try {
      existing.destroy();
    } catch {}
  }

  try {
    // libsodium precisa estar pronto ANTES de conectar em voz
    await libsodium.ready;
    global.sodium = libsodium;

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: true,
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);

    // Se você quiser que o bot conte no ranking, habilite COUNT_BOT_IN_RANKING=true
    if (COUNT_BOT_IN_RANKING && client.callRanking && client.user) {
      try {
        await client.callRanking.touchUser(guild.id, client.user);
        await client.callRanking.startSession(guild.id, client.user.id);
        await client.callRanking.updateRankingMessage().catch(() => {});
      } catch (e) {
        console.error(`❌ [24/7:${cfg.guildName}] Erro ao registrar sessão do bot no ranking:`, e);
      }
    }

    connection.on("stateChange", (_oldState, newState) => {
      const status = newState?.status;
      if (status === VoiceConnectionStatus.Disconnected || status === VoiceConnectionStatus.Destroyed) {
        scheduleReconnect(guild.id, `voice status: ${status}`);
      }
    });

    console.log(`✅ [24/7:${cfg.guildName}] Conectado em ${channel.name} (${channel.id})`);
  } catch (err) {
    console.error(`❌ [24/7:${cfg.guildName}] Erro ao conectar:`, err);
    scheduleReconnect(guild.id, "erro ao conectar");
  }
}

async function ensureAll247Voices() {
  for (const cfg of AUTO_247) {
    await ensure247Voice(cfg.guildId);
  }
}

// =====================
// CARREGAR COMANDOS
// =====================
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.existsSync(commandsPath)
  ? fs.readdirSync(commandsPath).filter((file) => file.endsWith(".js"))
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

  if (!command || !("data" in command) || !("execute" in command)) {
    console.warn(`[AVISO] O comando em ${filePath} está faltando 'data' ou 'execute'.`);
    continue;
  }

  // Compat: se seu command.data não for SlashCommandBuilder
  if (typeof command.data === "object" && typeof command.data.toJSON !== "function") {
    const { name, description, options = [] } = command.data;
    command.data = {
      name,
      description,
      options,
      toJSON() {
        return { name: this.name, description: this.description, options: this.options };
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
const eventsPath = path.join(__dirname, "events");
const eventFiles = fs.existsSync(eventsPath)
  ? fs.readdirSync(eventsPath).filter((file) => file.endsWith(".js"))
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

  if (!event?.name || typeof event.execute !== "function") {
    console.warn(`[AVISO] Evento inválido em ${filePath} (sem name/execute).`);
    continue;
  }

  if (event.once) client.once(event.name, (...args) => event.execute(...args));
  else client.on(event.name, (...args) => event.execute(...args));
}

console.log(`✅ Events carregados: ${eventFiles.length}`);

// =====================
// REGISTRO SLASH COMMANDS
// =====================
const rest = new REST({ version: "10" }).setToken(TOKEN);

// =====================
// READY
// =====================
client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot iniciado como ${client.user.tag}`);

  startLynnPresence(client);

  // registra slash commands
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commandsForAPI });
    console.log("✅ Comandos slash registrados com sucesso!");
  } catch (error) {
    console.error("❌ Erro ao registrar comandos slash:", error);
  }

  client.ownerId = "1283948475742031912";

  // init sistemas
  try {
    // libsodium ready cedo
    await libsodium.ready;
    global.sodium = libsodium;

    await client.licenses.init();
    console.log("✅ Sistema de licenças inicializado");

    await client.players.init();
    await client.clans.init();

    client.recruitmentManager = new RecruitmentManager(client);

    await client.callRanking.init();
    console.log("✅ Ranking de call inicializado");

    await client.minecraftBridge.init();

    // entra nas 2 calls 24/7
    await ensureAll247Voices();

    console.log("✅ Todos os sistemas inicializados com sucesso");
  } catch (error) {
    console.error("❌ Erro ao inicializar sistemas:", error);
  }
});

// =====================
// INTERAÇÕES
// =====================
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`Command execution error [/${interaction.commandName}]:`, error);

        const errorPayload = {
          embeds: [
            {
              description: "❌ **Ocorreu um erro ao executar este comando!**",
              color: 0xff0000,
            },
          ],
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

      if (["apply_recruitment", "apply_aranked", "close_ticket"].includes(id)) {
        await client.recruitmentManager.handleButton(interaction);
        return;
      }

      if (["cxc", "parceria", "accept_cxc", "decline_cxc"].includes(id)) {
        const adminCxcCommand = client.commands.get("admincxc");
        if (adminCxcCommand?.handleButton) await adminCxcCommand.handleButton(interaction);
        return;
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("paineledit_")) {
        const parts = interaction.customId.split("_");
        const channelId = parts[2];

        const channel = await interaction.guild?.channels.fetch(channelId).catch(() => null);

        if (!channel) {
          await interaction.reply({
            content: "❌ Canal não encontrado. O painel pode ter sido movido ou deletado.",
            ephemeral: true,
          });
          return;
        }

        interaction.channel = channel;
        await client.recruitmentManager.handlePanelEditModal(interaction);
        return;
      }

      if (interaction.customId === "recruitment_modal") {
        await client.recruitmentManager.handleRecruitmentModal(interaction);
        return;
      }

      if (interaction.customId === "aranked_modal") {
        await client.recruitmentManager.handleArankedModal(interaction);
        return;
      }

      if (interaction.customId === "cxc-modal") {
        await client.recruitmentManager.handleCxCModal(interaction);
        return;
      }

      if (interaction.customId === "parceria-modal") {
        await client.recruitmentManager.handleParceriaModal(interaction);
        return;
      }
    }
  } catch (error) {
    console.error("Error handling interaction:", error);
  }
});


// =====================
// MENSAGENS (ponte Discord <-> Minecraft clan chat)
// =====================
client.on("messageCreate", async (message) => {
  try {
    await client.minecraftBridge?.handleDiscordMessage(message);
  } catch (error) {
    console.error("Erro no encaminhamento Discord->Minecraft:", error);
  }
});

// =====================
// VOICE STATE UPDATE (ranking + auto-247)
// =====================
client.on("voiceStateUpdate", async (oldState, newState) => {
  // 1) Ranking (por guild)
  try {
    await client.callRanking?.handleVoiceStateUpdate(oldState, newState);
  } catch (err) {
    console.error("Erro no voiceStateUpdate do ranking:", err);
  }

  // 2) Auto-247 apenas para as guilds configuradas (somente para o BOT)
  try {
    if (!client.user) return;
    if (newState.id !== client.user.id) return;

    const guildId = oldState.guild?.id || newState.guild?.id;
    const cfg = getAuto247Config(guildId);
    if (!cfg) return;

    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;

    if (oldChannelId === cfg.channelId && newChannelId !== cfg.channelId) {
      // se você contabiliza bot no ranking, encerra sessão
      if (COUNT_BOT_IN_RANKING && client.callRanking && client.user) {
        try {
          await client.callRanking.stopSession(guildId, client.user.id);
          await client.callRanking.updateRankingMessage().catch(() => {});
        } catch (e) {
          console.error(`Erro ao encerrar sessão do bot no ranking [${cfg.guildName}]:`, e);
        }
      }

      scheduleReconnect(guildId, "foi removida/movida");
      return;
    }

    if (newChannelId && newChannelId !== cfg.channelId) {
      scheduleReconnect(guildId, "entrou em canal diferente");
      return;
    }

    if (!newChannelId && oldChannelId) {
      scheduleReconnect(guildId, "desconectado");
      return;
    }
  } catch (err) {
    console.error("Erro no auto-247 voiceStateUpdate:", err);
  }
});

// =====================
// LOGS / ERROS
// =====================
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

client.on("error", (error) => {
  console.error("Client Error:", error);
});

client.ws.on("error", (error) => {
  console.error("WebSocket error:", error);
});

// =====================
// LOGIN
// =====================
client.login(TOKEN).catch((err) => {
  console.error("❌ Falha ao logar no Discord:", err);
  process.exit(1);
});
