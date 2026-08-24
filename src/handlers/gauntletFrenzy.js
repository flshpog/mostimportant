const { AttachmentBuilder } = require('discord.js');
const store = require('./gauntletState');
const bugFrenzy = require('./bugFrenzy');
const fishingFrenzy = require('./fishingFrenzy');

// The Frenzy (F4). A solo catching leg: one spawn every interval_seconds, strictly
// alternating bugs (odd spawns, name shown) and fish (even spawns, image only), until
// the player has required_catches catches. There is NO spawn cap and no way past the
// leg without them.
//
// Spawn/window/react logic follows bugFrenzy.js; the fish images come from the Fishing
// Frenzy pool and cache. Creatures are never redefined here - the pools stay in
// config/bugfrenzy.json and config/fishing.json.
//
// Nothing here records time or score.

const LEG = 'frenzy';

// One timer per channel, so parallel runs never see each other. Rebuilt on resume.
const spawnTimers = new Map();

function getRun(channelId) {
    return store.getRecord(LEG, channelId);
}

function saveRun(record) {
    store.saveRecord(LEG, record);
}

// --- Creature selection ------------------------------------------------------

function pickRarity(weights) {
    const entries = Object.entries(weights || {});
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let r = Math.random() * total;
    for (const [rarity, w] of entries) {
        r -= w;
        if (r < 0) return rarity;
    }
    return entries.length ? entries[entries.length - 1][0] : 'Common';
}

// A random creature of the given rarity from the existing pool. Falls back to the
// whole pool if a rarity has no members, so a config edit can't produce a dead spawn.
function pickCreature(kind, rarity) {
    const pool = kind === 'bug'
        ? bugFrenzy.getConfig().bugs
        : fishingFrenzy.getConfig().fish;
    const matching = pool.filter(c => c.rarity === rarity);
    const from = matching.length ? matching : pool;
    return from[Math.floor(Math.random() * from.length)] || null;
}

function windowSecondsFor(config, kind, rarity) {
    const windows = (config.frenzy.windows || {})[kind] || {};
    const base = windows[rarity];
    const floor = config.frenzy.min_window_seconds || 3;
    return Math.max(floor, base || floor);
}

// Every accepted catch string for a creature, from the configured phrase template.
function catchPhrasesFor(config, kind, creature) {
    const template = kind === 'bug'
        ? (config.frenzy.bug_catch_phrase || 'i catch the {bug}')
        : (config.frenzy.fish_catch_phrase || 'i reel in the {fish}');
    const token = kind === 'bug' ? '{bug}' : '{fish}';
    const names = [creature.name, ...(creature.aliases || [])];
    return names.map(n => bugFrenzy.normalize(template.replace(token, n)));
}

// --- Scheduling --------------------------------------------------------------

function clearTimer(channelId) {
    clearTimeout(spawnTimers.get(channelId));
    spawnTimers.delete(channelId);
}

function scheduleNextSpawn(client, channelId, delayMs) {
    clearTimer(channelId);
    const config = store.getConfig();
    const delay = typeof delayMs === 'number'
        ? Math.max(1000, delayMs)
        : (config.frenzy.interval_seconds || 30) * 1000;

    spawnTimers.set(channelId, setTimeout(() => {
        doSpawn(client, channelId).catch(err =>
            console.error('Gauntlet frenzy spawn error:', err));
    }, delay));
}

// --- Spawning ----------------------------------------------------------------

async function doSpawn(client, channelId) {
    const run = getRun(channelId);
    if (!run || !run.active || run.paused || run.finished) return;

    const config = store.getConfig();

    // Idle pause: did the player say ANYTHING in this channel since the last spawn?
    // Six silent spawns in a row means nobody's there. This only stops the bot talking
    // to an empty room; the catches they still owe are untouched.
    if (run.spawn_index > 0) {
        if (run.activity_since_last_spawn) {
            run.idle_spawns = 0;
        } else {
            run.idle_spawns = (run.idle_spawns || 0) + 1;
        }
    }
    run.activity_since_last_spawn = false;

    const idleLimit = config.frenzy.idle_spawns_before_pause || 6;
    if ((run.idle_spawns || 0) >= idleLimit) {
        run.paused = true;
        run.active = false;
        run.current_spawn = null;
        saveRun(run);
        clearTimer(channelId);
        try {
            const channel = await client.channels.fetch(channelId);
            if (channel && channel.isTextBased()) {
                await channel.send(config.frenzy.idle_pause_message);
            }
        } catch (err) {
            console.error('Gauntlet frenzy: pause notice failed:', err.message);
        }
        return;
    }

    // Odd spawns are bugs, even are fish. spawn_index is 0-based, so spawn number is
    // spawn_index + 1: index 0 -> spawn 1 -> bug.
    const kind = run.spawn_index % 2 === 0 ? 'bug' : 'fish';
    const rarity = pickRarity(config.frenzy.rarity_weights);
    const creature = pickCreature(kind, rarity);
    if (!creature) return;

    const windowMs = windowSecondsFor(config, kind, creature.rarity || rarity) * 1000;

    let payload;
    if (kind === 'bug') {
        const flavor = creature.flavor || config.frenzy.bug_default_flavor || 'appears';
        payload = {
            content: (config.frenzy.bug_spawn_message || 'A **{bug}** {flavor}! Catch it!')
                .replace('{bug}', creature.name)
                .replace('{flavor}', flavor),
        };
    } else {
        // The image IS the puzzle. Attach the bytes under a neutral filename so neither
        // the species name nor the source URL is reachable by the player.
        let buffer;
        try {
            buffer = await fishingFrenzy.imageBufferFor(creature, config.frenzy.image_upscale_px);
        } catch (err) {
            console.error(`Gauntlet frenzy: no image for ${creature.name}:`, err.message);
            scheduleNextSpawn(client, channelId);
            return;
        }
        payload = {
            content: config.frenzy.fish_spawn_message || 'Something bites! Reel it in!',
            files: [new AttachmentBuilder(buffer, {
                name: config.frenzy.attachment_filename || 'fish.png',
            })],
        };
    }

    let messageId = null;
    try {
        const channel = await client.channels.fetch(channelId);
        if (channel && channel.isTextBased()) {
            const msg = await channel.send(payload);
            messageId = msg.id;
        }
    } catch (err) {
        console.error('Gauntlet frenzy: failed to post spawn:', err.message);
        scheduleNextSpawn(client, channelId);
        return;
    }

    // Re-read: a catch may have landed while we were posting.
    const fresh = getRun(channelId);
    if (!fresh || !fresh.active) return;
    fresh.idle_spawns = run.idle_spawns;
    fresh.activity_since_last_spawn = false;
    fresh.spawn_index = (fresh.spawn_index || 0) + 1;
    fresh.current_spawn = {
        kind,
        name: creature.name,
        rarity: creature.rarity || rarity,
        close_at: Date.now() + windowMs,
        message_id: messageId,
        claimed: false,
    };
    saveRun(fresh);

    scheduleNextSpawn(client, channelId);
}

