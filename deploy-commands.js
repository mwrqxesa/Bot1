const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

const commands = [];
const commandsPath = path.join(__dirname, 'commands');

const commandFiles = fs
  .readdirSync(commandsPath)
  .filter(file => file.endsWith('.js') && file !== 'index.js');

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);

  if ('data' in command && 'execute' in command) {
    commands.push(command.data.toJSON()); // ✅ necessário
    console.log(`[INFO] Carregado comando: ${command.data.name}`);
  } else {
    console.log(`[AVISO] ${file} está faltando 'data' ou 'execute'.`);
  }
}

if (!process.env.BOT_TOKEN) {
  console.error('[ERRO] BOT_TOKEN não definido no .env');
  process.exit(1);
}
if (!process.env.CLIENT_ID) {
  console.error('[ERRO] CLIENT_ID não definido no .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

(async () => {
  try {
    console.log(`Deploy de ${commands.length} comando(s)...`);

    // ✅ GUILD (aparece na hora) - recomendado
    if (process.env.GUILD_ID) {
      const data = await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands }
      );
      console.log(`✅ Sucesso! ${data.length} comando(s) registrados na guild.`);
      return;
    }

    // 🌍 GLOBAL (pode demorar pra aparecer)
    const data = await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log(`✅ Sucesso! ${data.length} comando(s) globais atualizados.`);
  } catch (error) {
    console.error('❌ Erro no deploy:', error);
  }
})();
