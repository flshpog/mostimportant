const fs = require('fs');
const path = require('path');

// Per-guild settings for live voice-channel transcription. Read fresh each call
// so hosts can edit config/vctranscription.json and have it take effect without
// a restart, matching how config/org.json is handled.
const CONFIG_PATH = path.join(__dirname, '../../config/vctranscription.json');

function getConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
        return { default: {}, guilds: {} };
    }
}

// A guild's settings, with the `default` block underneath as a fallback. A
// missing or unreadable file yields {} - `enabled` is then falsy, so the feature
// switches itself off rather than recording with made-up numbers.
function guildSettings(guildId) {
    const cfg = getConfig();
    return { ...(cfg.default || {}), ...((cfg.guilds || {})[guildId] || {}) };
}

module.exports = { getConfig, guildSettings };
