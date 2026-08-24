const { normalizeAnswer } = require('./loveDay');
const store = require('./gauntletState');

// The 101st Key (F4). A five stage !unlock chain, one player per channel.
//
// This is the Love Day machine with the pair and the clock removed: walk an ordered
// table of stages, check ONLY the current one, reply with a penalty notice on a wrong
// guess, and no-op silently in every invalid state. The answer normaliser is Love
// Day's, imported rather than copied.
//
// Nothing here records time or accumulates a penalty total. The wrong-answer reply in
// the channel IS the record; a human tallies them afterwards.

const LEG = 'keys';

function getRun(channelId) {
    return store.getRecord(LEG, channelId);
}

function saveRun(record) {
    store.saveRecord(LEG, record);
}

// The single gate every command shares: is this person allowed to act here, right now?
// Returns the run, or null for every silent no-op case.
function activeRunFor(message) {
    const run = getRun(message.channel.id);
    if (!run) return null;                              // no run in this channel
    if (run.player_id !== message.author.id) return null; // not this channel's player
    if (run.finished) return null;                      // already finished
    return run;
}

async function handleMessage(message) {
    if (!message.guild || message.author.bot) return;

    const parsed = store.parseCommand(message);
    if (!parsed) return;

    if (parsed.cmd === 'the101stkey') return handleStart(message);
    if (parsed.cmd === 'unlock') return handleUnlock(message, parsed.rest);
    if (parsed.cmd === 'hint') return handleHint(message);
}

// !the101stkey - the first person to run it in a channel becomes that channel's player.
async function handleStart(message) {
    const existing = getRun(message.channel.id);
    if (existing) return; // already running or finished here - silent

    const config = store.getConfig();
    const key = config.keys[0];
    if (!key) return;

    saveRun({
        channel_id: message.channel.id,
        player_id: message.author.id,
        key_index: 0,
        hints_used_this_key: 0,
        finished: false,
    });

    await message.channel.send(key.prompt).catch(() => {});
}

// !unlock <answer> - checked against the CURRENT key only. This is what makes the
// chain sequential: arriving and typing the last answer cannot skip ahead.
async function handleUnlock(message, rawAnswer) {
    const run = activeRunFor(message);
    if (!run) return;

    const config = store.getConfig();
    const key = config.keys[run.key_index];
    if (!key) return;

    if (normalizeAnswer(rawAnswer) !== normalizeAnswer(key.answer)) {
        await message.reply(config.wrong_answer_message).catch(() => {});
        return;
    }

    // Last key: post the finish message and nothing else, then go silent for good.
    if (run.key_index >= config.keys.length - 1) {
        run.finished = true;
        saveRun(run);
        await message.channel.send(config.finish_message).catch(() => {});
        return;
    }

    run.key_index += 1;
    run.hints_used_this_key = 0;
    saveRun(run);

    await message.channel.send(config.keys[run.key_index].prompt).catch(() => {});
}

// !hint - next unused hint for the current key, two per key.
async function handleHint(message) {
    const run = activeRunFor(message);
    if (!run) return;

    const config = store.getConfig();
    const key = config.keys[run.key_index];
    if (!key) return;

    const hints = key.hints || [];
    const used = run.hints_used_this_key || 0;
    if (used >= hints.length) {
        // Say so plainly rather than erroring or posting nothing.
        await message.reply(config.hints_exhausted_message).catch(() => {});
        return;
    }

    run.hints_used_this_key = used + 1;
    saveRun(run);

    await message.channel.send(hints[used]).catch(() => {});
    await message.reply(config.hint_penalty_message).catch(() => {});
}

module.exports = { handleMessage, getRun };
