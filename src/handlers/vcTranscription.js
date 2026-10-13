const { Client, GatewayIntentBits, Events } = require('discord.js');
const { guildSettings } = require('../config/vcTranscription');

// Live voice-channel transcription.
//
// A bot account can only sit in one voice channel per server, so the listening
// is done by a pool of separate "recorder" bots (RECORDER_TOKENS in .env), one
// per simultaneous call. The main bot never joins a call itself: it watches
// voice state, dispatches a recorder, and posts the transcript thread.
//
// Recorders are picked at random from whichever are free. They are meant to
// share a name and avatar, and a random pick means the one sitting in your call
// says nothing about whether another call is happening.

// Loaded in start(), not at the top: a missing package must switch this feature
// off, not stop the whole bot from booting.
let voice = null;
let OpusScript = null;

let mainClient = null;
const recorders = [];          // { client, busy: Map<guildId, channelId> }
const sessions = new Map();    // voice channelId -> session
const graceTimers = new Map(); // voice channelId -> timeout ending an empty call
const warned = new Set();      // voice channelIds already told "not being transcribed"
const apiClients = new Map();  // api base URL -> OpenAI client

const BYTES_PER_SAMPLE = 2; // 16-bit PCM

function fill(template, values) {
    return String(template ?? '').replace(/\{(\w+)\}/g, (match, key) =>
        (key in values ? String(values[key]) : match));
}

function humans(channel) {
    return channel.members.filter(m => !m.user.bot);
}

function memberNames(channel) {
    return humans(channel).map(m => m.displayName).join(', ');
}

// Wraps raw mono 16-bit PCM in a WAV header.
function toWav(pcm, sampleRate) {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * BYTES_PER_SAMPLE, 28);
    header.writeUInt16LE(BYTES_PER_SAMPLE, 32);
    header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

async function transcribe(pcm, cfg) {
    const OpenAI = require('openai');
    let api = apiClients.get(cfg.api_base_url);
    if (!api) {
        api = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: cfg.api_base_url });
        apiClients.set(cfg.api_base_url, api);
    }
    const params = {
        model: cfg.model,
        file: await OpenAI.toFile(toWav(pcm, cfg.sample_rate), 'voice.wav'),
    };
    if (cfg.language) params.language = cfg.language;
    if (cfg.prompt) params.prompt = cfg.prompt;
    const result = await api.audio.transcriptions.create(params);
    return result.text?.trim() || '';
}

// Everything posted to a session's thread goes through this chain, so lines
// land in the order they were spoken even though transcriptions finish out of order.
function enqueue(session, task) {
    session.postChain = session.postChain.then(task).catch(err =>
        console.error('VC transcription post error:', err.message || err));
}

async function sendChunked(thread, text, cfg) {
    for (let i = 0; i < text.length; i += cfg.max_message_length) {
        await thread.send({
            content: text.slice(i, i + cfg.max_message_length),
            allowedMentions: { parse: [] },
        });
    }
}

async function displayName(session, userId) {
    const guild = mainClient.guilds.cache.get(session.guildId);
    const member = guild?.members.cache.get(userId)
        || await guild?.members.fetch(userId).catch(() => null);
    return member?.displayName || `Unknown (${userId})`;
}

function queueUtterance(session, userId, pcm, cfg) {
    const ms = (pcm.length / (cfg.sample_rate * BYTES_PER_SAMPLE)) * 1000;
    if (ms < cfg.min_utterance_ms) return;

    const pending = transcribe(pcm, cfg).catch(err => {
        console.error('VC transcription failed:', err.message || err);
        return null;
    });

    enqueue(session, async () => {
        const text = await pending;
        if (!session.thread) return;
        const name = await displayName(session, userId);
        if (text === null) {
            const seconds = Math.round(ms / 1000);
            return sendChunked(session.thread, fill(cfg.failure_format, { name, seconds }), cfg);
        }
        if (!text) return;
        const ignored = (cfg.ignore_phrases || []).map(p => p.toLowerCase());
        if (ms <= cfg.ignore_phrases_max_ms && ignored.includes(text.toLowerCase())) return;
        await sendChunked(session.thread, fill(cfg.message_format, { name, text }), cfg);
    });
}

// Collects one person's audio until they pause, then hands it off. Discord sends
// a separate stream per speaker, which is what makes "who said it" exact.
function listen(session, userId) {
    const cfg = guildSettings(session.guildId);
    const stream = session.connection.receiver.subscribe(userId, {
        end: { behavior: voice.EndBehaviorType.AfterSilence, duration: cfg.silence_ms },
    });
    const decoder = new OpusScript(cfg.sample_rate, 1, OpusScript.Application.VOIP);
    const maxBytes = cfg.max_utterance_seconds * cfg.sample_rate * BYTES_PER_SAMPLE;
    let chunks = [];
    let bytes = 0;
    let finished = false;

    const flush = () => {
        if (!bytes) return;
        const pcm = Buffer.concat(chunks, bytes);
        chunks = [];
        bytes = 0;
        queueUtterance(session, userId, pcm, cfg);
    };

    const finish = () => {
        if (finished) return;
        finished = true;
        session.active.delete(userId);
        flush();
        decoder.delete();
    };

    session.active.set(userId, { stream, finish });
    stream.on('data', packet => {
        if (finished) return;
        try {
            const pcm = Buffer.from(decoder.decode(packet));
            chunks.push(pcm);
            bytes += pcm.length;
        } catch {
            // A packet that won't decode (lost, or mid encryption handover) is skipped.
        }
        if (bytes >= maxBytes) flush();
    });
    stream.once('end', finish);
    stream.once('close', finish);
    stream.on('error', err => {
        console.error('VC transcription stream error:', err.message || err);
        finish();
    });
}

