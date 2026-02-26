const { OWNER_ID, BOT_ADMIN_IDS } = require('../config/botPerms');

function normalize(id) {
  return String(id);
}

function isBotOwner(userId) {
  return normalize(userId) === normalize(OWNER_ID);
}

function isBotAdmin(userId) {
  return isBotOwner(userId) || BOT_ADMIN_IDS.map(normalize).includes(normalize(userId));
}

async function deny(interaction, message) {
  const payload = { content: message, ephemeral: true };

  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply(payload).catch(() => {});
  } else {
    await interaction.editReply(payload).catch(() => {});
  }
}

async function requireBotOwner(interaction) {
  if (isBotOwner(interaction.user.id)) return true;
  await deny(interaction, '🔒 Este comando é exclusivo da dona do bot (Zangwda).');
  return false;
}

async function requireBotAdmin(interaction) {
  if (isBotAdmin(interaction.user.id)) return true;
  await deny(interaction, '🔒 Este comando é exclusivo para administradores do bot.');
  return false;
}

module.exports = {
  isBotOwner,
  isBotAdmin,
  requireBotOwner,
  requireBotAdmin,
};
