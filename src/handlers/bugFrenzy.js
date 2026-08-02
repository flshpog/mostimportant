const fs = require('fs');
const path = require('path');

// Flick's Bug Frenzy — a timed two-tribe bug-catching game. The bot drops the same
// bug into both tribe channels at the same moment; players catch it by typing the
// catch phrase within its window. Scoring keys off which channel the catch lands in.
//
// Config (tunable, committed): config/bugfrenzy.json
// State (runtime, gitignored):  data/bugfrenzy.json, keyed by guildId.

const CONFIG_PATH = path.join(__dirname, '../../config/bugfrenzy.json');
const STATE_PATH = path.join(__dirname, '../../data/bugfrenzy.json');
// Runtime overrides toggled by command (gitignored) so hosts don't edit config.
const OVERRIDE_PATH = path.join(__dirname, '../../data/bugfrenzyRuntime.json');

// In-memory timers (not persisted — rebuilt on resume).
const spawnTimers = new Map();
const endTimers = new Map();

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

function pickWeightedBug(config) {
    const total = config.bugs.reduce((sum, b) => sum + b.weight, 0);
    let r = Math.random() * total;
    for (const bug of config.bugs) {
        r -= bug.weight;
        if (r < 0) return bug;
    }
    return config.bugs[config.bugs.length - 1];
}

// lowercase, trim, collapse internal whitespace, strip a trailing !/.
function normalize(str) {
    return String(str).toLowerCase().trim().replace(/\s+/g, ' ').replace(/[!.]+$/, '').trim();
}

function findBug(config, name) {
    const target = normalize(name);
    return config.bugs.find(b => b.name.toLowerCase() === target) || null;
}

function addScore(state, userId, tribe, points) {
    if (!state.scores) state.scores = {};
    if (!state.scores[userId]) state.scores[userId] = { points: 0, catches: 0, tribe };
    state.scores[userId].points += points;
    state.scores[userId].catches += 1;
    state.scores[userId].tribe = tribe;
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
        doSpawn(client, guildId).catch(err => console.error('Bug Frenzy spawn error:', err));
    }, delay));
}

function scheduleEndTimer(client, guildId, endTime) {
    clearTimeout(endTimers.get(guildId));
    const delay = Math.max(0, endTime - Date.now());
    endTimers.set(guildId, setTimeout(() => {
        endFrenzy(client, guildId).catch(err => console.error('Bug Frenzy end error:', err));
    }, delay));
}

// --- Spawning ----------------------------------------------------------------

async function doSpawn(client, guildId, forcedBugName) {
    const state = getState(guildId);
    if (!state || !state.active) return;

    if (Date.now() >= state.endTime) {
        await endFrenzy(client, guildId);
        return;
    }

    const config = getConfig();
    const bug = forcedBugName ? findBug(config, forcedBugName) : pickWeightedBug(config);
    if (!bug) return;

    const windowMs = Math.max(config.min_window_seconds || 3, bug.window) * 1000;
    const flavor = bug.flavor || config.default_flavor || 'appears';
    const content = `🪲 A **${bug.name}** ${flavor}! Type \`I catch the ${bug.name}!\` to catch it!`;

    // Post to both channels as close to simultaneously as possible (fairness).
    const messageIds = {};
    await Promise.all(['A', 'B'].map(async tribe => {
        try {
            const channel = await client.channels.fetch(state.channels[tribe].id);
            if (channel && channel.isTextBased()) {
                const msg = await channel.send(content);
                messageIds[tribe] = msg.id;
            }
        } catch (err) {
            console.error(`Bug Frenzy: failed to post to tribe ${tribe}:`, err.message);
        }
    }));

    // Window clock starts now (after the messages are posted).
    const data = load();
    const st = data[guildId];
    if (!st || !st.active) return;
    st.currentSpawn = {
        bug: { name: bug.name, points: bug.points, rarity: bug.rarity, window: bug.window },
        closeAt: Date.now() + windowMs,
        messageIds,
        caught: { A: [], B: [] },
    };
    st.spawnCount = (st.spawnCount || 0) + 1;
    save(data);

    scheduleNextSpawn(client, guildId, windowMs);
}

