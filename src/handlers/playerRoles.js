const fs = require('fs');
const path = require('path');

const ROLES_PATH = path.join(__dirname, '../../data/playerRoles.json');

function load() {
    try {
        return JSON.parse(fs.readFileSync(ROLES_PATH, 'utf8'));
    } catch {
        return {};
    }
}

function save(data) {
    if (!fs.existsSync(path.dirname(ROLES_PATH))) {
        fs.mkdirSync(path.dirname(ROLES_PATH), { recursive: true });
    }
    fs.writeFileSync(ROLES_PATH, JSON.stringify(data, null, 2));
}

function getPlayerRoles(guildId) {
    return load()[guildId] || [];
}

function setPlayerRoles(guildId, roleIds) {
    const data = load();
    data[guildId] = roleIds;
    save(data);
}

// Parse role mentions (<@&123>) and raw IDs from a string, de-duplicated.
function parsePlayerRoleIds(input) {
    const pattern = /<@&(\d+)>|(\d+)/g;
    const ids = [];
    let match;
    while ((match = pattern.exec(input)) !== null) {
        const id = match[1] || match[2];
        if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
}

module.exports = {
    getPlayerRoles,
    setPlayerRoles,
    parsePlayerRoleIds,
};
