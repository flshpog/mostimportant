const fs = require('fs');
const path = require('path');

// Per-guild settings for the org channel commands. Read fresh each call so hosts
// can edit config/org.json and have it take effect without a restart, matching
// how config/economy.json is handled.
const CONFIG_PATH = path.join(__dirname, '../../config/org.json');

function getConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
        return { default: {}, guilds: {} };
    }
}

// A guild's settings, with the `default` block underneath as a fallback. An
// unconfigured server gets the defaults rather than an error.
function guildSettings(guildId) {
    const cfg = getConfig();
    return { ...(cfg.default || {}), ...((cfg.guilds || {})[guildId] || {}) };
}

// The spectator Role object for this guild, or null when the server has none.
// Also returns null if the configured ID isn't a role here — passing an ID from
// another server to channels.create() is rejected by Discord and fails the whole
// call, which is exactly what broke these commands outside the main server.
function spectatorRole(guild) {
    if (!guild) return null;
    const id = guildSettings(guild.id).spectator_role;
    if (!id) return null;
    return guild.roles.cache.get(id) || null;
}

module.exports = { getConfig, guildSettings, spectatorRole };