// --- Catch handling (called from messageCreate) ------------------------------

async function handleMessage(message) {
    if (!message.guild || message.author.bot) return;

    const data = load();
    const state = data[message.guild.id];
    if (!state || !state.active) return;

    let tribe = null;
    if (message.channel.id === state.channels.A.id) tribe = 'A';
    else if (message.channel.id === state.channels.B.id) tribe = 'B';
    else return;

    const spawn = state.currentSpawn;
    if (!spawn) return;

    const config = getConfig();
    if (normalize(message.content) !== `i catch the ${spawn.bug.name.toLowerCase()}`) return;

    // Correct phrase but the window has closed.
    if (Date.now() > spawn.closeAt) {
        if (config.react_on_late) message.react('⌛').catch(() => {});
        return;
    }

    const caught = spawn.caught[tribe];
    if (caught.includes(message.author.id)) return; // already caught this spawn
    if ((state.scoring_mode || 'all_in_window') === 'first_only' && caught.length > 0) return;

    // Valid catch — record synchronously, then react.
    caught.push(message.author.id);
    addScore(state, message.author.id, tribe, spawn.bug.points);
    if (!state.catchLog) state.catchLog = [];
    state.catchLog.push({
        userId: message.author.id, bug: spawn.bug.name, points: spawn.bug.points, tribe, ts: Date.now(),
    });
    save(data);

    message.react('✅').catch(() => {});
}

// --- Standings / tally -------------------------------------------------------

function computeStandings(state) {
    const tribeTotals = { A: 0, B: 0 };
    const players = { A: [], B: [] };
    for (const [userId, s] of Object.entries(state.scores || {})) {
        tribeTotals[s.tribe] = (tribeTotals[s.tribe] || 0) + s.points;
        players[s.tribe].push({ userId, points: s.points, catches: s.catches });
    }
    players.A.sort((a, b) => b.points - a.points);
    players.B.sort((a, b) => b.points - a.points);

    const caughtPerTribe = { A: 0, B: 0 };
    const rarest = { A: null, B: null };
    for (const c of state.catchLog || []) {
        caughtPerTribe[c.tribe] = (caughtPerTribe[c.tribe] || 0) + 1;
        if (!rarest[c.tribe] || c.points > rarest[c.tribe].points) rarest[c.tribe] = { name: c.bug, points: c.points };
    }
    return { tribeTotals, players, caughtPerTribe, rarest };
}

function labelOf(state, tribe) {
    return state.channels[tribe].label;
}

function standingsText(state, { includeTop = 5 } = {}) {
    const s = computeStandings(state);
    const lines = [];
    for (const tribe of ['A', 'B']) {
        lines.push(`**${labelOf(state, tribe)} — ${s.tribeTotals[tribe]} pts**`);
        const top = s.players[tribe].slice(0, includeTop);
        if (top.length) {
            lines.push(top.map((p, i) => `${i + 1}. <@${p.userId}> — ${p.points} pts (${p.catches} caught)`).join('\n'));
        } else {
            lines.push('*No catches yet.*');
        }
        lines.push('');
    }
    return lines.join('\n').trim();
}

