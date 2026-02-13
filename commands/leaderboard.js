const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const axios = require("axios");

const MINIGAMES = {
  bedwars: {
    label: "Bed Wars",
    site: "https://mush.com.br/leaderboard/bedwars",
    // Colunas vistas no site: Nível, Vitórias, Kills, Kills Finais
    columns: [
      { label: "Nível", keys: ["level", "nivel"] },
      { label: "Vitórias", keys: ["wins", "vitorias"] },
      { label: "Kills", keys: ["kills"] },
      { label: "Kills Finais", keys: ["final_kills", "finalKills", "kills_finais"] },
    ],
  },
  skywars: {
    label: "Sky Wars",
    site: "https://mush.com.br/leaderboard/skywars",
    // Site: Nível, Vitórias, Kills, Derrotas, Coins
    columns: [
      { label: "Nível", keys: ["level"] },
      { label: "Vitórias", keys: ["wins"] },
      { label: "Kills", keys: ["kills"] },
      { label: "Derrotas", keys: ["losses", "defeats", "derrotas"] },
      { label: "Coins", keys: ["coins"] },
    ],
  },
  bridge: {
    label: "The Bridge",
    site: "https://mush.com.br/leaderboard/bridge",
    // Site: Vitórias, Derrotas, Pontos
    columns: [
      { label: "Vitórias", keys: ["wins"] },
      { label: "Derrotas", keys: ["losses", "defeats"] },
      { label: "Pontos", keys: ["points", "score", "pontos"] },
    ],
  },
  hg: {
    label: "HG",
    site: "https://mush.com.br/leaderboard/hg",
    // Site: Rank (YYYY/MM), Wins, Kills, Deaths, K/D
    columns: [
      { label: "Rank", keys: ["rank"] },
      { label: "Wins", keys: ["wins"] },
      { label: "Kills", keys: ["kills"] },
      { label: "Deaths", keys: ["deaths"] },
      { label: "K/D", keys: ["kd", "kdr"] },
    ],
  },
  minimush: {
    label: "Minimush",
    site: "https://mush.com.br/leaderboard/minimush",
    // Site: Rank (YYYY/MM), Wins, Kills, Deaths
    columns: [
      { label: "Rank", keys: ["rank"] },
      { label: "Wins", keys: ["wins"] },
      { label: "Kills", keys: ["kills"] },
      { label: "Deaths", keys: ["deaths"] },
    ],
  },
  pvp: {
    label: "PvP",
    site: "https://mush.com.br/leaderboard/pvp",
    // Site: Kills Arena, Deaths Arena, K/D Arena
    columns: [
      { label: "Kills", keys: ["kills", "kills_arena"] },
      { label: "Deaths", keys: ["deaths", "deaths_arena"] },
      { label: "K/D", keys: ["kd", "kdr", "kd_arena"] },
    ],
  },
  soup: {
    label: "Duels: Sopa",
    site: "https://mush.com.br/leaderboard/soup",
    // Site: Rank (YYYY/MM), Vitórias, Derrotas, Winstreak
    columns: [
      { label: "Rank", keys: ["rank"] },
      { label: "Vitórias", keys: ["wins"] },
      { label: "Derrotas", keys: ["losses"] },
      { label: "Winstreak", keys: ["winstreak", "ws"] },
    ],
  },
  gladiator: {
    label: "Duels: Gladiator",
    site: "https://mush.com.br/leaderboard/gladiator",
    columns: [
      { label: "Rank", keys: ["rank"] },
      { label: "Vitórias", keys: ["wins"] },
      { label: "Derrotas", keys: ["losses"] },
      { label: "Winstreak", keys: ["winstreak", "ws"] },
    ],
  },
  party: {
    label: "Party",
    site: "https://mush.com.br/leaderboard/party",
    // Site: Pontos, 1º Lugar, 2º Lugar, 3º Lugar
    columns: [
      { label: "Pontos", keys: ["points", "pontos"] },
      { label: "1º", keys: ["first_place", "first", "firstPlace"] },
      { label: "2º", keys: ["second_place", "second", "secondPlace"] },
      { label: "3º", keys: ["third_place", "third", "thirdPlace"] },
    ],
  },
  ctf: {
    label: "CTF",
    site: "https://mush.com.br/leaderboard/ctf",
    // Site: Capturas, Kills, Coins
    columns: [
      { label: "Capturas", keys: ["captures", "caps"] },
      { label: "Kills", keys: ["kills"] },
      { label: "Coins", keys: ["coins"] },
    ],
  },
  quickbuilders: {
    label: "Quick Builders",
    site: "https://mush.com.br/leaderboard/quickbuilders",
    // Site: Vitórias, Derrotas, Construções perfeitas, Construções totais
    columns: [
      { label: "Vitórias", keys: ["wins"] },
      { label: "Derrotas", keys: ["losses"] },
      { label: "Perfeitas", keys: ["perfect_builds", "perfectBuilds"] },
      { label: "Totais", keys: ["total_builds", "totalBuilds"] },
    ],
  },
  murder: {
    label: "Murder",
    site: "https://mush.com.br/leaderboard/murder",
    // Site: Vitórias, Derrotas
    columns: [
      { label: "Vitórias", keys: ["wins"] },
      { label: "Derrotas", keys: ["losses"] },
    ],
  },
};

