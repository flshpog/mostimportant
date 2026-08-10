const fs = require('fs');
const path = require('path');
const { getConfig, getItem, cabinetItems, itemsByCategory } = require('../config/economy');
const eco = require('./economy');

// Runtime shop state — gitignored. Per guild: available unit counts (only stored
// when they diverge from the config default), the currently-posted shop, and any
// queued shop awaiting the midnight post.
const SHOP_PATH = path.join(__dirname, '../../data/shop.json');

function load() {
    try {
        return JSON.parse(fs.readFileSync(SHOP_PATH, 'utf8'));
    } catch {
        return {};
    }
}

function save(data) {
    if (!fs.existsSync(path.dirname(SHOP_PATH))) {
        fs.mkdirSync(path.dirname(SHOP_PATH), { recursive: true });
    }
    fs.writeFileSync(SHOP_PATH, JSON.stringify(data, null, 2));
}

function getGuild(data, guildId) {
    if (!data[guildId]) data[guildId] = { units: {}, current: null, queued: null };
    if (!data[guildId].units) data[guildId].units = {};
    return data[guildId];
}

// --- Availability (the state machine, SPEC §5) -------------------------------

// Offerable units left for an item. Config stock null => unlimited (Infinity).
// A stored units[id] overrides the config default (set as items are bought/returned).
function availableUnits(guildId, itemId) {
    const item = getItem(itemId);
    if (!item) return 0;
    const guild = load()[guildId];
    if (guild && guild.units && Object.prototype.hasOwnProperty.call(guild.units, itemId)) {
        return guild.units[itemId];
    }
    return item.stock === null ? Infinity : item.stock;
}

function isAvailable(guildId, itemId) {
    return availableUnits(guildId, itemId) > 0;
}

// Spend one unit after a purchase. Unlimited-stock items aren't tracked.
function consumeUnit(guildId, itemId) {
    const item = getItem(itemId);
    if (!item || item.stock === null) return;
    const data = load();
    const guild = getGuild(data, guildId);
    const current = Object.prototype.hasOwnProperty.call(guild.units, itemId)
        ? guild.units[itemId]
        : item.stock;
    guild.units[itemId] = Math.max(0, current - 1);
    save(data);
}

// Return one unit to the available pool — a host marked a refreshing item `used`.
// Capped at the item's original stock.
function returnUnit(guildId, itemId) {
    const item = getItem(itemId);
    if (!item || item.stock === null) return;
    const data = load();
    const guild = getGuild(data, guildId);
    const current = Object.prototype.hasOwnProperty.call(guild.units, itemId)
        ? guild.units[itemId]
        : item.stock;
    guild.units[itemId] = Math.min(item.stock, current + 1);
    save(data);
}

// --- Current / queued shop ---------------------------------------------------

function getCurrentShop(guildId) {
    const guild = load()[guildId];
    return guild ? guild.current : null;
}

function setCurrentShop(guildId, current) {
    const data = load();
    getGuild(data, guildId).current = current;
    save(data);
}

function getQueuedShop(guildId) {
    const guild = load()[guildId];
    return guild ? guild.queued : null;
}

function setQueuedShop(guildId, queued) {
    const data = load();
    getGuild(data, guildId).queued = queued;
    save(data);
}

function clearQueuedShop(guildId) {
    setQueuedShop(guildId, null);
}

function guildsWithQueue() {
    const data = load();
    return Object.keys(data).filter(gid => data[gid] && data[gid].queued);
}

// Guilds that have a shop currently posted (i.e. the economy is live there).
function guildsWithShop() {
    const data = load();
    return Object.keys(data).filter(gid => data[gid] && data[gid].current);
}

// --- For command autocomplete ------------------------------------------------

// Items in a category that are still available to be slotted into a rotation.
function offerableItems(guildId, category) {
    return itemsByCategory(category).filter(item => isAvailable(guildId, item.id));
}

// Build a random rotation from the currently-available items: the configured
// number of Specials / Golden / Standard, shuffled. If a category has fewer
// available than its target count, it simply contributes what's available.
// Returns an array of item IDs (Cabinet + Loan are appended by rendering).
function randomRotation(guildId) {
    const rotation = getConfig().rotation;
    const plan = [
        ['special', rotation.specials],
        ['golden', rotation.golden],
        ['standard', rotation.standard],
    ];

    const ids = [];
    for (const [category, count] of plan) {
        const pool = offerableItems(guildId, category);
        // Fisher–Yates shuffle.
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        for (const item of pool.slice(0, count)) ids.push(item.id);
    }
    return ids;
}

// --- The single buyable-set seam ---------------------------------------------

// Both /buy autocomplete and validation call this — the one source of truth.
// Testers may buy the entire registry; everyone else gets the Cabinet plus the
// in-stock items in the currently-posted shop.
function getBuyableItems(guildId, userId) {
    if (userId) {
        const player = eco.getPlayer(guildId, userId);
        if (eco.isTester(player)) return getConfig().items.slice();
    }
    const cabinet = cabinetItems();
    const current = getCurrentShop(guildId);
    const shopItems = current
        ? current.items.map(id => getItem(id)).filter(item => item && isAvailable(guildId, item.id))
        : [];
    const byId = new Map();
    for (const item of [...shopItems, ...cabinet]) byId.set(item.id, item);
    return [...byId.values()];
}

module.exports = {
    availableUnits,
    isAvailable,
    consumeUnit,
    returnUnit,
    getCurrentShop,
    setCurrentShop,
    getQueuedShop,
    setQueuedShop,
    clearQueuedShop,
    guildsWithQueue,
    guildsWithShop,
    offerableItems,
    randomRotation,
    getBuyableItems,
};
