const fs = require('fs');
const path = require('path');

// Shared config + state store for the two F4 Gauntlet legs. One committed config
// file, one gitignored state file holding two channel-keyed maps.
//
// Config (tunable, committed): config/gauntlet.json
// State (runtime, gitignored):  data/gauntlet.json
//   { "frenzy": { "<channelId>": {...} }, "keys": { "<channelId>": {...} } }
//
// Both legs are scoped to (channel, player): the first person to start a leg in a
// channel owns it, and nothing crosses channels.

const CONFIG_PATH = path.join(__dirname, '../../config/gauntlet.json');
const STATE_PATH = path.join(__dirname, '../../data/gauntlet.json');

// Read fresh each call so hosts can edit prompts, hints and numbers live.
function getConfig() {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function load() {
    try {
        const data = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
        if (!data.frenzy) data.frenzy = {};
        if (!data.keys) data.keys = {};
        return data;
    } catch {
        return { frenzy: {}, keys: {} };
    }
}

function save(data) {
    if (!fs.existsSync(path.dirname(STATE_PATH))) {
        fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    }
    fs.writeFileSync(STATE_PATH, JSON.stringify(data, null, 2));
}

function getRecord(leg, channelId) {
    return load()[leg][channelId] || null;
}

function saveRecord(leg, record) {
    const data = load();
    data[leg][record.channel_id] = record;
    save(data);
}

// Parses "!cmd rest of line" into { cmd, rest }, or null if this isn't a prefix
// command. Mirrors the token handling in loveDay.handleMessage.
function parseCommand(message) {
    const prefix = (message.client.config && message.client.config.prefix) || '!';
    if (!message.content.startsWith(prefix)) return null;
    const rest = message.content.slice(prefix.length).trim();
    if (!rest) return null;
    const cmd = rest.split(/\s+/)[0].toLowerCase();
    return { cmd, rest: rest.slice(cmd.length).trim() };
}

module.exports = { getConfig, load, save, getRecord, saveRecord, parseCommand, STATE_PATH };
