const { cabinetItems } = require('../config/economy');

// The single source of truth for what /buy may offer — both its autocomplete and
// its purchase validation call this. Do NOT hardcode the buyable set in the /buy
// command.
//
// Phase 3: the buyable set is the Cabinet (always available, never rotates).
// Phase 4 EXTENDS this function to return `Cabinet + the guild's currently-posted
// shop items` — /buy itself does not change.
function getBuyableItems(guildId) {
    return cabinetItems();
}

module.exports = {
    getBuyableItems,
};
