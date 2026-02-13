const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

// ===== Premium (mesmo esquema do /premium) =====
const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'premium.json');

function hasUserPremium(userId) {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const db = JSON.parse(raw);
    return Array.isArray(db.users) && db.users.includes(userId);
  } catch {
    return false;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('configurar')
    .setDescription('Configura o sistema de tickets (Premium).')
    // ⚠️ REMOVIDO: setDefaultMemberPermissions(Admin)
    // porque senão não-admin não consegue nem ver o comando.

    .addSubcommand(subcommand =>
      subcommand
        .setName('adicionar_visualizador')
        .setDescription('Adiciona um cargo que pode visualizar tickets')
        .addRoleOption(option =>
          option.setName('cargo')
            .setDescription('Cargo para visualizar tickets')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remover_visualizador')
        .setDescription('Remove um cargo que pode visualizar tickets')
        .addRoleOption(option =>
          option.setName('cargo')
            .setDescription('Cargo a ser removido')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('definir_notificacao')
        .setDescription('Define o cargo que será notificado ao criar tickets')
        .addRoleOption(option =>
          option.setName('cargo')
            .setDescription('Cargo a ser notificado')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('adicionar_notificacao')
        .setDescription('Adiciona um cargo para ser notificado quando tickets forem criados')
        .addRoleOption(option =>
          option.setName('cargo')
            .setDescription('Cargo a ser notificado')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remover_notificacao')
        .setDescription('Remove um cargo das notificações de tickets')
        .addRoleOption(option =>
          option.setName('cargo')
            .setDescription('Cargo a ser removido')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('definir_requisitos')
        .setDescription('Define os requisitos para recrutamento')
        .addNumberOption(option =>
          option.setName('nivel')
            .setDescription('Nível mínimo necessário')
            .setRequired(true)
        )
        .addNumberOption(option =>
          option.setName('fkdr')
            .setDescription('FKDR mínimo necessário')
            .setRequired(true)
        )
    ),

  async execute(interaction) {
    const guildId = interaction.guild.id;

    // Admin OU Premium (usuário)
    const isAdmin = interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator);
    const isPremiumUser = hasUserPremium(interaction.user.id);

    if (!isAdmin && !isPremiumUser) {
      return interaction.reply({
        content: '🔒 Este comando é exclusivo para **usuários com Premium ativado** (ou administradores).',
        ephemeral: true
      });
    }

    const subcommand = interaction.options.getSubcommand();
    const role = interaction.options.getRole('cargo');

    const config = interaction.client.recruitmentManager.getServerConfig(guildId);
    if (!config.ticketViewerRoles) config.ticketViewerRoles = [];
    if (!config.notifyRoles) config.notifyRoles = [];

    switch (subcommand) {
      case 'adicionar_visualizador':
        if (!config.ticketViewerRoles.includes(role.id)) {
          config.ticketViewerRoles.push(role.id);
          interaction.client.recruitmentManager.updateServerConfig(guildId, config);
          return interaction.reply({
            content: `✅ O cargo **${role.name}** foi adicionado aos visualizadores de tickets.`,
            ephemeral: true
          });
        }
        return interaction.reply({
          content: `⚠️ O cargo **${role.name}** já é um visualizador de tickets.`,
          ephemeral: true
        });

      case 'remover_visualizador': {
        const index = config.ticketViewerRoles.indexOf(role.id);
        if (index > -1) {
          config.ticketViewerRoles.splice(index, 1);
          interaction.client.recruitmentManager.updateServerConfig(guildId, config);
          return interaction.reply({
            content: `✅ O cargo **${role.name}** foi removido dos visualizadores de tickets.`,
            ephemeral: true
          });
        }
        return interaction.reply({
          content: `⚠️ O cargo **${role.name}** não é um visualizador de tickets.`,
          ephemeral: true
        });
      }

      case 'definir_notificacao':
        config.notifyRoleId = role.id;
        interaction.client.recruitmentManager.updateServerConfig(guildId, config);
        return interaction.reply({
          content: `✅ O cargo **${role.name}** será notificado quando novos tickets forem criados.`,
          ephemeral: true
        });

      case 'adicionar_notificacao':
        if (!config.notifyRoles.includes(role.id)) {
          config.notifyRoles.push(role.id);
          interaction.client.recruitmentManager.updateServerConfig(guildId, config);
          return interaction.reply({
            content: `✅ O cargo **${role.name}** foi adicionado nas notificações.`,
            ephemeral: true
          });
        }
        return interaction.reply({
          content: `⚠️ O cargo **${role.name}** já está na lista de notificações.`,
          ephemeral: true
        });

      case 'remover_notificacao': {
        const notifyIndex = config.notifyRoles.indexOf(role.id);
        if (notifyIndex > -1) {
          config.notifyRoles.splice(notifyIndex, 1);
          interaction.client.recruitmentManager.updateServerConfig(guildId, config);
          return interaction.reply({
            content: `✅ O cargo **${role.name}** foi removido das notificações.`,
            ephemeral: true
          });
        }
        return interaction.reply({
          content: `⚠️ O cargo **${role.name}** não está na lista de notificações.`,
          ephemeral: true
        });
      }

      case 'definir_requisitos': {
        const nivel = interaction.options.getNumber('nivel');
        const fkdr = interaction.options.getNumber('fkdr');
        config.minLevel = nivel;
        config.minFKDR = fkdr;
        interaction.client.recruitmentManager.updateServerConfig(guildId, config);
        return interaction.reply({
          content: `✅ Requisitos atualizados: **Nível mínimo ${nivel}** e **FKDR mínimo ${fkdr}**.`,
          ephemeral: true
        });
      }
    }
  }
};
