const fs = require('fs');
const path = require('path');

// Committed game definition (SPEC §9). Read fresh each call so hosts can edit
// config/economy.json and have changes take effect without a code change - the
// single most important rule of this build.
const CONFIG_PATH = path.join(__dirname, '../../config/economy.json');

function getConfig() {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function getItem(id) {
    const target = Number(id);
    return getConfig().items.find(item => item.id === target) || null;
}

function getItemByName(name) {
    const target = String(name).trim().toLowerCase();
    return getConfig().items.find(item => item.name.toLowerCase() === target) || null;
}

function itemsByCategory(category) {
    return getConfig().items.filter(item => item.category === category);
}

function cabinetItems() {
    return itemsByCategory('cabinet');
}

function slotCap() {
    return getConfig().inventory.slot_cap;
}

// e.g. "7,500 <:Bells:...>" - comma-separated, no decimals, with the Bells emoji.
function formatBells(amount) {
    const cfg = getConfig();
    const num = Number(amount).toLocaleString('en-US');
    return `${num} ${cfg.emoji.bells}`;
}

module.exports = {
    getConfig,
    getItem,
    getItemByName,
    itemsByCategory,
    cabinetItems,
    slotCap,
    formatBells,
};
