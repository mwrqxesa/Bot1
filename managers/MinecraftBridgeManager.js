const axios = require("axios");

let mineflayer = null;
try {
  mineflayer = require("mineflayer");
} catch {
  mineflayer = null;
}

function cleanText(text = "") {
  return String(text).replace(/§[0-9A-FK-OR]/gi, "").trim();
}

class MinecraftBridgeManager {
  constructor(client) {
    this.client = client;
    this.bot = null;
    this.pendingCollector = null;

    this.config = {
      enabled: String(process.env.MINECRAFT_BRIDGE_ENABLED || "false").toLowerCase() === "true",
      host: process.env.MINECRAFT_HOST || "localhost",
      port: Number(process.env.MINECRAFT_PORT || 25565),
      version: process.env.MINECRAFT_VERSION || false,
      auth: process.env.MINECRAFT_AUTH || "microsoft",
      username: process.env.MINECRAFT_USERNAME || "",
      password: process.env.MINECRAFT_PASSWORD || undefined,
      clanDiscordChannelId: process.env.MC_CLAN_DISCORD_CHANNEL_ID || "",
      gameCommandDiscordChannelId: process.env.MC_GAME_COMMAND_CHANNEL_ID || "",
    };
  }

  async init() {
    if (!this.config.enabled) {
      console.log("ℹ️ Minecraft bridge desativada (MINECRAFT_BRIDGE_ENABLED=false).");
      return;
    }

    if (!mineflayer) {
      console.warn("⚠️ mineflayer não instalado. Rode npm i mineflayer para ativar a ponte.");
      return;
    }

    if (!this.config.username) {
      console.warn("⚠️ MINECRAFT_USERNAME não configurado. Ponte Minecraft não iniciada.");
      return;
    }

    this.startBot();
  }

  startBot() {
    const options = {
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      auth: this.config.auth,
      version: this.config.version || undefined,
    };

    if (this.config.password) {
      options.password = this.config.password;
    }

    this.bot = mineflayer.createBot(options);

    this.bot.on("login", () => {
      console.log(`✅ [MinecraftBridge] Logado como ${this.bot.username}`);
    });

    this.bot.on("spawn", () => {
      console.log("✅ [MinecraftBridge] Bot entrou no servidor Minecraft.");
    });

    this.bot.on("messagestr", (message, _position, _jsonMsg, sender) => {
      this.handleGameMessage(message, sender);
      this.capturePendingMessage(message);
    });

    this.bot.on("end", (reason) => {
      console.warn(`⚠️ [MinecraftBridge] Conexão encerrada: ${reason}. Reconectando em 10s...`);
      setTimeout(() => this.startBot(), 10_000);
    });

    this.bot.on("error", (error) => {
      console.error("❌ [MinecraftBridge] Erro:", error?.message || error);
    });
  }

  async handleDiscordMessage(message) {
    if (!this.isReady() || message.author.bot) return;

    if (message.channelId !== this.config.clanDiscordChannelId) {
      return;
    }

    const content = (message.content || "").trim();
    if (!content) return;

    const safe = content.replace(/\s+/g, " ").slice(0, 180);
    await this.sendClanMessage(`[Discord] ${message.author.username}: ${safe}`);
  }

  isReady() {
    return !!this.bot && !this.bot.ended;
  }

  async sendClanMessage(message) {
    if (!this.isReady()) throw new Error("Bot do Minecraft não está conectado.");
    const safeMessage = String(message).slice(0, 220);
    this.bot.chat(`/cc ${safeMessage}`);
  }

