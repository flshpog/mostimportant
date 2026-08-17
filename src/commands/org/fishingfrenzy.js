const { PermissionFlagsBits } = require('discord.js');
const frenzy = require('../../handlers/fishingFrenzy');

// Parse a channel mention (<#123>) or raw ID, and confirm it's a text channel.
function resolveChannel(guild, token) {
    if (!token) return null;
    const match = String(token).match(/^<#(\d+)>$/) || String(token).match(/^(\d+)$/);
    if (!match) return null;
    const channel = guild.channels.cache.get(match[1]);
    return channel && channel.isTextBased() ? channel : null;
}

const USAGE = [
    "**CJ's Fishing Frenzy — usage:**",
    '`!fishingfrenzy start [#channel] [durationHours]` — begin (defaults to the configured channel & 24h)',
    '`!fishingfrenzy stop` — end early + post the final tally',
    '`!fishingfrenzy standings` — current leaderboard',
    '`!fishingfrenzy status` — active? time left, spawns, next spawn ETA',
    '`!fishingfrenzy leaderboard` — re-post the leaderboard message (returns a link to pin)',
    '`!fishingfrenzy checkimages` — verify all fish images load (run before game day)',
    '`!fishingfrenzy spawn <fish name>` — force a specific fish now (QA)',
    '`!fishingfrenzy test [on|off]` — toggle fast spawns + short windows',
].join('\n');

module.exports = {
    name: 'fishingfrenzy',

    async execute(message, args) {
        if (!message.member || !message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply('You need the **Manage Server** permission to use this.');
        }

        const client = message.client;
        const guildId = message.guild.id;
        const sub = (args[0] || '').toLowerCase();
        const config = frenzy.getConfig();

        // ---- checkimages (works with no active frenzy, by design) ----
        if (sub === 'checkimages') {
            const notice = await message.reply(`🔍 Fetching all ${config.fish.length} fish images…`);
            const results = await frenzy.warmImageCache(config);
            const failed = results.filter(r => !r.ok);
            const ok = results.filter(r => r.ok);
            const avg = ok.length ? Math.round(ok.reduce((s, r) => s + r.bytes, 0) / ok.length / 1024) : 0;

            if (failed.length === 0) {
                return notice.edit(`✅ All **${ok.length}** fish images loaded (avg ${avg} KB). Cached and ready.`);
            }
            return notice.edit(
                `⚠️ **${failed.length} of ${results.length} failed:**\n` +
                failed.map(f => `• ${f.name} — ${f.error}`).join('\n') +
                '\n\nFix these before starting — the game will refuse to start otherwise.'
            );
        }

        // ---- start ----
        if (sub === 'start') {
            if (frenzy.getState(guildId)?.active) {
                return message.reply('A Fishing Frenzy is already running. Use `!fishingfrenzy stop` first.');
            }

            const explicit = resolveChannel(message.guild, args[1]);
            const channelId = explicit ? explicit.id : config.channel_id;
            const channel = message.guild.channels.cache.get(channelId);
            if (!channel) {
                return message.reply(`Fishing channel \`${channelId}\` not found in this server — pass one: \`!fishingfrenzy start #fishing-frenzy\`.`);
            }

            const leaderboardChannelId = config.leaderboard_channel || channelId;
            if (!message.guild.channels.cache.get(leaderboardChannelId)) {
                return message.reply(`Leaderboard channel \`${leaderboardChannelId}\` not found in this server. Fix \`leaderboard_channel\` in \`config/fishing.json\`.`);
            }

            const durationArg = explicit ? args[2] : args[1];
            const duration = durationArg ? parseFloat(durationArg) : config.default_duration_hours;
            if (!Number.isFinite(duration) || duration <= 0) {
                return message.reply('Duration must be a positive number of hours.');
            }

            // Warm the image cache BEFORE starting. A missing image mid-game is worse
            // than a refusal now, so a failure blocks the start outright.
            const notice = await message.reply(`🔍 Loading ${config.fish.length} fish images…`);
            const results = await frenzy.warmImageCache(config);
            const failed = results.filter(r => !r.ok);
            if (failed.length > 0) {
                return notice.edit(
                    `❌ **Not starting** — ${failed.length} image(s) failed to load:\n` +
                    failed.map(f => `• ${f.name} — ${f.error}`).join('\n')
                );
            }

            const { leaderboardUrl } = await frenzy.startFrenzy(client, guildId, {
                channelId,
                leaderboardChannelId,
                durationHours: duration,
            });

            const testWarning = frenzy.getConfig().test_mode
                ? '\n\n🧪 **TEST MODE IS ON** — fish will spawn every few seconds. Run `!fishingfrenzy test off` and restart if this is the real game.'
                : '';

            return notice.edit(
                `✅ Fishing Frenzy started in <#${channelId}> for **${duration}h**.\n` +
                (leaderboardUrl
                    ? `📌 **Pin the leaderboard now:** ${leaderboardUrl}`
                    : '⚠️ Could not post the leaderboard message — check my permissions in the leaderboard channel, then run `!fishingfrenzy leaderboard`.') +
                testWarning
            );
        }

        // ---- stop ----
        if (sub === 'stop') {
            if (!frenzy.getState(guildId)?.active) return message.reply('No Fishing Frenzy is currently active.');
            await frenzy.endFrenzy(client, guildId);
            return message.reply('🛑 Fishing Frenzy ended. Final tally posted.');
        }

        // ---- standings ----
        if (sub === 'standings') {
            const state = frenzy.getState(guildId);
            if (!state) return message.reply('No Fishing Frenzy has been run yet.');
            return message.reply({
                content: frenzy.leaderboardText(state, { final: !state.active }),
                allowedMentions: { parse: [] },
            });
        }

        // ---- status ----
        if (sub === 'status') {
            const state = frenzy.getState(guildId);
            if (!state || !state.active) return message.reply('No Fishing Frenzy is currently active.');
            const nextLine = state.nextSpawnAt
                ? `Next fish <t:${Math.floor(state.nextSpawnAt / 1000)}:R>`
                : 'Next fish: pending';
            const testLine = frenzy.getConfig().test_mode ? '\n🧪 **Test mode is ON**' : '';
            return message.reply(
                `🎣 **Active** in <#${state.channelId}>. Ends <t:${Math.floor(state.endTime / 1000)}:R>.\n` +
                `Fish so far: **${state.spawnCount || 0}**\n${nextLine}${testLine}`
            );
        }

        // ---- leaderboard (re-post for pinning) ----
        if (sub === 'leaderboard') {
            const state = frenzy.getState(guildId);
            if (!state) return message.reply('No Fishing Frenzy has been run yet.');
            const msg = await frenzy.postLeaderboard(client, guildId, { final: !state.active }).catch(err => {
                console.error('Fishing Frenzy: leaderboard repost failed:', err);
                return null;
            });
            if (!msg) return message.reply('❌ Could not post the leaderboard — check my permissions in that channel.');
            return message.reply(`📌 New leaderboard message posted — **pin this one**: ${msg.url}`);
        }

        // ---- test mode toggle ----
        if (sub === 'test') {
            const arg = (args[1] || '').toLowerCase();
            let on;
            if (['on', 'true', 'enable'].includes(arg)) on = true;
            else if (['off', 'false', 'disable'].includes(arg)) on = false;
            else on = !frenzy.getConfig().test_mode;

            frenzy.setTestMode(on);
            const cfg = frenzy.getConfig();
            return message.reply(on
                ? `🧪 Test mode **ON** — fish every **${cfg.test_interval_seconds.min}–${cfg.test_interval_seconds.max}s**, `
                  + `windows shortened to **${cfg.test_window_seconds}s** (applies to the next spawn). Turn off with \`!fishingfrenzy test off\`.`
                : `Test mode **OFF** — back to **${cfg.min_interval_minutes}–${cfg.max_interval_minutes} min** spawns and normal windows.`);
        }

        // ---- spawn (QA) ----
        if (sub === 'spawn') {
            const fishName = args.slice(1).join(' ').trim();
            if (!fishName) return message.reply('Give a fish name: `!fishingfrenzy spawn Coelacanth`.');
            const result = await frenzy.forceSpawn(client, guildId, fishName);
            if (result.error) return message.reply(`❌ ${result.error}`);
            return message.reply(`🎣 Force-spawned **${fishName}**.`);
        }

        return message.reply(USAGE);
    },
};
