const { PermissionFlagsBits } = require('discord.js');
const frenzy = require('../../handlers/bugFrenzy');

// Parse a channel mention (<#123>) or raw ID, and confirm it's a text channel.
function resolveChannel(guild, token) {
    if (!token) return null;
    const match = String(token).match(/^<#(\d+)>$/) || String(token).match(/^(\d+)$/);
    if (!match) return null;
    const channel = guild.channels.cache.get(match[1]);
    return channel && channel.isTextBased() ? channel : null;
}

const USAGE = [
    '**Flick\'s Bug Frenzy - usage:**',
    '`!bugfrenzy start [#tribeA LabelA #tribeB LabelB] [durationHours]` - begin (defaults to the configured channels & 24h)',
    '`!bugfrenzy stop` - end early + post the final tally',
    '`!bugfrenzy standings` - current totals + top catchers',
    '`!bugfrenzy status` - active? time left, spawn count, next spawn ETA',
    '`!bugfrenzy spawn <bug name>` - force a specific bug now (QA)',
    '`!bugfrenzy test [on|off]` - toggle fast test spawns (seconds instead of minutes)',
].join('\n');

module.exports = {
    name: 'bugfrenzy',

    async execute(message, args) {
        // Host/admin gate - match how host tools are gated (Manage Server).
        if (!message.member || !message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply('You need the **Manage Server** permission to use this.');
        }

        const client = message.client;
        const guildId = message.guild.id;
        const sub = (args[0] || '').toLowerCase();

        // ---- start ----
        if (sub === 'start') {
            if (frenzy.getState(guildId)?.active) {
                return message.reply('A Bug Frenzy is already running. Use `!bugfrenzy stop` first.');
            }

            const config = frenzy.getConfig();
            let channels;
            let duration;

            if (args.length >= 5) {
                // start #A LabelA #B LabelB [duration]
                const chA = resolveChannel(message.guild, args[1]);
                const chB = resolveChannel(message.guild, args[3]);
                if (!chA || !chB) {
                    return message.reply('Could not resolve both channels. Use channel mentions or IDs: `!bugfrenzy start #a TribeA #b TribeB`.');
                }
                channels = { A: { id: chA.id, label: args[2] }, B: { id: chB.id, label: args[4] } };
                duration = args[5] ? parseFloat(args[5]) : config.default_duration_hours;
            } else {
                // Defaults; an optional lone duration arg.
                const chA = message.guild.channels.cache.get(config.default_channels.A);
                const chB = message.guild.channels.cache.get(config.default_channels.B);
                if (!chA || !chB) {
                    return message.reply('Default tribe channels not found in this server - pass them explicitly: `!bugfrenzy start #a TribeA #b TribeB`.');
                }
                channels = {
                    A: { id: chA.id, label: config.default_labels.A },
                    B: { id: chB.id, label: config.default_labels.B },
                };
                duration = args[1] ? parseFloat(args[1]) : config.default_duration_hours;
            }

            if (!Number.isFinite(duration) || duration <= 0) {
                return message.reply('Duration must be a positive number of hours.');
            }

            await frenzy.startFrenzy(client, guildId, channels, duration);
            return message.reply(
                `✅ Bug Frenzy started - **${channels.A.label}** (<#${channels.A.id}>) vs **${channels.B.label}** (<#${channels.B.id}>) for **${duration}h**.`
            );
        }

        // ---- stop ----
        if (sub === 'stop') {
            if (!frenzy.getState(guildId)?.active) return message.reply('No Bug Frenzy is currently active.');
            await frenzy.endFrenzy(client, guildId);
            return message.reply('🛑 Bug Frenzy ended. Final tally posted to both tribe channels.');
        }

        // ---- standings ----
        if (sub === 'standings') {
            const state = frenzy.getState(guildId);
            if (!state) return message.reply('No Bug Frenzy has been run yet.');
            return message.reply({ content: frenzy.standingsText(state), allowedMentions: { parse: [] } });
        }

        // ---- status ----
        if (sub === 'status') {
            const state = frenzy.getState(guildId);
            if (!state || !state.active) return message.reply('No Bug Frenzy is currently active.');
            const endUnix = Math.floor(state.endTime / 1000);
            const nextLine = state.nextSpawnAt
                ? `Next spawn <t:${Math.floor(state.nextSpawnAt / 1000)}:R>`
                : 'Next spawn: pending';
            const testLine = frenzy.getConfig().test_mode ? '\n🧪 **Test mode is ON**' : '';
            return message.reply(
                `🪲 **Active.** Ends <t:${endUnix}:R>.\n` +
                `Spawns so far: **${state.spawnCount || 0}**\n${nextLine}${testLine}`
            );
        }

        // ---- test mode toggle ----
        if (sub === 'test') {
            const arg = (args[1] || '').toLowerCase();
            let on;
            if (['on', 'true', 'enable'].includes(arg)) on = true;
            else if (['off', 'false', 'disable'].includes(arg)) on = false;
            else on = !frenzy.getConfig().test_mode; // no arg = toggle

            frenzy.setTestMode(on);
            const cfg = frenzy.getConfig();
            return message.reply(on
                ? `🧪 Test mode **ON** - bugs now spawn every **${cfg.test_interval_seconds.min}-${cfg.test_interval_seconds.max}s** (applies to the next spawn). Turn off with \`!bugfrenzy test off\`.`
                : `Test mode **OFF** - back to normal **${cfg.min_interval_minutes}-${cfg.max_interval_minutes} min** spawns.`);
        }

        // ---- spawn (QA) ----
        if (sub === 'spawn') {
            const bugName = args.slice(1).join(' ').trim();
            if (!bugName) return message.reply('Give a bug name: `!bugfrenzy spawn Golden Stag`.');
            const result = await frenzy.forceSpawn(client, guildId, bugName);
            if (result.error) return message.reply(`❌ ${result.error}`);
            return message.reply(`🪲 Force-spawned **${bugName}** in both channels.`);
        }

        return message.reply(USAGE);
    },
};
