// Parsing for the free-text role fields used by /alliance and /tribe1on1s, where
// a host pastes a mix of role mentions and raw IDs into one option.

// Pulls role IDs out of a string of mentions (<@&123>) and/or bare IDs, in the
// order given, without duplicates.
function parseRoleIds(input) {
    const pattern = /<@&(\d+)>|(\d+)/g;
    const ids = [];
    let match;
    while ((match = pattern.exec(String(input || ''))) !== null) {
        const id = match[1] || match[2];
        if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
}

// Resolves those IDs against a guild. `valid` holds Role objects, `invalid` the
// IDs that aren't roles here - worth surfacing, since a role ID copied from
// another server is a common and otherwise silent mistake.
function resolveRoles(guild, input) {
    const valid = [];
    const invalid = [];
    for (const id of parseRoleIds(input)) {
        const role = guild.roles.cache.get(id);
        if (role) valid.push(role);
        else invalid.push(id);
    }
    return { valid, invalid };
}

module.exports = { parseRoleIds, resolveRoles };
