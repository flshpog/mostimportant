const { getConfig } = require('../config/economy');
const shop = require('./shop');
const { postShop } = require('./shopService');
const { logToHost } = require('./economyLog');

// Reads the current wall-clock time in the given IANA timezone using the built-in
// Intl API (no dependency, DST-correct because it reads the zone's local parts).
function nowInZoneParts(timeZone) {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
    const parts = fmt.formatToParts(new Date());
    const get = type => Number(parts.find(p => p.type === type).value);
    let hour = get('hour');
    if (hour === 24) hour = 0; // some environments report midnight as 24
    return { hour, minute: get('minute'), second: get('second') };
}

// Milliseconds from now until the next occurrence of post_time in the timezone.
function msUntilNextPost() {
    const cfg = getConfig();
    const [targetH, targetM] = String(cfg.rotation.post_time).split(':').map(Number);
    const { hour, minute, second } = nowInZoneParts(cfg.rotation.timezone);

    const nowSec = hour * 3600 + minute * 60 + second;
    const targetSec = targetH * 3600 + targetM * 60;
    let deltaSec = targetSec - nowSec;
    if (deltaSec <= 0) deltaSec += 24 * 3600; // next day

    return deltaSec * 1000 - new Date().getMilliseconds();
}

async function fire(client) {
    try {
        const autoReroll = getConfig().rotation.auto_reroll;

        // Every guild with a queued shop OR (when auto-reroll is on) a live shop.
        const guildIds = new Set([
            ...shop.guildsWithQueue(),
            ...(autoReroll ? shop.guildsWithShop() : []),
        ]);

        for (const guildId of guildIds) {
            try {
                const queued = shop.getQueuedShop(guildId);
                if (queued) {
                    // A shop was queued - post it as scheduled.
                    await postShop(client, guildId, queued.items);
                    shop.clearQueuedShop(guildId);
                } else if (autoReroll && shop.getCurrentShop(guildId)) {
                    // Nobody queued a shop - auto-reroll a random rotation so the
                    // shop never silently fails to refresh at midnight.
                    const items = shop.randomRotation(guildId);
                    if (items.length) {
                        await postShop(client, guildId, items);
                        await logToHost(client, `🎲 No shop was queued - auto-rerolled a random rotation (${items.length} items).`);
                    }
                }
            } catch (err) {
                console.error(`Scheduled shop post failed for guild ${guildId}:`, err);
                await logToHost(client, `⚠️ Scheduled shop post failed: ${err.message}`);
            }
        }
    } finally {
        scheduleNext(client);
    }
}

function scheduleNext(client) {
    const delay = msUntilNextPost();
    setTimeout(() => fire(client), delay);
    const mins = Math.round(delay / 60000);
    console.log(`Next shop post scheduled in ~${mins} minute(s).`);
}

// Wired from ready.js. Arms the recurring post-time timer.
function startShopScheduler(client) {
    scheduleNext(client);
}

module.exports = { startShopScheduler, msUntilNextPost };
