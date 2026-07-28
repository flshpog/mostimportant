const { getConfig } = require('../config/economy');

// True if the interaction is running inside the host category. This is the
// backstop behind role permissions for every host command (SPEC §6 / CLAUDE.md).
function inHostCategory(interaction) {
    const category = getConfig().channels.host_category;
    return !!category && interaction.channel?.parentId === category;
}

// Rejects (ephemerally) and returns false if not in the host category. Use at the
// top of every host command:  if (!(await ensureHost(interaction))) return;
async function ensureHost(interaction) {
    if (!interaction.inGuild()) {
        await interaction.reply({ content: 'This command can only be used in the server.', ephemeral: true });
        return false;
    }
    if (!inHostCategory(interaction)) {
        await interaction.reply({
            content: '⛔ This is a host-only command and can only be run inside the host category.',
            ephemeral: true,
        });
        return false;
    }
    return true;
}

module.exports = { inHostCategory, ensureHost };
