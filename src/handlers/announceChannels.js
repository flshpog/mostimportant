const fs = require('fs');
const path = require('path');

// Stored confessional / submission channel lists, per guild. Mirrors the
// playerRoles.js pattern. Shape: { [guildId]: { confessionals: [ids], submissions: [ids] } }
const CHANNELS_PATH = path.join(__dirname, '../../data/announceChannels.json');

function load() {
    try {
        return JSON.parse(fs.readFileSync(CHANNELS_PATH, 'utf8'));
    } catch {
        return {};
    }
}

function save(data) {
    if (!fs.existsSync(path.dirname(CHANNELS_PATH))) {
        fs.mkdirSync(path.dirname(CHANNELS_PATH), { recursive: true });
    }
    fs.writeFileSync(CHANNELS_PATH, JSON.stringify(data, null, 2));
}

// kind = 'confessionals' | 'submissions'
function getChannels(guildId, kind) {
    return (load()[guildId] || {})[kind] || [];
}

function setChannels(guildId, kind, channelIds) {
    const data = load();
    if (!data[guildId]) data[guildId] = {};
    data[guildId][kind] = channelIds;
    save(data);
}

// Parse channel mentions (<#123>) and raw IDs from a string, de-duplicated.
function parseChannelIds(input) {
    const pattern = /<#(\d+)>|(\d+)/g;
    const ids = [];
    let match;
    while ((match = pattern.exec(input)) !== null) {
        const id = match[1] || match[2];
        if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
}

module.exports = {
    getChannels,
    setChannels,
    parseChannelIds,
};