function pickRecorder(guildId) {
    const free = recorders.filter(r =>
        r.client.isReady() && r.client.guilds.cache.has(guildId) && !r.busy.has(guildId));
    if (!free.length) return null;
    return free[Math.floor(Math.random() * free.length)];
}

// The channel transcript threads go in, or null (with the reason logged) if it
// is missing or outside the category it is required to be in.
async function resolveTranscriptChannel(guild, cfg) {
    const channel = await guild.channels.fetch(cfg.transcript_channel).catch(() => null);
    if (!channel?.threads) {
        console.error(`VC transcription: transcript_channel ${cfg.transcript_channel} not found in ${guild.name}.`);
        return null;
    }
    if (cfg.required_category && channel.parentId !== cfg.required_category) {
        console.error(`VC transcription: #${channel.name} is outside the required category - refusing to record.`);
        return null;
    }
    return channel;
}

async function warnOnce(transcriptChannel, channel, template) {
    if (warned.has(channel.id)) return;
    warned.add(channel.id);
    await transcriptChannel.send({
        content: fill(template, { channel: channel.name }),
        allowedMentions: { parse: [] },
    }).catch(() => {});
}

function threadName(channel, cfg) {
    const now = new Date();
    const format = options => new Intl.DateTimeFormat(cfg.locale, { ...options, timeZone: cfg.timezone }).format(now);
    const name = fill(cfg.thread_name, {
        channel: channel.name,
        date: format(cfg.date_format),
        time: format(cfg.time_format),
    });
    return name.slice(0, 100); // Discord's thread name limit
}

function releaseRecorder(session) {
    if (session.recorder?.busy.get(session.guildId) === session.channelId) {
        session.recorder.busy.delete(session.guildId);
    }
}

async function startSession(channel, cfg) {
    const session = {
        channelId: channel.id,
        guildId: channel.guild.id,
        recorder: null,
        connection: null,
        thread: null,
        postChain: Promise.resolve(),
        active: new Map(), // userId -> { stream, finish } for audio being collected
        ended: false,
    };
    // Registered before the first await so a second join can't start a second session.
    sessions.set(channel.id, session);

    const abandon = () => {
        session.ended = true;
        if (sessions.get(channel.id) === session) sessions.delete(channel.id);
        releaseRecorder(session);
        try { session.connection?.destroy(); } catch { /* already destroyed */ }
    };

    const transcriptChannel = await resolveTranscriptChannel(channel.guild, cfg);
    if (!transcriptChannel) return abandon();
    if (session.ended) return;

    const recorder = pickRecorder(channel.guild.id);
    if (!recorder) {
        abandon();
        return warnOnce(transcriptChannel, channel, cfg.no_recorder_message);
    }
    session.recorder = recorder;
    recorder.busy.set(session.guildId, channel.id);

    try {
        const connection = voice.joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: recorder.client.guilds.cache.get(channel.guild.id).voiceAdapterCreator,
            // Several bots share this process; without a group each, their
            // connections to the same server would overwrite one another.
            group: recorder.client.user.id,
            selfDeaf: false,
            selfMute: true,
        });
        session.connection = connection;
        await voice.entersState(connection, voice.VoiceConnectionStatus.Ready, cfg.connect_timeout_seconds * 1000);
        if (session.ended) return;

        session.thread = await transcriptChannel.threads.create({
            name: threadName(channel, cfg),
            autoArchiveDuration: cfg.thread_auto_archive_minutes,
            reason: 'Voice channel transcript',
        });
        await sendChunked(session.thread, fill(cfg.start_message, {
            channel: channel.name,
            members: memberNames(channel),
        }), cfg);
        warned.delete(channel.id);

        connection.receiver.speaking.on('start', userId => {
            if (!session.ended && !session.active.has(userId)) listen(session, userId);
        });

        connection.on(voice.VoiceConnectionStatus.Disconnected, async () => {
            try {
                // A moved or briefly dropped connection starts reconnecting on its own.
                await Promise.race([
                    voice.entersState(connection, voice.VoiceConnectionStatus.Signalling, cfg.connect_timeout_seconds * 1000),
                    voice.entersState(connection, voice.VoiceConnectionStatus.Connecting, cfg.connect_timeout_seconds * 1000),
                ]);
            } catch {
                if (session.ended) return;
                await endSession(channel.id, cfg.disconnected_message);
                setTimeout(() => {
                    const fresh = mainClient.channels.cache.get(channel.id);
                    if (fresh) evaluate(fresh).catch(err => console.error('VC transcription error:', err));
                }, cfg.rejoin_delay_seconds * 1000);
            }
        });
    } catch (err) {
        console.error(`VC transcription: could not record ${channel.name}:`, err.message || err);
        abandon();
        await warnOnce(transcriptChannel, channel, cfg.connect_failed_message);
    }
}