  async runGameCommandAndCollect(command, { timeoutMs = 6000, maxLines = 8 } = {}) {
    if (!this.isReady()) throw new Error("Bot do Minecraft não está conectado.");

    if (this.pendingCollector) {
      throw new Error("Já existe um comando em coleta. Tente novamente em alguns segundos.");
    }

    return new Promise((resolve) => {
      const buffer = [];
      const timeout = setTimeout(() => {
        this.pendingCollector = null;
        resolve(buffer);
      }, timeoutMs);

      this.pendingCollector = {
        push: (message) => {
          const clean = cleanText(message);
          if (!clean || clean.startsWith("/")) return;
          buffer.push(clean);

          if (buffer.length >= maxLines) {
            clearTimeout(timeout);
            this.pendingCollector = null;
            resolve(buffer);
          }
        },
      };

      this.bot.chat(command);
    });
  }

  capturePendingMessage(message) {
    if (!this.pendingCollector) return;
    this.pendingCollector.push(message);
  }

  async handleGameMessage(rawMessage, sender) {
    const message = cleanText(rawMessage);
    if (!message) return;

    const clanMatch = message.match(/^\s*(?:\[[^\]]+\]\s*)?([A-Za-z0-9_]{3,16})\s*[:»]\s*(.+)$/);
    if (!clanMatch) return;

    const nick = clanMatch[1];
    const content = clanMatch[2].trim();

    if (!content || nick === this.bot?.username || sender === this.bot?.username) return;

    await this.forwardToDiscord(nick, content);

    if (!content.startsWith("!")) return;
    await this.handleGameShortcut(nick, content);
  }

  async forwardToDiscord(nick, content) {
    if (!this.config.clanDiscordChannelId) return;

    const channel = await this.client.channels.fetch(this.config.clanDiscordChannelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    await channel.send(`🎮 **${nick}**: ${content}`);
  }

  async handleGameShortcut(authorNick, content) {
    const [trigger, arg] = content.split(/\s+/, 2);
    const value = (arg || "").trim();

    const respond = async (text) => {
      await this.sendClanMessage(`${authorNick}: ${String(text).slice(0, 180)}`);
    };

    try {
      if (trigger === "!nick") {
        if (!value) return respond("Uso: !nick <jogador>");
        const ok = await this.fetchNick(value);
        return respond(ok ? `${value} existe (não nickado).` : `${value} não encontrado (possível nick).`);
      }

      if (trigger === "!ver" || trigger === "!menu") {
        if (!value) return respond(`Uso: ${trigger} <jogador>`);
        const summary = await this.fetchPlayerSummary(value);
        return respond(summary);
      }

      if (trigger === "!bw") {
        if (!value) return respond("Uso: !bw <jogador>");
        const bw = await this.fetchBedwarsSummary(value);
        return respond(bw);
      }
    } catch (error) {
      await respond(`Erro ao consultar ${trigger}: ${error.message}`);
    }
  }

  async fetchPlayer(nick) {
    const res = await axios.get(`https://mush.com.br/api/player/${encodeURIComponent(nick)}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 10000,
    });

    if (!res.data?.success || !res.data?.response) {
      throw new Error("jogador não encontrado");
    }

    return res.data.response;
  }

  async fetchNick(nick) {
    try {
      await this.fetchPlayer(nick);
      return true;
    } catch {
      return false;
    }
  }

  async fetchPlayerSummary(nick) {
    const p = await this.fetchPlayer(nick);
    const clan = p.clan?.tag ? `[${p.clan.tag}]` : "sem clan";
    return `${p.account?.username || nick} | ${clan} | rank: ${p.rank_tag?.name || "nenhum"} | online: ${p.connected ? "sim" : "não"}`;
  }

  async fetchBedwarsSummary(nick) {
    const p = await this.fetchPlayer(nick);
    const bw = p.stats?.bedwars || {};
    const wins = Number(bw.wins || 0);
    const losses = Number(bw.losses || 0);
    const finals = Number(bw.final_kills || 0);
    const finalDeaths = Math.max(Number(bw.final_deaths || 0), 1);
    const fkdr = (finals / finalDeaths).toFixed(2);
    return `${p.account?.username || nick} BW | lvl ${bw.level || 0} | W ${wins}/${losses} | FKDR ${fkdr} | WS ${bw.winstreak || 0}`;
  }
}

module.exports = MinecraftBridgeManager;
