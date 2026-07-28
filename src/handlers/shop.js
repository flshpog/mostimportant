const { getConfig, cabinetItems } = require('../config/economy');
const eco = require('./economy');

// The single source of truth for what /buy may offer — both its autocomplete and
// its purchase validation call this. Do NOT hardcode the buyable set in the /buy
// command.
//
// Phase 3: the buyable set is the Cabinet (always available, never rotates).
// Phase 4 EXTENDS this function to return `Cabinet + the guild's currently-posted
// shop items` — /buy itself does not change.
//
// Testers (see /twisttester) may buy the entire registry.
function getBuyableItems(guildId, userId) {
    if (userId) {
        const player = eco.getPlayer(guildId, userId);
        if (eco.isTester(player)) return getConfig().items.slice();
    }
    return cabinetItems();
}

module.exports = {
    getBuyableItems,
};
