const fs = require('fs');
const path = require('path');

// Totem Grab (Redemption #5) - over 24 hours the bot drops a warning in the totem
// channel, then a totem appears 30s-5min later. The first player to reply to it with
// the exact claim phrase gets a point and a ✅. Fake totems (misformatted appear
// messages) are mixed in; replying to one with a claim wipes that player's score.
//
// The bot posts nothing publicly beyond the warning, the appear message and the ✅.
// The live leaderboard is a single message in the host channel, edited in place.
//
// Config (tunable, committed): config/totemgrab.json
// State (runtime, gitignored):  data/totemgrab.json, keyed by guildId.

const CONFIG_PATH = path.join(__dirname, '../../config/totemgrab.json');
const STATE_PATH = path.join(__dirname, '../../data/totemgrab.json');

// In-memory timers (not persisted - rebuilt on resume).
const timers = new Map();

function getConfig() {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
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

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Anything that reads like a claim attempt, however badly formatted.
function looksLikeClaim(content) {
    return String(content).toLowerCase().replace(/[^a-z]/g, '').includes('claim');
}

// Random warning times across the window, at least min_gap apart, so events
// never overlap: pick points in a range shortened by all the gaps, sort, then
// push each one back out by its share of the gaps.
function buildWarnTimes(config, start, end, count) {
    const first = start + 5000;
    const lastWarn = end - config.appear_delay_seconds.max * 1000 - 1000;
    const gapMs = Math.min(config.min_gap_minutes * 60000, (lastWarn - first) / Math.max(1, count - 1));
    const span = (lastWarn - first) - gapMs * (count - 1);

    return Array.from({ length: count }, () => randRange(0, span))
        .sort((a, b) => a - b)
        .map((t, i) => Math.round(first + t + gapMs * i));
}

function buildEvents(config, start, end) {
    const types = shuffle([
        ...Array(config.real_totems).fill('real'),
        ...Array(config.fake_totems).fill('fake'),
    ]);
    const fakes = shuffle([...config.fake_appear_messages]);
    const warnTimes = buildWarnTimes(config, start, end, types.length);
    const { min, max } = config.appear_delay_seconds;

    let fakeIdx = 0;
    return types.map((type, i) => ({
        type,
        text: type === 'real' ? config.appear_message : fakes[fakeIdx++ % fakes.length],
        warnAt: warnTimes[i],
        appearAt: Math.round(warnTimes[i] + randRange(min, max) * 1000),
        warnMsgId: null,
        appearMsgId: null,
        claimedBy: null,
        claimedAt: null,
    }));
}

function addLog(state, text) {
    if (!state.log) state.log = [];
    state.log.push({ ts: Date.now(), text });
}

// --- Leaderboard (host channel only) -----------------------------------------

function rankedScores(state) {
    return Object.entries(state.scores || {})
        .map(([userId, s]) => ({ userId, ...s }))
        .sort((a, b) => b.points - a.points || (a.reachedAt || 0) - (b.reachedAt || 0));
}

function boardText(state) {
    const realTotal = state.events.filter(e => e.type === 'real').length;
    const fakeTotal = state.events.length - realTotal;
    const realShown = state.events.filter(e => e.type === 'real' && e.appearMsgId).length;
    const realClaimed = state.events.filter(e => e.type === 'real' && e.claimedBy).length;
    const fakeShown = state.events.filter(e => e.type === 'fake' && e.appearMsgId).length;

    const lines = [
        state.active ? '🗿 **Totem Grab leaderboard** (live)' : '🗿 **Totem Grab leaderboard** (FINAL, scores locked)',
        `Real totems: **${realShown}/${realTotal}** appeared, **${realClaimed}** claimed, **${realShown - realClaimed}** still open. Fakes: **${fakeShown}/${fakeTotal}** shown.`,
    ];

    if (state.active) {
        lines.push(`Ends <t:${Math.floor(state.endTime / 1000)}:f> (<t:${Math.floor(state.endTime / 1000)}:R>)`);
        const next = state.events.find(e => !e.warnMsgId);
        if (next) {
            lines.push(`Next warning: <t:${Math.floor(next.warnAt / 1000)}:T> (<t:${Math.floor(next.warnAt / 1000)}:R>), ${next.type}`);
        }
    }

    lines.push('');
    const ranked = rankedScores(state);
    if (ranked.length) {
        let rank = 0;
        let prev = null;
        ranked.forEach((p, i) => {
            if (p.points !== prev) { rank = i + 1; prev = p.points; }
            const wiped = p.wipes ? ` (wiped ${p.wipes}x)` : '';
            lines.push(`${rank}. <@${p.userId}> - **${p.points}**${wiped}`);
        });
        lines.push('-# Ties are listed by who reached that score first.');
    } else {
        lines.push('*No points yet.*');
    }

    const recent = (state.log || []).slice(-10);
    if (recent.length) {
        lines.push('', '__Recent__');
        for (const l of recent) lines.push(`<t:${Math.floor(l.ts / 1000)}:T> ${l.text}`);
    }

    let text = lines.join('\n');
    if (text.length > 1990) text = text.slice(0, 1990) + '…';
    return text;
}

async function updateBoard(client, state) {
    if (!state.boardChannelId) return;
    try {
        const channel = await client.channels.fetch(state.boardChannelId);
        if (!channel || !channel.isTextBased()) return;
        const payload = { content: boardText(state), allowedMentions: { parse: [] } };
        if (state.boardMessageId) {
            const msg = await channel.messages.fetch(state.boardMessageId).catch(() => null);
            if (msg) { await msg.edit(payload); return; }
        }
        const msg = await channel.send(payload);
        const data = load();
        if (data[state.guildId]) {
            data[state.guildId].boardMessageId = msg.id;
            save(data);
        }
    } catch (err) {
        console.error('Totem Grab: leaderboard update failed:', err.message);
    }
}

// --- Scheduling --------------------------------------------------------------

// The next thing to do: post a warning, or post an appear message.
function nextAction(state) {
    let best = null;
    state.events.forEach((e, i) => {
        if (!e.warnMsgId) {
            if (!best || e.warnAt < best.at) best = { at: e.warnAt, kind: 'warn', i };
        } else if (!e.appearMsgId) {
            if (!best || e.appearAt < best.at) best = { at: e.appearAt, kind: 'appear', i };
        }
    });
    return best;
}

function scheduleNext(client, guildId) {
    clearTimeout(timers.get(guildId));
    const state = getState(guildId);
    if (!state || !state.active) return;

    const action = nextAction(state);
    const at = action ? Math.min(action.at, state.endTime) : state.endTime;
    const delay = Math.max(0, at - Date.now());
    // setTimeout caps at ~24.8 days; nothing here comes close, but clamp anyway.
    timers.set(guildId, setTimeout(() => {
        tick(client, guildId).catch(err => console.error('Totem Grab tick error:', err));
    }, Math.min(delay, 2 ** 31 - 1)));
}

async function tick(client, guildId) {
    let state = getState(guildId);
    if (!state || !state.active) return;

    if (Date.now() >= state.endTime) {
        await endGame(client, guildId, 'time');
        return;
    }

    const action = nextAction(state);
    if (!action || action.at > Date.now()) {
        scheduleNext(client, guildId);
        return;
    }

    const config = getConfig();
    const channel = await client.channels.fetch(state.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
        console.error('Totem Grab: totem channel unavailable, retrying in 30s.');
        timers.set(guildId, setTimeout(() => tick(client, guildId).catch(() => {}), 30000));
        return;
    }

    const ev = state.events[action.i];
    let msg;
    try {
        msg = await channel.send({
            content: action.kind === 'warn' ? config.warning_message : ev.text,
            allowedMentions: { parse: [] },
        });
    } catch (err) {
        console.error(`Totem Grab: failed to post ${action.kind}, retrying in 30s:`, err.message);
        timers.set(guildId, setTimeout(() => tick(client, guildId).catch(() => {}), 30000));
        return;
    }

    const data = load();
    state = data[guildId];
    if (!state || !state.active) return;
    const e = state.events[action.i];
    const n = state.events.slice(0, action.i + 1).filter(x => x.type === e.type).length;
    const label = e.type === 'real' ? `Real totem #${n}` : `Fake #${n}`;

    if (action.kind === 'warn') {
        e.warnMsgId = msg.id;
        // If the bot was down and the appear time already passed, give a fresh delay.
        if (e.appearAt <= Date.now()) {
            const { min, max } = config.appear_delay_seconds;
            e.appearAt = Math.round(Date.now() + randRange(min, max) * 1000);
        }
        addLog(state, `${label}: warning posted, appears <t:${Math.floor(e.appearAt / 1000)}:T>`);
    } else {
        e.appearMsgId = msg.id;
        e.appearedAt = Date.now();
        addLog(state, e.type === 'real' ? `${label} appeared` : `${label} shown: \`${e.text}\``);
    }
    save(data);

    await updateBoard(client, state);
    scheduleNext(client, guildId);
}

// --- Claim handling (called from messageCreate) ------------------------------

async function handleMessage(message) {
    if (!message.guild || message.author.bot) return;

    const data = load();
    const state = data[message.guild.id];
    if (!state || !state.active || message.channel.id !== state.channelId) return;

    const refId = message.reference?.messageId;
    if (!refId) return;

    const ev = state.events.find(e => e.appearMsgId === refId);
    if (!ev) return;

    const userId = message.author.id;

    if (ev.type === 'fake') {
        if (!looksLikeClaim(message.content)) return;
        if (!state.scores[userId]) state.scores[userId] = { points: 0, reachedAt: Date.now(), wipes: 0 };
        const lost = state.scores[userId].points;
        state.scores[userId].points = 0;
        state.scores[userId].reachedAt = Date.now();
        state.scores[userId].wipes = (state.scores[userId].wipes || 0) + 1;
        addLog(state, `<@${userId}> claimed a fake, wiped (lost ${lost})`);
        save(data);
        await updateBoard(message.client, state);
        return;
    }

    // Real totem: stays open until someone claims it with the exact phrase.
    if (ev.claimedBy) return;
    if (message.content.trim() !== getConfig().claim_phrase) return;

    // Record synchronously (first valid reply wins), then react.
    ev.claimedBy = userId;
    ev.claimedAt = Date.now();
    if (!state.scores[userId]) state.scores[userId] = { points: 0, reachedAt: 0, wipes: 0 };
    state.scores[userId].points += 1;
    state.scores[userId].reachedAt = Date.now();
    const secs = ((ev.claimedAt - ev.appearedAt) / 1000).toFixed(1);
    addLog(state, `<@${userId}> claimed (+1, ${secs}s after it appeared)`);
    save(data);

    message.react(getConfig().claim_reaction).catch(() => {});
    await updateBoard(message.client, state);
}

// --- Lifecycle ---------------------------------------------------------------

async function startGame(client, guildId, channelId, boardChannelId) {
    const config = getConfig();
    const now = Date.now();
    const endTime = now + config.duration_hours * 60 * 60 * 1000;
    const state = {
        guildId,
        active: true,
        channelId,
        boardChannelId,
        boardMessageId: null,
        startTime: now,
        endTime,
        events: buildEvents(config, now, endTime),
        scores: {},
        log: [],
    };
    addLog(state, `Started in <#${channelId}>`);

    const data = load();
    data[guildId] = state;
    save(data);

    await updateBoard(client, state);
    scheduleNext(client, guildId);
    return getState(guildId);
}

async function endGame(client, guildId, reason) {
    clearTimeout(timers.get(guildId));
    timers.delete(guildId);

    const data = load();
    const state = data[guildId];
    if (!state || !state.active) return null;

    state.active = false;
    state.endedAt = Date.now();
    addLog(state, reason === 'time' ? 'Time is up, scores locked' : 'Stopped by a host, scores locked');
    save(data);

    await updateBoard(client, state);
    return state;
}

// On startup: resume any active game (or lock it if its time ran out while down).
function resumeAll(client) {
    const data = load();
    for (const guildId of Object.keys(data)) {
        const state = data[guildId];
        if (!state || !state.active) continue;
        if (Date.now() >= state.endTime) {
            endGame(client, guildId, 'time').catch(() => {});
            continue;
        }
        scheduleNext(client, guildId);
        console.log(`Resumed Totem Grab in guild ${guildId} (ends ${new Date(state.endTime).toISOString()}).`);
    }
}

module.exports = {
    getConfig,
    getState,
    startGame,
    endGame,
    handleMessage,
    resumeAll,
    boardText,
    buildEvents,
};