// --- Message hook ------------------------------------------------------------

async function handleMessage(message) {
    if (!message.guild || message.author.bot) return;

    const parsed = store.parseCommand(message);
    if (parsed && parsed.cmd === 'thefrenzy') {
        return handleStart(message);
    }

    return handleCatch(message);
}

// !thefrenzy - start, or resume from an idle pause. The first person to run it in a
// channel becomes that channel's player.
async function handleStart(message) {
    const config = store.getConfig();
    const existing = getRun(message.channel.id);

    if (existing) {
        if (existing.finished) return;                              // leg done - silent
        if (existing.player_id !== message.author.id) return;       // not their run
        if (existing.active && !existing.paused) return;            // already running

        // Resume with the catch count and spawn parity intact.
        existing.active = true;
        existing.paused = false;
        existing.idle_spawns = 0;
        existing.activity_since_last_spawn = true;
        saveRun(existing);

        await message.channel.send(config.frenzy.resume_message).catch(() => {});
        scheduleNextSpawn(message.client, message.channel.id, 1000);
        return;
    }

    saveRun({
        channel_id: message.channel.id,
        player_id: message.author.id,
        active: true,
        paused: false,
        finished: false,
        catches: 0,
        spawn_index: 0,
        idle_spawns: 0,
        activity_since_last_spawn: true,
        current_spawn: null,
    });

    await message.channel.send(config.frenzy.start_message).catch(() => {});
    scheduleNextSpawn(message.client, message.channel.id, 1000); // first spawn right away
}

async function handleCatch(message) {
    const data = store.load();
    const run = data[LEG][message.channel.id];
    if (!run || !run.active || run.finished) return;
    if (run.player_id !== message.author.id) return;

    // ANY message from the player counts as activity for the idle check, catch or not.
    run.activity_since_last_spawn = true;

    const spawn = run.current_spawn;
    if (!spawn || spawn.claimed) {
        store.save(data);
        return;
    }

    const config = store.getConfig();
    const pool = spawn.kind === 'bug'
        ? bugFrenzy.getConfig().bugs
        : fishingFrenzy.getConfig().fish;
    const creature = pool.find(c => c.name === spawn.name);
    if (!creature) {
        store.save(data);
        return;
    }

    const accepted = catchPhrasesFor(config, spawn.kind, creature);
    if (!accepted.includes(bugFrenzy.normalize(message.content))) {
        store.save(data); // still counts as activity
        return;
    }

    // Right phrase, window shut: nothing happens on a miss.
    if (Date.now() > spawn.close_at) {
        store.save(data);
        return;
    }

    // Claim synchronously before any await, matching bugFrenzy's ordering.
    spawn.claimed = true;
    run.catches = (run.catches || 0) + 1;

    const required = config.frenzy.required_catches || 10;
    const done = run.catches >= required;
    if (done) {
        run.active = false;
        run.finished = true;
        run.current_spawn = null;
    }
    store.save(data);

    await message.react('✅').catch(() => {});

    if (done) {
        clearTimer(message.channel.id);
        await message.channel.send(config.frenzy.completion_message).catch(() => {});
    }
}

// On startup: re-arm any run that was mid-flight. A paused or finished run stays put.
function resumeAll(client) {
    const data = store.load();
    for (const [channelId, run] of Object.entries(data[LEG] || {})) {
        if (!run || !run.active || run.paused || run.finished) continue;
        scheduleNextSpawn(client, channelId, 5000);
        console.log(`Resumed Gauntlet frenzy in channel ${channelId} (${run.catches || 0} catches).`);
    }
}

module.exports = {
    handleMessage,
    resumeAll,
    getRun,
    pickRarity,
    pickCreature,
    windowSecondsFor,
    catchPhrasesFor,
};
