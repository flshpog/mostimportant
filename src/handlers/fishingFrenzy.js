const fs = require('fs');
const path = require('path');
const https = require('https');
const { AttachmentBuilder } = require('discord.js');

// CJ's Fishing Frenzy - a timed individual challenge. The bot posts an IMAGE of a
// fish with no text identifying it; the first player to name it inside the window
// scores. Built parallel to bugFrenzy.js rather than sharing an engine with it -
// Bug Frenzy is shipped and working, and this has different enough rules that
// abstracting them together would risk both.
//
// Config (tunable, committed): config/fishing.json
// State (runtime, gitignored):  data/fishing.json, keyed by guildId.

const CONFIG_PATH = path.join(__dirname, '../../config/fishing.json');
const STATE_PATH = path.join(__dirname, '../../data/fishing.json');
const OVERRIDE_PATH = path.join(__dirname, '../../data/fishingRuntime.json');

// In-memory (rebuilt on resume, never persisted).
const spawnTimers = new Map();
const endTimers = new Map();
const closeTimers = new Map();
const imageCache = new Map();          // fish name -> Buffer
const lastLeaderboardEdit = new Map(); // guildId -> ts
const pendingLeaderboard = new Map();  // guildId -> timeout

function loadOverride() {
    try {
        return JSON.parse(fs.readFileSync(OVERRIDE_PATH, 'utf8'));
    } catch {
        return {};
    }
}

// Config = committed defaults with any runtime overrides layered on top.
function getConfig() {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const override = loadOverride();
    if (typeof override.test_mode === 'boolean') config.test_mode = override.test_mode;
    return config;
}

// Toggle test mode without editing the config file. Returns the new value.
function setTestMode(on) {
    const override = loadOverride();
    override.test_mode = !!on;
    if (!fs.existsSync(path.dirname(OVERRIDE_PATH))) {
        fs.mkdirSync(path.dirname(OVERRIDE_PATH), { recursive: true });
    }
    fs.writeFileSync(OVERRIDE_PATH, JSON.stringify(override, null, 2));
    return override.test_mode;
}

function load() {
    try {
        return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    } catch {
        return {};
    }
}

function save(data) {
    if (!fs.existsSync(path.dirname(STATE_PATH))) {
        fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    }
    fs.writeFileSync(STATE_PATH, JSON.stringify(data, null, 2));
}

function getState(guildId) {
    return load()[guildId] || null;
}

// --- Helpers -----------------------------------------------------------------

function randRange(min, max) {
    return Math.random() * (max - min) + min;
}

function pickWeightedFish(config) {
    const total = config.fish.reduce((sum, f) => sum + f.weight, 0);
    let r = Math.random() * total;
    for (const fish of config.fish) {
        r -= fish.weight;
        if (r < 0) return fish;
    }
    return config.fish[config.fish.length - 1];
}

// lowercase, trim, collapse internal whitespace, strip trailing !/.
function normalize(str) {
    return String(str).toLowerCase().trim().replace(/\s+/g, ' ').replace(/[!.]+$/, '').trim();
}

function findFish(config, name) {
    const target = normalize(name);
    return config.fish.find(f =>
        f.name.toLowerCase() === target ||
        (f.aliases || []).some(a => a.toLowerCase() === target)
    ) || null;
}

// The window actually used for a spawn - test mode overrides the per-fish value,
// otherwise the anti-overlap clamp swallows the compressed interval entirely.
function windowSecondsFor(config, fish) {
    const base = config.test_mode ? (config.test_window_seconds || 5) : fish.window;
    return Math.max(config.min_window_seconds || 3, base);
}

// Every accepted catch string for a fish, per the configured phrase template.
function catchPhrases(config, fishName, aliases) {
    const template = config.catch_phrase || 'i reel in the {fish}';
    return [fishName, ...(aliases || [])].map(n => normalize(template.replace('{fish}', n)));
}

function addScore(state, userId, points) {
    if (!state.scores) state.scores = {};
    if (!state.scores[userId]) state.scores[userId] = { points: 0, catches: 0 };
    state.scores[userId].points += points;
    state.scores[userId].catches += 1;
}

// --- Images ------------------------------------------------------------------