function toBR(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "0";
  return num.toLocaleString("pt-BR");
}

function pick(obj, keys, fallback = 0) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return fallback;
}

async function fetchLeaderboard(minigame) {
  const url = `https://mush.com.br/api/leaderboard/${encodeURIComponent(minigame)}`;
  const res = await axios.get(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  return res.data;
}

function buildEmbed({ minigame, top, page, data }) {
  const cfg = MINIGAMES[minigame];
  const perPage = Math.min(Math.max(top, 5), 25); // por segurança no embed
  const total = Array.isArray(data) ? data.length : 0;

  const maxPage = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(Math.max(page, 1), maxPage);

  const start = (safePage - 1) * perPage;
  const slice = (Array.isArray(data) ? data : []).slice(start, start + perPage);

  const lines = slice.map((p, i) => {
    const pos = start + i + 1;

    const username = p.username || p.nick || p.name || `Player ${pos}`;
    // alguns retornos podem ter clan/tag separada
    const clanTag = p.clan_tag || p.tag || (p.clan && p.clan.tag) || null;
    const nameWithClan = clanTag ? `${username} [${clanTag}]` : username;

    const stats = cfg.columns.map(col => {
      const v = pick(p, col.keys, 0);
      // K/D às vezes vem como string "3,24" no site; na API pode vir number/string
      const pretty = typeof v === "string" ? v : toBR(v);
      return `${col.label}: **${pretty}**`;
    });

    return `**#${pos}** ${nameWithClan}\n➥ ${stats.join(" • ")}`;
  });

  return new EmbedBuilder()
    .setTitle(`🏆 Leaderboard • ${cfg.label}`)
    .setColor("#0099ff")
    .setDescription(
      lines.length
        ? lines.join("\n\n")
        : "Não consegui montar o ranking (resposta vazia)."
    )
    .setFooter({ text: `Página ${safePage}/${maxPage} • Mostrando ${perPage} por página` })
    .setTimestamp();
}

function buildComponents({ minigame, top, page, disableAll = false }) {
  const modeMenu = new StringSelectMenuBuilder()
    .setCustomId(`lb:mode:${top}:${page}`)
    .setPlaceholder("Selecione um modo")
    .addOptions(
      Object.entries(MINIGAMES).map(([key, cfg]) => ({
        label: cfg.label,
        value: key,
        default: key === minigame,
      }))
    );

  const topMenu = new StringSelectMenuBuilder()
    .setCustomId(`lb:top:${minigame}:${page}`)
    .setPlaceholder("TOP (por página)")
    .addOptions(
      [10, 15, 20, 25].map(n => ({
        label: `Top ${n} (por página)`,
        value: String(n),
        default: n === top,
      }))
    );

  const prev = new ButtonBuilder()
    .setCustomId(`lb:page:${minigame}:${top}:${page - 1}`)
    .setLabel("◀")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disableAll || page <= 1);

  const next = new ButtonBuilder()
    .setCustomId(`lb:page:${minigame}:${top}:${page + 1}`)
    .setLabel("▶")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disableAll);

  const site = new ButtonBuilder()
    .setLabel("Abrir no site")
    .setStyle(ButtonStyle.Link)
    .setURL(MINIGAMES[minigame].site);

  const row1 = new ActionRowBuilder().addComponents(modeMenu);
  const row2 = new ActionRowBuilder().addComponents(topMenu);
  const row3 = new ActionRowBuilder().addComponents(prev, next, site);

  return [row1, row2, row3];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("[Mush] Veja os rankings (top 100) por minigame.")
    .addStringOption(opt =>
      opt
        .setName("modo")
        .setDescription("Minigame do ranking")
        .setRequired(false)
        .addChoices(
          ...Object.entries(MINIGAMES).map(([value, cfg]) => ({
            name: cfg.label,
            value,
          }))
        )
    )
    .addIntegerOption(opt =>
      opt
        .setName("top")
        .setDescription("Quantos mostrar por página (máx 25 recomendado)")
        .setRequired(false)
        .addChoices(
          { name: "10", value: 10 },
          { name: "15", value: 15 },
          { name: "20", value: 20 },
          { name: "25", value: 25 }
        )
    ),

  async execute(interaction) {
    await interaction.deferReply();

    let minigame = interaction.options.getString("modo") || "bedwars";
    let top = interaction.options.getInteger("top") || 10;
    let page = 1;

    if (!MINIGAMES[minigame]) minigame = "bedwars";
    if (![10, 15, 20, 25].includes(top)) top = 10;

    try {
      const data = await fetchLeaderboard(minigame);

      const embed = buildEmbed({ minigame, top, page, data });
      const components = buildComponents({ minigame, top, page });

      await interaction.editReply({
        content: `<:Mush:1324516271588376718> » Ranking de **${MINIGAMES[minigame].label}**`,
        embeds: [embed],
        components,
      });

      const message = await interaction.fetchReply();

      const collector = message.createMessageComponentCollector({
        time: 60_000,
        filter: i => i.user.id === interaction.user.id,
      });

      collector.on("collect", async i => {
        try {
          const [prefix, kind, a, b, c] = i.customId.split(":");

          if (prefix !== "lb") return;

          // recarrega dados sempre que mudar algo (simples e confiável)
          if (kind === "mode") {
            const newTop = Number(a);
            const newPage = Number(b);
            minigame = i.values[0];
            top = newTop;
            page = newPage;

          } else if (kind === "top") {
            const newMinigame = a;
            const newPage = Number(b);
            minigame = newMinigame;
            top = Number(i.values[0]);
            page = newPage;

          } else if (kind === "page") {
            minigame = a;
            top = Number(b);
            page = Number(c);
          }

          if (!MINIGAMES[minigame]) minigame = "bedwars";
          if (![10, 15, 20, 25].includes(top)) top = 10;
          if (!Number.isFinite(page) || page < 1) page = 1;

          const data = await fetchLeaderboard(minigame);
          const embed = buildEmbed({ minigame, top, page, data });

          const components = buildComponents({ minigame, top, page });

          await i.update({
            content: `<:Mush:1324516271588376718> » Ranking de **${MINIGAMES[minigame].label}**`,
            embeds: [embed],
            components,
          });
        } catch (err) {
          console.error("Erro no leaderboard collector:", err);
          if (!i.deferred && !i.replied) {
            await i.reply({ content: "❌ Erro ao atualizar o ranking.", ephemeral: true }).catch(() => {});
          }
        }
      });

      collector.on("end", async () => {
        // desativa componentes ao expirar
        const disabled = buildComponents({ minigame, top, page, disableAll: true });
        await interaction.editReply({ components: disabled }).catch(() => {});
      });

    } catch (error) {
      console.error("Erro ao buscar leaderboard:", error?.message || error);
      await interaction.editReply("❌ Não foi possível obter a leaderboard agora. Tente novamente mais tarde.");
    }
  },
};
