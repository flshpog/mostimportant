const { PermissionFlagsBits } = require('discord.js');

// Animal Crossing leaf green — default embed accent when a payload omits `color`.
const AC_GREEN = 0x7CBB3F;

// Name of the webhook we create/reuse per channel to post as season characters.
const WEBHOOK_NAME = 'Everest Interview';

// Find our existing interview webhook in the channel, or create one.
async function getWebhook(channel) {
    const me = channel.guild.members.me;
    if (!me || !me.permissionsIn(channel).has(PermissionFlagsBits.ManageWebhooks)) {
        throw new Error('Missing Manage Webhooks permission in ' + channel.id);
    }

    const hooks = await channel.fetchWebhooks();
    let hook = hooks.find(h => h.name === WEBHOOK_NAME && h.owner?.id === channel.client.user.id);
    if (!hook) {
        hook = await channel.createWebhook({ name: WEBHOOK_NAME });
    }
    return hook;
}

// Send a Discohook-style payload ({ username, avatar_url, embeds }) as a character.
// `content` is an optional plain string (e.g. a user ping) sent above the embed.
async function sendAsCharacter(channel, payload, content) {
    const webhook = await getWebhook(channel);

    // Inject the season accent color into any embed that doesn't set its own.
    const embeds = (payload.embeds || []).map(embed => ({ color: AC_GREEN, ...embed }));

    return webhook.send({
        username: payload.username || undefined,
        avatarURL: payload.avatar_url || undefined,
        content: content || undefined,
        embeds,
        // Only allow user pings (the applicant) — never @everyone/@here from a payload.
        allowedMentions: { parse: ['users'] },
    });
}

module.exports = {
    sendAsCharacter,
    AC_GREEN,
    WEBHOOK_NAME,
};
