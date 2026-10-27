const fs = require('fs');
const path = require('path');

// Birthday announcements. Every check compares today's date (in the configured
// timezone) against the birthday list: new birthdays get a post, a thread and the
// birthday role; roles handed out on an earlier day are taken back. Checking on an
// interval instead of one midnight timer means a restart or outage near midnight
// only delays things, and the state file stops anything posting twice.
//
// Config (tunable): config/birthdays.json
// State (gitignored): data/birthdays.json

const CONFIG_PATH = path.join(__dirname, '../../config/birthdays.json');
const STATE_PATH = path.join(__dirname, '../../data/birthdays.json');

// Discord's "Unknown Member" error: they left the server, so there is no role to fix.
const UNKNOWN_MEMBER = 10007;

function getConfig() {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

// { date: 'YYYY-MM-DD' last processed, posted: [userId], roles: [{ guild_id, user_id, date }] }
function load() {
    try {
        return { posted: [], roles: [], ...JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) };
    } catch {
        return { date: null, posted: [], roles: [] };
    }
}

function save(state) {
    if (!fs.existsSync(path.dirname(STATE_PATH))) {
        fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    }
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// Today's calendar date in the timezone, as numbers plus a 'YYYY-MM-DD' key.
function today(timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const get = type => parts.find(p => p.type === type).value;
    const [year, month, day] = [get('year'), get('month'), get('day')];
    return { year: Number(year), month: Number(month), day: Number(day), key: `${year}-${month}-${day}` };
}

function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isBirthdayToday(entry, date) {
    if (entry.month === date.month && entry.day === date.day) return true;
    // Feb 29 birthdays fall back to Feb 28 when there is no Feb 29.
    return entry.month === 2 && entry.day === 29 && !isLeapYear(date.year)
        && date.month === 2 && date.day === 28;
}

function fill(template, user, name) {
    return template.replaceAll('{user}', `<@${user}>`).replaceAll('{name}', name);
}

// Posts the birthday message in `channel` and opens a wishes thread on it.
// Returns the guild member, or null if they aren't in that server.
async function announce(channel, userId, cfg) {
    const member = await channel.guild.members.fetch(userId).catch(() => null);
    const name = member?.displayName
        || (await channel.client.users.fetch(userId).catch(() => null))?.username
        || 'friend';

    const message = await channel.send({
        content: fill(cfg.message, userId, name),
        allowedMentions: { users: [userId] },
    });
    // Thread names are capped at 100 characters.
    await message.startThread({
        name: fill(cfg.thread_name, userId, name).slice(0, 100),
        autoArchiveDuration: cfg.thread_archive_minutes,
    });
    return member;
}

async function removeOldRoles(client, state, date, cfg) {
    const keep = [];
    for (const grant of state.roles) {
        if (grant.date === date.key) {
            keep.push(grant);
            continue;
        }
        try {
            const guild = await client.guilds.fetch(grant.guild_id);
            const member = await guild.members.fetch(grant.user_id);
            await member.roles.remove(cfg.role_id, 'Birthday is over');
            console.log(`[birthdays] Removed the birthday role from ${member.user.tag}.`);
        } catch (err) {
            if (err.code === UNKNOWN_MEMBER) continue;
            // Kept, so the next check tries again.
            console.error(`[birthdays] Could not remove the birthday role from ${grant.user_id}:`, err.message);
            keep.push(grant);
        }
    }
    state.roles = keep;
}

async function check(client) {
    const cfg = getConfig();
    const date = today(cfg.timezone);
    const state = load();

    if (state.date !== date.key) {
        state.date = date.key;
        state.posted = [];
    }
    if (cfg.role_id && state.roles.some(grant => grant.date !== date.key)) {
        await removeOldRoles(client, state, date, cfg);
    }
    save(state);

    if (!cfg.enabled) return;
    const due = cfg.birthdays.filter(entry => isBirthdayToday(entry, date) && !state.posted.includes(entry.user_id));
    if (!due.length) return;

    const channel = await client.channels.fetch(cfg.channel_id);
    for (const entry of due) {
        // Marked first: a failure part-way should never lead to a second post.
        state.posted.push(entry.user_id);
        save(state);

        let member;
        try {
            member = await announce(channel, entry.user_id, cfg);
            console.log(`[birthdays] Posted the birthday message for ${entry.user_id}.`);
        } catch (err) {
            console.error(`[birthdays] Birthday post for ${entry.user_id} failed:`, err);
            continue;
        }

        if (!cfg.role_id || !member) continue;
        try {
            await member.roles.add(cfg.role_id, 'Happy birthday');
            state.roles.push({ guild_id: channel.guild.id, user_id: entry.user_id, date: date.key });
            save(state);
        } catch (err) {
            console.error(`[birthdays] Could not give the birthday role to ${entry.user_id}:`, err.message);
        }
    }
}

// Wired from ready.js.
function startBirthdays(client) {
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            await check(client);
        } catch (err) {
            console.error('[birthdays] Check failed:', err);
        } finally {
            running = false;
        }
    };
    tick();
    const seconds = Number(getConfig().check_interval_seconds) || 60;
    setInterval(tick, seconds * 1000);
}

module.exports = { startBirthdays, announce, getConfig };
