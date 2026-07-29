const { getConfig } = require('../config/economy');

// Sends a message to the configured host log channel. `payload` is a string or a
// discord.js message options object. Never throws — logging must not break a
// player-facing command.
async function logToHost(client, payload) {
    const channelId = getConfig().channels.host_log;
    if (!channelId) return;
    try {
        const channel = await client.channels.fetch(channelId);
        if (channel && channel.isTextBased()) {
            await channel.send(typeof payload === 'string' ? { content: payload } : payload);
        }
    } catch (err) {
        console.error('Failed to log to host channel:', err);
    }
}

// Role mention string for the configured host ping role, or '' if none set.
function hostPing() {
    const role = getConfig().channels.host_ping_role;
    return role ? `<@&${role}>` : '';
}

// Logs player command usage to the host channel, gated on the log_command_usage
// flag so hosts can silence the firehose without a code change.
async function logUsage(client, text) {
    if (getConfig().flags.log_command_usage) {
        await logToHost(client, text);
    }
}

module.exports = { logToHost, hostPing, logUsage };
