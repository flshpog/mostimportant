const fs = require('fs');
const path = require('path');
const numberWords = require('./numberWords');

// Love Day (F10) — "For Better, For Worse". Staff pair a resident + a pal to a
// private channel; the pair runs !loveday to start a 4-round image puzzle (images
// DM'd to each half) and !unlock's through it. Winner is decided off-bot from the
// start/finish timestamps. Config is committed + tunable; state is per-channel.
//
// Config (tunable): config/loveday.json
// State (gitignored): data/loveday.json, keyed by channel_id.

const CONFIG_PATH = path.join(__dirname, '../../config/loveday.json');
const STATE_PATH = path.join(__dirname, '../../data/loveday.json');

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

// --- Records -----------------------------------------------------------------

function getByChannel(channelId) {
    return load()[channelId] || null;
}

function findByResident(residentId) {
    return Object.values(load()).find(rec => rec.resident_id === residentId) || null;
}

function saveRecord(record) {
    const data = load();
    data[record.channel_id] = record;
    save(data);
}

// Registers (or overwrites) a pair against a channel. Rejects if the resident is
// already registered in a DIFFERENT channel. Returns { ok, overwrote } or { error }.
function register(channelId, residentId, palId) {
    const data = load();
    for (const [chId, rec] of Object.entries(data)) {
        if (rec.resident_id === residentId && chId !== channelId) {
            return { error: `That resident is already registered in <#${chId}>.` };
        }
    }
    const overwrote = !!data[channelId];
    data[channelId] = {
        channel_id: channelId,
        resident_id: residentId,
        pal_id: palId,
        current_round: 1,
        started_at: null,
        finished_at: null,
    };
    save(data);
    return { ok: true, overwrote };
}

// --- Answer handling ---------------------------------------------------------

// lowercase, strip apostrophes/commas/periods, collapse whitespace.
function normalizeAnswer(str) {
    return String(str).toLowerCase().replace(/['’,.]/g, '').replace(/\s+/g, ' ').trim();
}

function checkAnswer(round, rawSubmitted) {
    const submitted = normalizeAnswer(rawSubmitted);
    const accepted = normalizeAnswer(round.answer);
    if (round.type === 'number') {
        return numberWords.canonical(submitted) === numberWords.canonical(accepted);
    }
    return submitted === accepted;
}

// --- DMs ---------------------------------------------------------------------

function toArray(value) {
    return Array.isArray(value) ? value : [value];
}

// DMs the resident + pal their image(s) for a round. Each side's image field may be
// a single URL or an array of URLs (e.g. Round 1's resident gets two pages), sent as
// separate messages. Posts a channel warning if a DM fails (the image IS the puzzle).
async function dmRoundImages(message, record, roundNumber) {
    const round = getConfig().rounds[roundNumber - 1];
    const client = message.client;
    const targets = [
        { id: record.resident_id, urls: toArray(round.resident_image), label: 'resident' },
        { id: record.pal_id, urls: toArray(round.pal_image), label: 'pal' },
    ];

    const failed = [];
    for (const target of targets) {
        try {
            const user = await client.users.fetch(target.id);
            for (const url of target.urls) {
                await user.send(url);
            }
        } catch {
            failed.push(target.label);
        }
    }
    if (failed.length) {
        await message.channel
            .send(`⚠️ Couldn't DM the ${failed.join(' and ')}. Make sure their DMs are open.`)
            .catch(() => {});
    }
}

// --- Prefix hook (wired into messageCreate) ----------------------------------

async function handleMessage(message) {
    if (!message.guild || message.author.bot) return;

    const prefix = (message.client.config && message.client.config.prefix) || '!';
    if (!message.content.startsWith(prefix)) return;

    const rest = message.content.slice(prefix.length).trim();
    if (!rest) return;
    const cmdToken = rest.split(/\s+/)[0].toLowerCase();

    if (cmdToken === 'loveday') {
        return handleStart(message);
    }
    if (cmdToken === 'unlock' || cmdToken.startsWith('unlock-')) {
        const rawAnswer = cmdToken.startsWith('unlock-')
            ? cmdToken.slice('unlock-'.length).replace(/-/g, ' ') // fused: !unlock-a-b-c
            : rest.slice('unlock'.length).trim();                  // spaced: !unlock a b c
        return handleUnlock(message, rawAnswer);
    }
}

// !loveday — start the pair's clock and Round 1.
async function handleStart(message) {
    const record = getByChannel(message.channel.id);
    if (!record) return; // no registered pair here — silent
    if (message.author.id !== record.resident_id && message.author.id !== record.pal_id) return;
    if (record.started_at) return; // already started — silent

    record.started_at = Date.now();
    record.current_round = 1;
    saveRecord(record); // persist "started" before the slow DM calls

    await dmRoundImages(message, record, 1);

    const round = getConfig().rounds[0];
    await message.channel
        .send(`💌 I've DMed you both your starting images! The answer to this puzzle is **${round.answer_type}**.`)
        .catch(() => {});
}

// !unlock <answer> — check the current round's answer.
async function handleUnlock(message, rawAnswer) {
    const record = getByChannel(message.channel.id);
    if (!record) return; // no pair — silent
    if (message.author.id !== record.resident_id && message.author.id !== record.pal_id) return;
    if (!record.started_at) return; // not started — silent
    if (record.finished_at) return; // finished — silent

    const config = getConfig();
    const round = config.rounds[record.current_round - 1];
    if (!round) return;

    if (!checkAnswer(round, rawAnswer)) {
        return; // incorrect guess — no reply
    }

    // Correct — final round?
    if (record.current_round >= config.rounds.length) {
        record.finished_at = Date.now();
        saveRecord(record);
        await message.channel.send(config.finish_message).catch(() => {});
        return;
    }

    // Advance to the next round.
    record.current_round += 1;
    saveRecord(record);
    await dmRoundImages(message, record, record.current_round);

    const nextRound = config.rounds[record.current_round - 1];
    const isFinalRound = record.current_round === config.rounds.length;
    let msg;
    if (isFinalRound) {
        msg = nextRound.answer_type
            ? `💞 Correct! Your final images are in your DMs. This is the last round, and the answer is **${nextRound.answer_type}**.`
            : '💞 Correct! Your final images are in your DMs. This is the last round!';
    } else {
        msg = `💞 Correct! New images sent to your DMs. This round's answer is **${nextRound.answer_type}**.`;
    }
    await message.channel.send(msg).catch(() => {});
}

module.exports = {
    getConfig,
    getByChannel,
    findByResident,
    register,
    normalizeAnswer,
    checkAnswer,
    handleMessage,
};