function downloadBuffer(url, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 5) return reject(new Error('Too many redirects'));
        https.get(url, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return downloadBuffer(res.headers.location, redirects + 1).then(resolve, reject);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

// The icons are 128px, which renders tiny in Discord. Nearest-neighbour upscale
// keeps the pixel art crisp. Best-effort: any failure falls back to the original.
async function upscale(buffer, px) {
    if (!px || px <= 0) return buffer;
    try {
        const Jimp = require('jimp');
        const img = await Jimp.read(buffer);
        if (img.bitmap.width >= px) return buffer;
        img.resize(px, px, Jimp.RESIZE_NEAREST_NEIGHBOR);
        return await img.getBufferAsync(Jimp.MIME_PNG);
    } catch {
        return buffer;
    }
}

// Fetch every fish image up front. Never fetch during a spawn - a third-party host
// on the critical path of an 8-second window is how you lose a legendary.
async function warmImageCache(config) {
    const results = [];
    for (const fish of config.fish) {
        try {
            let buf = await downloadBuffer(fish.image);
            buf = await upscale(buf, config.image_upscale_px);
            imageCache.set(fish.name, buf);
            results.push({ name: fish.name, ok: true, bytes: buf.length });
        } catch (err) {
            results.push({ name: fish.name, ok: false, error: err.message });
        }
    }
    return results;
}

// --- Scheduling --------------------------------------------------------------

function scheduleNextSpawn(client, guildId, windowMs, explicitDelayMs) {
    clearTimeout(spawnTimers.get(guildId));
    const config = getConfig();

    let delay;
    if (typeof explicitDelayMs === 'number') {
        delay = Math.max(1000, explicitDelayMs);
    } else {
        const intervalMs = config.test_mode
            ? randRange(config.test_interval_seconds.min, config.test_interval_seconds.max) * 1000
            : randRange(config.min_interval_minutes, config.max_interval_minutes) * 60000;
        // Never overlap the previous window: next spawn starts after it closes.
        delay = Math.max(intervalMs, (windowMs || 0) + 1000);
    }

    const data = load();
    if (data[guildId]) {
        data[guildId].nextSpawnAt = Date.now() + delay;
        save(data);
    }

    spawnTimers.set(guildId, setTimeout(() => {
        doSpawn(client, guildId).catch(err => console.error('Fishing Frenzy spawn error:', err));
    }, delay));
}

function scheduleEndTimer(client, guildId, endTime) {
    clearTimeout(endTimers.get(guildId));
    endTimers.set(guildId, setTimeout(() => {
        endFrenzy(client, guildId).catch(err => console.error('Fishing Frenzy end error:', err));
    }, Math.max(0, endTime - Date.now())));
}

function scheduleCloseTimer(client, guildId, closeAt) {
    clearTimeout(closeTimers.get(guildId));
    closeTimers.set(guildId, setTimeout(() => {
        closeSpawn(client, guildId).catch(err => console.error('Fishing Frenzy close error:', err));
    }, Math.max(0, closeAt - Date.now())));
}

// --- Spawning ----------------------------------------------------------------

async function doSpawn(client, guildId, forcedFishName) {
    const state = getState(guildId);
    if (!state || !state.active) return;

    if (Date.now() >= state.endTime) {
        await endFrenzy(client, guildId);
        return;
    }

    const config = getConfig();
    const fish = forcedFishName ? findFish(config, forcedFishName) : pickWeightedFish(config);
    if (!fish) return;

    const windowMs = windowSecondsFor(config, fish) * 1000;

    // The image is the entire puzzle. Attach the bytes under a neutral filename so
    // neither the species name nor the dodo.ac URL is ever reachable by a player.
    let buffer = imageCache.get(fish.name);
    if (!buffer) {
        try {
            buffer = await upscale(await downloadBuffer(fish.image), config.image_upscale_px);
            imageCache.set(fish.name, buffer);
        } catch (err) {
            console.error(`Fishing Frenzy: no image for ${fish.name}:`, err.message);
            scheduleNextSpawn(client, guildId, 0);
            return;
        }
    }

    let messageId = null;
    try {
        const channel = await client.channels.fetch(state.channelId);
        if (channel && channel.isTextBased()) {
            const msg = await channel.send({
                content: config.spawn_message,
                files: [new AttachmentBuilder(buffer, { name: config.attachment_filename || 'fish.png' })],
            });
            messageId = msg.id;
        }
    } catch (err) {
        console.error('Fishing Frenzy: failed to post spawn:', err.message);
        scheduleNextSpawn(client, guildId, 0);
        return;
    }

    // Window clock starts once the message is actually posted.
    const data = load();
    const st = data[guildId];
    if (!st || !st.active) return;
    st.currentSpawn = {
        fish: { name: fish.name, points: fish.points, rarity: fish.rarity },
        closeAt: Date.now() + windowMs,
        messageId,
        claimedBy: null,
        announced: false,
    };
    st.spawnCount = (st.spawnCount || 0) + 1;
    save(data);

    scheduleCloseTimer(client, guildId, st.currentSpawn.closeAt);
    scheduleNextSpawn(client, guildId, windowMs);
}

// Window shut. Only announce a fish that was actually caught; one nobody landed
// stays a mystery, so a missed fish teaches you nothing for free.
async function closeSpawn(client, guildId) {
    const data = load();
    const state = data[guildId];
    if (!state || !state.active || !state.currentSpawn) return;
    const spawn = state.currentSpawn;
    if (spawn.announced) return;

    spawn.announced = true;
    save(data);

    const config = getConfig();
    if (config.announce_on_close && spawn.claimedBy) {
        const unit = spawn.fish.points === 1 ? 'point' : 'points';
        const text = `🎣 <@${spawn.claimedBy}> reeled in the **${spawn.fish.name}** for **${spawn.fish.points}** ${unit}!`;
        try {
            const channel = await client.channels.fetch(state.channelId);
            if (channel && channel.isTextBased()) {
                await channel.send({ content: text, allowedMentions: { parse: [] } });
            }
        } catch (err) {
            console.error('Fishing Frenzy: close announce failed:', err.message);
        }
    }

    await updateLeaderboard(client, guildId).catch(() => {});
}

// --- Catch handling (called from messageCreate) ------------------------------

async function handleMessage(message) {
    if (!message.guild || message.author.bot) return;

    const data = load();
    const state = data[message.guild.id];
    if (!state || !state.active) return;
    if (message.channel.id !== state.channelId) return;

    const spawn = state.currentSpawn;
    if (!spawn) return;

    const config = getConfig();

    // Optional gate so a host or spectator in the channel can't take a fish.
    if (config.eligible_role_id && !message.member?.roles?.cache?.has(config.eligible_role_id)) {
        return;
    }

    const fishDef = findFish(config, spawn.fish.name);
    const accepted = catchPhrases(config, spawn.fish.name, fishDef ? fishDef.aliases : []);
    if (!accepted.includes(normalize(message.content))) return;

    // Right phrase, window shut.
    if (Date.now() > spawn.closeAt) {
        if (config.react_on_late) message.react('⌛').catch(() => {});
        return;
    }

    // first_only: claim it. Everything from here to save() must stay synchronous -
    // an await before the claim lets two simultaneous catches both score.
    const mode = state.scoring_mode || 'first_only';
    if (mode === 'first_only') {
        if (spawn.claimedBy) return;
        spawn.claimedBy = message.author.id;
    } else {
        if (!spawn.caught) spawn.caught = [];
        if (spawn.caught.includes(message.author.id)) return;
        spawn.caught.push(message.author.id);
    }

    addScore(state, message.author.id, spawn.fish.points);
    if (!state.catchLog) state.catchLog = [];
    state.catchLog.push({
        userId: message.author.id,
        fish: spawn.fish.name,
        points: spawn.fish.points,
        rarity: spawn.fish.rarity,
        ts: Date.now(),
    });
    save(data);

    message.react('✅').catch(() => {});
    updateLeaderboard(message.client, message.guild.id).catch(() => {});
}

// --- Standings / leaderboard -------------------------------------------------

function computeStandings(state) {
    const players = Object.entries(state.scores || {})
        .map(([userId, s]) => ({ userId, points: s.points, catches: s.catches }))
        .sort((a, b) => b.points - a.points || b.catches - a.catches);

    const rarest = {};
    for (const c of state.catchLog || []) {
        if (!rarest[c.userId] || c.points > rarest[c.userId].points) {
            rarest[c.userId] = { name: c.fish, points: c.points };
        }
    }
    return { players, rarest };
}

function leaderboardText(state, { final = false } = {}) {
    const { players } = computeStandings(state);
    const medal = i => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**${i + 1}.**`);

    const lines = [final ? '# 🎣 Fishing Frenzy - Final Standings' : '# 🎣 Fishing Frenzy - Live Leaderboard', ''];
    if (players.length === 0) {
        lines.push('*No fish caught yet.*');
    } else {
        lines.push(players.map((p, i) =>
            `${medal(i)} <@${p.userId}> - **${p.points}** ${p.points === 1 ? 'pt' : 'pts'} (${p.catches} caught)`
        ).join('\n'));
    }

    lines.push('');
    if (final) {
        lines.push(`*Final · ${state.spawnCount || 0} fish appeared.*`);
    } else {
        lines.push(`*${state.spawnCount || 0} fish so far · ends <t:${Math.floor(state.endTime / 1000)}:R>*`);
    }
    return lines.join('\n');
}

// Post the leaderboard message fresh. The HOST pins it, so this returns the message
// for its jump link - and callers must treat a replacement as a re-pin event.
async function postLeaderboard(client, guildId, { final = false } = {}) {
    const data = load();
    const state = data[guildId];
    if (!state) return null;

    const channelId = state.leaderboardChannelId || getConfig().leaderboard_channel;
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return null;

    const msg = await channel.send({
        content: leaderboardText(state, { final }),
        allowedMentions: { parse: [] },
    });

    const fresh = load();
    if (fresh[guildId]) {
        fresh[guildId].leaderboardMessageId = msg.id;
        fresh[guildId].leaderboardChannelId = channelId;
        save(fresh);
    }
    return msg;
}

async function doLeaderboardEdit(client, guildId, final) {
    const state = getState(guildId);
    if (!state || !state.leaderboardMessageId) return;

    try {
        const channel = await client.channels.fetch(state.leaderboardChannelId);
        if (!channel || !channel.isTextBased()) return;
        const msg = await channel.messages.fetch(state.leaderboardMessageId);
        await msg.edit({ content: leaderboardText(state, { final }), allowedMentions: { parse: [] } });
    } catch (err) {
        // The message is gone. Replace it, but say so loudly - the host pinned the
        // old one, and a silent swap leaves a pinned message frozen at a stale score.
        console.error('Fishing Frenzy: leaderboard edit failed, reposting:', err.message);
        const msg = await postLeaderboard(client, guildId, { final }).catch(() => null);
        if (msg) {
            const warn = `⚠️ The leaderboard message was deleted, so I posted a new one - **it needs re-pinning**: ${msg.url}`;
            try {
                const results = await client.channels.fetch(
                    state.resultsChannelId || getConfig().results_channel
                );
                if (results && results.isTextBased()) await results.send(warn);
            } catch { /* the console error above is the fallback */ }
        }
    }
}

// Throttled so a burst (test mode) can't hit Discord's edit rate limit. The
// trailing call guarantees the final state always lands.
async function updateLeaderboard(client, guildId, { final = false } = {}) {
    const config = getConfig();
    const minGap = (config.leaderboard_min_edit_seconds || 5) * 1000;
    const last = lastLeaderboardEdit.get(guildId) || 0;
    const since = Date.now() - last;

    if (final || since >= minGap) {
        clearTimeout(pendingLeaderboard.get(guildId));
        pendingLeaderboard.delete(guildId);
        lastLeaderboardEdit.set(guildId, Date.now());
        return doLeaderboardEdit(client, guildId, final);
    }

    if (pendingLeaderboard.has(guildId)) return;
    pendingLeaderboard.set(guildId, setTimeout(() => {
        pendingLeaderboard.delete(guildId);
        lastLeaderboardEdit.set(guildId, Date.now());
        doLeaderboardEdit(client, guildId, false).catch(() => {});
    }, minGap - since));
}

function tallyText(state) {
    const { players, rarest } = computeStandings(state);
    const caught = (state.catchLog || []).length;
    const gotAway = Math.max(0, (state.spawnCount || 0) - caught);

    const lines = ['# 🎣 CJ\'s Fishing Frenzy - Final Results', ''];

    if (players.length === 0) {
        lines.push('**Nobody caught anything.**', '');
    } else {
        const top = players[0].points;
        const winners = players.filter(p => p.points === top);
        if (winners.length === 1) {
            lines.push(`🏆 **<@${winners[0].userId}> wins Individual Immunity** with **${top}** points.`, '');
        } else {
            lines.push(
                `🤝 **Tie at ${top} points** - ${winners.map(w => `<@${w.userId}>`).join(', ')}.`,
                '*Hosts will break the tie.*',
                ''
            );
        }
    }

    lines.push('__Final standings__');
    lines.push(players.length
        ? players.map((p, i) => {
            const best = rarest[p.userId];
            return `**${i + 1}.** <@${p.userId}> - **${p.points}** pts (${p.catches} caught)`
                + (best ? ` · best: ${best.name}` : '');
        }).join('\n')
        : '*No catches.*');

    lines.push('', '__Summary__');
    lines.push(`Fish that appeared: **${state.spawnCount || 0}**`);
    lines.push(`Caught: **${caught}** · Got away: **${gotAway}**`);

    return lines.join('\n');
}

async function sendChunked(channel, text) {
    const chunks = [];
    let buf = '';
    for (const line of text.split('\n')) {
        if ((buf + line + '\n').length > 1900) { chunks.push(buf); buf = ''; }
        buf += line + '\n';
    }
    if (buf.trim()) chunks.push(buf);
    for (const chunk of chunks) {
        await channel.send({ content: chunk, allowedMentions: { parse: [] } }).catch(() => {});
    }
}

// --- Lifecycle ---------------------------------------------------------------

async function startFrenzy(client, guildId, { channelId, leaderboardChannelId, resultsChannelId, durationHours }) {
    const config = getConfig();
    const now = Date.now();

    const state = {
        active: true,
        channelId,
        leaderboardChannelId,
        // Resolved once at start and persisted, so a restart (or a config edit
        // mid-game) can't redirect the tally away from where the game is running.
        resultsChannelId: resultsChannelId || config.results_channel || channelId,
        startTime: now,
        endTime: now + durationHours * 60 * 60 * 1000,
        scoring_mode: config.scoring_mode || 'first_only',
        spawnCount: 0,
        scores: {},
        catchLog: [],
        currentSpawn: null,
        nextSpawnAt: null,
        leaderboardMessageId: null,
    };

    const data = load();
    data[guildId] = state;
    save(data);

    try {
        const channel = await client.channels.fetch(channelId);
        if (channel && channel.isTextBased()) {
            await channel.send(
                `🎣 **CJ's Fishing Frenzy has begun!**\n` +
                `Fish will start biting here at random over the next **${durationHours}h**. ` +
                `Each one comes as an image - name it before the window closes.\n` +
                `Only the **first** person to reel in each fish scores.`
            );
        }
    } catch (err) {
        console.error('Fishing Frenzy: start announce failed:', err.message);
    }

    const board = await postLeaderboard(client, guildId).catch(err => {
        console.error('Fishing Frenzy: leaderboard post failed:', err.message);
        return null;
    });

    scheduleEndTimer(client, guildId, state.endTime);
    scheduleNextSpawn(client, guildId, 0);
    return { state, leaderboardUrl: board ? board.url : null };
}