async function endSession(channelId, message) {
    const session = sessions.get(channelId);
    if (!session || session.ended) return;
    session.ended = true;
    sessions.delete(channelId);
    clearTimeout(graceTimers.get(channelId));
    graceTimers.delete(channelId);
    warned.delete(channelId);

    // Flush whatever each person was mid-sentence on before the closing line is
    // queued; a stream's own close event would arrive too late to stay in order.
    for (const { stream, finish } of [...session.active.values()]) {
        finish();
        stream.destroy();
    }
    try { session.connection?.destroy(); } catch { /* already destroyed */ }
    releaseRecorder(session);

    if (!session.thread) return;
    const cfg = guildSettings(session.guildId);
    enqueue(session, async () => {
        await sendChunked(session.thread, message, cfg);
        if (cfg.archive_thread_on_end) await session.thread.setArchived(true);
    });
    await session.postChain;
}

// Starts, keeps or winds down recording for one voice channel based on who is in it.
async function evaluate(channel) {
    if (!voice || !channel?.isVoiceBased?.()) return;
    const cfg = guildSettings(channel.guild.id);
    const count = humans(channel).size;

    if (sessions.has(channel.id)) {
        clearTimeout(graceTimers.get(channel.id));
        graceTimers.delete(channel.id);
        if (count === 0) {
            graceTimers.set(channel.id, setTimeout(() => {
                endSession(channel.id, guildSettings(channel.guild.id).end_message)
                    .catch(err => console.error('VC transcription error:', err));
            }, cfg.empty_grace_seconds * 1000));
        }
        return;
    }

    if (count === 0) warned.delete(channel.id);
    if (!cfg.enabled || !cfg.transcript_channel) return;
    if ((cfg.ignore_channels || []).includes(channel.id)) return;
    if ((cfg.ignore_categories || []).includes(channel.parentId)) return;
    if (count < cfg.min_members) return;

    await startSession(channel, cfg);
}

function note(channel, template, member) {
    const session = channel && sessions.get(channel.id);
    if (!session?.thread || session.ended) return;
    const cfg = guildSettings(session.guildId);
    if (!cfg.log_joins_leaves) return;
    enqueue(session, () => sendChunked(session.thread, fill(template(cfg), { name: member.displayName }), cfg));
}

// Called from the main bot's voiceStateUpdate event.
async function handleVoiceStateUpdate(oldState, newState) {
    if (!voice) return;
    // Mutes, deafens and streams fire this event too; only channel changes matter.
    if (oldState.channelId === newState.channelId) return;
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;

    note(oldState.channel, cfg => cfg.leave_message, member);
    note(newState.channel, cfg => cfg.join_message, member);

    if (oldState.channel) await evaluate(oldState.channel);
    if (newState.channel) await evaluate(newState.channel);
}

function loginRecorder(token, index) {
    return new Promise(resolve => {
        const client = new Client({
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
        });
        client.on('error', err => console.error(`Recorder ${index + 1} error:`, err.message || err));
        client.once(Events.ClientReady, () => {
            recorders.push({ client, busy: new Map() });
            console.log(`Recorder ${index + 1} ready as ${client.user.tag}`);
            resolve();
        });
        client.login(token).catch(err => {
            console.error(`Recorder ${index + 1} failed to log in:`, err.message || err);
            resolve();
        });
    });
}

// Called once from the main bot's ready event. Logs the recorder bots in, then
// picks up any call already in progress (a restart mid-call).
async function start(client) {
    const tokens = (process.env.RECORDER_TOKENS || '').split(',').map(t => t.trim()).filter(Boolean);
    if (!tokens.length) return;
    if (!process.env.GROQ_API_KEY) {
        console.error('VC transcription is off: GROQ_API_KEY is not set.');
        return;
    }
    try {
        voice = require('@discordjs/voice');
        OpusScript = require('opusscript');
    } catch (err) {
        console.error('VC transcription is off: run `npm install` to add its packages.', err.message);
        voice = null;
        return;
    }

    mainClient = client;
    await Promise.all(tokens.map(loginRecorder));
    console.log(`VC transcription: ${recorders.length}/${tokens.length} recorder bots online.`);

    for (const guild of client.guilds.cache.values()) {
        for (const channel of guild.channels.cache.values()) {
            if (channel.isVoiceBased() && humans(channel).size > 0) {
                await evaluate(channel).catch(err => console.error('VC transcription error:', err));
            }
        }
    }
}

module.exports = { start, handleVoiceStateUpdate, toWav };
