const fs = require('node:fs');
const path = require('node:path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'premium.json');

function hasUserPremium(userId) {
  try {
    const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(db.users) && db.users.includes(userId);
  } catch {
    return false;
  }
}

function requirePremiumOrAdmin(interaction) {
  const isAdmin = interaction.memberPermissions?.has?.('Administrator');
  const isPremium = hasUserPremium(interaction.user.id);
  return { allowed: Boolean(isAdmin || isPremium), isAdmin, isPremium };
}

module.exports = { hasUserPremium, requirePremiumOrAdmin };
