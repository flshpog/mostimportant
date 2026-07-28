const fs = require('fs');
const path = require('path');
const { getConfig, getItem } = require('../config/economy');

// Runtime player state — gitignored, per-deployment. Mirrors the playerRoles.js
// pattern: guild-keyed, synchronous read-modify-write of the whole file.
const ECONOMY_PATH = path.join(__dirname, '../../data/economy.json');

function load() {
    try {
        return JSON.parse(fs.readFileSync(ECONOMY_PATH, 'utf8'));
    } catch {
        return {};
    }
}

function save(data) {
    if (!fs.existsSync(path.dirname(ECONOMY_PATH))) {
        fs.mkdirSync(path.dirname(ECONOMY_PATH), { recursive: true });
    }
    fs.writeFileSync(ECONOMY_PATH, JSON.stringify(data, null, 2));
}

// Non-slot upgrade items — never occupy an inventory slot (SPEC §3).
const NON_SLOT_ITEM_IDS = [12, 20, 24];

function defaultPlayer() {
    return {
        balance: 0,
        // One entry per item instance. Star Wand stacks as repeated entries.
        // Watering Cans (12/20/24) are NOT stored here — see reductions / flimsy_wc.
        items: [],
        // Permanent cooldown reductions. Survive elimination.
        reductions: { golden_wc: false, watering_can: false },
        // once_per_player purchase record, kept independent of the active reduction
        // flag so a host toggling the flag off can't reopen the purchase.
        bought_once: [],
        // One counter per Flimsy Watering Can instance (uses remaining).
        flimsy_wc: [],
        // Global income lock: { until: epochMs, source: 'rock'|'tree'|'bottle' } | null
        cooldown: null,
        eliminated: false,
        // God-mode test toggle (see /twisttester): no cooldowns, all items buyable,
        // free purchases, no slot cap.
        tester: false,
    };
}

// ---- IO ----------------------------------------------------------------------

function getPlayer(guildId, userId) {
    const stored = (load()[guildId] || {})[userId];
    const player = defaultPlayer();
    if (stored) {
        player.balance = stored.balance ?? 0;
        player.items = Array.isArray(stored.items) ? stored.items : [];
        player.reductions = { ...player.reductions, ...(stored.reductions || {}) };
        player.bought_once = Array.isArray(stored.bought_once) ? stored.bought_once : [];
        player.flimsy_wc = Array.isArray(stored.flimsy_wc) ? stored.flimsy_wc : [];
        player.cooldown = stored.cooldown ?? null;
        player.eliminated = stored.eliminated ?? false;
        player.tester = stored.tester ?? false;
    }
    return player;
}

function savePlayer(guildId, userId, player) {
    const data = load();
    if (!data[guildId]) data[guildId] = {};
    data[guildId][userId] = player;
    save(data);
}

// All stored players in a guild, normalized: { userId: player }.
function allPlayers(guildId) {
    const guild = load()[guildId] || {};
    const out = {};
    for (const userId of Object.keys(guild)) out[userId] = getPlayer(guildId, userId);
    return out;
}

// ---- Pure mutators (operate on a player object; caller saves once) -----------

function addBalance(player, amount) {
    player.balance += amount;
    return player;
}

function setBalance(player, amount) {
    player.balance = amount;
    return player;
}

function addItem(player, id, isFake = false) {
    player.items.push({ id: Number(id), is_fake: !!isFake });
    return player;
}

// Removes a single matching instance. If isFake is null, matches on id only.
function removeItem(player, id, isFake = null) {
    const target = Number(id);
    const idx = player.items.findIndex(
        inst => inst.id === target && (isFake === null || inst.is_fake === isFake)
    );
    if (idx !== -1) player.items.splice(idx, 1);
    return player;
}

function setCooldown(player, source, untilMs) {
    player.cooldown = { until: untilMs, source };
    return player;
}

function cooldownRemainingMs(player, now = Date.now()) {
    if (!player.cooldown) return 0;
    return Math.max(0, player.cooldown.until - now);
}

function clearCooldown(player) {
    player.cooldown = null;
    return player;
}

function isEliminated(player) {
    return !!player.eliminated;
}

function isTester(player) {
    return !!player.tester;
}

function setTester(player, value) {
    player.tester = !!value;
    return player;
}

// Additive total reduction, capped by config.max_reduction (SPEC §1).
function totalReduction(player) {
    const r = getConfig().reductions;
    let total = 0;
    if (player.reductions.golden_wc) total += r.golden_wc;
    if (player.reductions.watering_can) total += r.watering_can;

    const activeFlimsy = (player.flimsy_wc || []).filter(uses => uses > 0).length;
    if (activeFlimsy > 0) {
        total += r.flimsy_wc_stacks ? r.flimsy_wc * activeFlimsy : r.flimsy_wc;
    }

    const cap = r.max_reduction ?? 0.85;
    return Math.min(total, cap);
}

// Decrement every Flimsy WC counter by one (once per income run); drop expired.
// Call AFTER computing this run's reduction so the run using the 10th charge
// still benefits from it.
function decrementFlimsy(player) {
    player.flimsy_wc = (player.flimsy_wc || [])
        .map(uses => uses - 1)
        .filter(uses => uses > 0);
    return player;
}

// Slots used, per SPEC §3: Star Wand (any qty) = 1 slot; IDs 12/20/24 = 0 slots;
// every other distinct instance = 1 slot.
function countSlotsUsed(player) {
    const nonSlot = new Set(NON_SLOT_ITEM_IDS);
    const countedStackable = new Set();
    let slots = 0;
    for (const inst of player.items) {
        const item = getItem(inst.id);
        if (!item) continue;
        if (nonSlot.has(item.id) || item.occupies_slot === false) continue;
        if (item.stackable) {
            if (!countedStackable.has(item.id)) {
                countedStackable.add(item.id);
                slots += 1;
            }
        } else {
            slots += 1;
        }
    }
    return slots;
}

module.exports = {
    NON_SLOT_ITEM_IDS,
    defaultPlayer,
    getPlayer,
    savePlayer,
    allPlayers,
    addBalance,
    setBalance,
    addItem,
    removeItem,
    setCooldown,
    cooldownRemainingMs,
    clearCooldown,
    isEliminated,
    isTester,
    setTester,
    totalReduction,
    decrementFlimsy,
    countSlotsUsed,
};
