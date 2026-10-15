// Starts the Season 3 board server (website API + live updates) inside the bot.
// The game itself lives in the TypeScript packages under packages/; tsx lets the bot
// load them directly, so there is no build step.
const fs = require('fs');
const path = require('path');
const board = require('./boardTs');
const { logToHost } = require('./economyLog');

const ROOT = path.join(__dirname, '..', '..');
const SEASON_CONFIG = path.join(ROOT, 'packages', 'board-data', 'season-config.json');
// A "yes" is remembered for a minute; a "no" only briefly, so granting the role
// takes effect right away.
const HOST_CACHE_MS = 60_000;
const NOT_HOST_CACHE_MS = 5_000;

let running = null;

// Re-reads season-config.json when it changes on disk. A broken edit keeps the last
// good config (and says so in the console) instead of breaking the board mid-game.
function seasonConfigLoader(SeasonConfigSchema) {
    let cached = null;
    let cachedMtime = 0;
    return () => {
        try {
            const mtime = fs.statSync(SEASON_CONFIG).mtimeMs;
            if (!cached || mtime !== cachedMtime) {
                cached = SeasonConfigSchema.parse(JSON.parse(fs.readFileSync(SEASON_CONFIG, 'utf8')));
                cachedMtime = mtime;
            }
        } catch (error) {
            if (!cached) throw error;
            console.error('[board] season-config.json is invalid, still using the previous version:', error.message);
            cachedMtime = 0;
        }
        return cached;
    };
}

// Testing only: send every board to one channel (config/board.local.json
// test_channel_id), so a test server doesn't need a copy of every tribe channel.
function withTestChannel(loadConfig, channelId) {
    if (!channelId) return loadConfig;
    console.warn(`[board] TEST MODE: every board posts in channel ${channelId} (test_channel_id).`);
    return () => {
        const c = loadConfig();
        return {
            ...c,
            boards: c.boards.map((b) => ({ ...b, channelId })),
            redemptionIsland: { ...c.redemptionIsland, channelId },
        };
    };
}

// Host = has the host role in the main server. Cached briefly so a page load doesn't
// hit Discord once per request.
function hostChecker(client, config) {
    const cache = new Map();
    return async (userId) => {
        const hit = cache.get(userId);
        if (hit && hit.until > Date.now()) return hit.value;
        let value = false;
        try {
            const guild = client.guilds.cache.get(config.guild_id);
            const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
            value = !!member && member.roles.cache.has(config.host_role_id);
        } catch (error) {
            console.error('[board] host check failed:', error.message);
        }
        cache.set(userId, { value, until: Date.now() + (value ? HOST_CACHE_MS : NOT_HOST_CACHE_MS) });
        return value;
    };
}

async function start(client) {
    if (running) return running;
    const { loadServerConfig, startBoardServer } = board.server();
    const { loadLayouts, SeasonConfigSchema } = board.boardData();

    const config = loadServerConfig(path.join(ROOT, 'config', 'board.json'));
    if (!config.enabled) {
        console.log('[board] disabled in config/board.json');
        return null;
    }
    const sessionSecret = process.env.BOARD_SESSION_SECRET;
    if (!sessionSecret) {
        console.warn('[board] BOARD_SESSION_SECRET is not set in .env, so the board server is off.');
        return null;
    }
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    if (!clientSecret) console.warn('[board] DISCORD_CLIENT_SECRET is not set: the API runs, but website login is off.');

    const dataDir = path.resolve(ROOT, config.data_dir);
    const loadConfig = withTestChannel(seasonConfigLoader(SeasonConfigSchema), config.test_channel_id);
    const isHost = hostChecker(client, config);
    running = await startBoardServer({
        config,
        dataDir,
        layouts: loadLayouts(),
        loadConfig,
        sessionSecret,
        oauth: clientSecret
            ? { clientId: client.user.id, clientSecret, redirectUri: `${config.public_url}/auth/callback` }
            : null,
        isHost,
    });
    client.boardServer = running;

    // Discord side: /roll, choice buttons, the board image in each tribe channel.
    const { BoardDiscord } = board.discord();
    client.boardDiscord = new BoardDiscord({
        client,
        service: running.service,
        loadConfig,
        dataDir,
        isHost: async (id) => config.host_user_ids.includes(id) || (await isHost(id)),
        hostRoleId: config.host_role_id,
        updatesThread: config.updates_thread,
        logToHost: (text) => logToHost(client, text),
    });
    await client.boardDiscord.start();
    return running;
}

module.exports = { start };