async function endFrenzy(client, guildId) {
    for (const map of [spawnTimers, endTimers, closeTimers]) {
        clearTimeout(map.get(guildId));
        map.delete(guildId);
    }
    clearTimeout(pendingLeaderboard.get(guildId));
    pendingLeaderboard.delete(guildId);

    const data = load();
    const state = data[guildId];
    if (!state || !state.active) return null;

    state.active = false;
    state.currentSpawn = null;
    save(data);

    await updateLeaderboard(client, guildId, { final: true }).catch(() => {});

    const target = state.resultsChannelId || getConfig().results_channel || state.channelId;
    try {
        const channel = await client.channels.fetch(target);
        if (channel && channel.isTextBased()) await sendChunked(channel, tallyText(state));
    } catch (err) {
        console.error('Fishing Frenzy: tally post failed:', err.message);
    }
    return state;
}

// Force-spawn a specific fish now (QA).
async function forceSpawn(client, guildId, fishName) {
    const state = getState(guildId);
    if (!state || !state.active) return { error: 'No frenzy is active.' };
    if (!findFish(getConfig(), fishName)) return { error: `Unknown fish: "${fishName}".` };
    await doSpawn(client, guildId, fishName);
    return { ok: true };
}

// On startup: resume any active, non-expired frenzy.
function resumeAll(client) {
    const data = load();
    for (const guildId of Object.keys(data)) {
        const state = data[guildId];
        if (!state || !state.active) continue;

        if (Date.now() >= state.endTime) {
            endFrenzy(client, guildId).catch(() => {});
            continue;
        }

        // Re-warm images in the background; spawns fall back to a live fetch.
        warmImageCache(getConfig()).catch(() => {});

        scheduleEndTimer(client, guildId, state.endTime);

        // An in-flight window that closed during downtime is simply expired.
        if (state.currentSpawn && !state.currentSpawn.announced) {
            scheduleCloseTimer(client, guildId, state.currentSpawn.closeAt);
        }

        const delay = state.nextSpawnAt ? state.nextSpawnAt - Date.now() : 0;
        scheduleNextSpawn(client, guildId, 0, Math.max(1000, delay));
        console.log(`Resumed Fishing Frenzy in guild ${guildId} (ends ${new Date(state.endTime).toISOString()}).`);
    }
}

module.exports = {
    getConfig,
    setTestMode,
    getState,
    startFrenzy,
    endFrenzy,
    forceSpawn,
    handleMessage,
    resumeAll,
    warmImageCache,
    postLeaderboard,
    updateLeaderboard,
    leaderboardText,
    tallyText,
    computeStandings,
    normalize,
    findFish,
    pickWeightedFish,
    windowSecondsFor,
    catchPhrases,
};