function tallyText(state) {
    const s = computeStandings(state);
    const winner = s.tribeTotals.A === s.tribeTotals.B
        ? null
        : (s.tribeTotals.A > s.tribeTotals.B ? 'A' : 'B');

    const header = winner
        ? `🏆 **${labelOf(state, winner)} wins immunity!**`
        : `🤝 **It's a tie!**`;

    const lines = [
        `🪲 **Flick's Bug Frenzy — Final Results**`,
        header,
        `${labelOf(state, 'A')}: **${s.tribeTotals.A}** · ${labelOf(state, 'B')}: **${s.tribeTotals.B}**`,
        '',
    ];

    for (const tribe of ['A', 'B']) {
        lines.push(`__${labelOf(state, tribe)} leaderboard__`);
        const players = s.players[tribe];
        if (players.length) {
            lines.push(players.map((p, i) => `${i + 1}. <@${p.userId}> — ${p.points} pts (${p.catches} caught)`).join('\n'));
        } else {
            lines.push('*No catches.*');
        }
        lines.push('');
    }

    lines.push('__Summary__');
    lines.push(`Total spawns: **${state.spawnCount || 0}**`);
    lines.push(`Bugs caught — ${labelOf(state, 'A')}: **${s.caughtPerTribe.A}**, ${labelOf(state, 'B')}: **${s.caughtPerTribe.B}**`);
    lines.push(`Rarest caught — ${labelOf(state, 'A')}: **${s.rarest.A ? s.rarest.A.name : '—'}**, ${labelOf(state, 'B')}: **${s.rarest.B ? s.rarest.B.name : '—'}**`);

    return lines.join('\n');
}

// Sends a (possibly long) message to a channel, chunked to Discord's limit.
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

async function startFrenzy(client, guildId, channels, durationHours) {
    const config = getConfig();
    const now = Date.now();
    const state = {
        active: true,
        channels, // { A: {id, label}, B: {id, label} }
        startTime: now,
        endTime: now + durationHours * 60 * 60 * 1000,
        scoring_mode: config.scoring_mode || 'all_in_window',
        spawnCount: 0,
        scores: {},
        catchLog: [],
        currentSpawn: null,
        nextSpawnAt: null,
    };

    const data = load();
    data[guildId] = state;
    save(data);

    // Announce in both channels.
    for (const tribe of ['A', 'B']) {
        try {
            const channel = await client.channels.fetch(channels[tribe].id);
            if (channel && channel.isTextBased()) {
                await channel.send(
                    `🪲 **Flick's Bug Frenzy has begun for ${channels[tribe].label}!**\n` +
                    `Bugs will appear here at random over the next **${durationHours}h**. ` +
                    `Type the exact catch phrase before the window closes to score points for your tribe. Good luck!`
                );
            }
        } catch (err) {
            console.error(`Bug Frenzy: failed start announce for tribe ${tribe}:`, err.message);
        }
    }

    scheduleEndTimer(client, guildId, state.endTime);
    scheduleNextSpawn(client, guildId, 0);
    return state;
}

async function endFrenzy(client, guildId) {
    clearTimeout(spawnTimers.get(guildId));
    clearTimeout(endTimers.get(guildId));
    spawnTimers.delete(guildId);
    endTimers.delete(guildId);

    const data = load();
    const state = data[guildId];
    if (!state || !state.active) return null;

    state.active = false;
    state.currentSpawn = null;
    save(data);

    const text = tallyText(state);
    for (const tribe of ['A', 'B']) {
        try {
            const channel = await client.channels.fetch(state.channels[tribe].id);
            if (channel && channel.isTextBased()) await sendChunked(channel, text);
        } catch (err) {
            console.error(`Bug Frenzy: failed tally post for tribe ${tribe}:`, err.message);
        }
    }
    return state;
}

// Force-spawn a specific bug now (QA). Returns { error } if the bug name is unknown.
async function forceSpawn(client, guildId, bugName) {
    const state = getState(guildId);
    if (!state || !state.active) return { error: 'No frenzy is active.' };
    if (!findBug(getConfig(), bugName)) return { error: `Unknown bug: "${bugName}".` };
    await doSpawn(client, guildId, bugName);
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
        scheduleEndTimer(client, guildId, state.endTime);
        const delay = state.nextSpawnAt ? state.nextSpawnAt - Date.now() : 0;
        scheduleNextSpawn(client, guildId, 0, Math.max(1000, delay));
        console.log(`Resumed Bug Frenzy in guild ${guildId} (ends ${new Date(state.endTime).toISOString()}).`);
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
    computeStandings,
    standingsText,
    tallyText,
    normalize,
    findBug,
    pickWeightedBug,
};
