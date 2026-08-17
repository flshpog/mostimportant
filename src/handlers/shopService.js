const { getConfig } = require('../config/economy');
const { buildShopEmbeds } = require('./shopEmbed');
const shop = require('./shop');
const { logToHost } = require('./economyLog');

// Posts a shop rotation to the configured shop channel, deleting the previously
// stored shop message first (by its stored ID - never "the last bot message").
// Shared by /setupshop and the midnight scheduler. Records the new current shop.
async function postShop(client, guildId, itemIds) {
    const cfg = getConfig();
    const channelId = cfg.channels.shop;
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
        throw new Error('Shop channel not found or is not a text channel.');
    }

    // Delete the previous shop post by its stored message ID.
    const prev = shop.getCurrentShop(guildId);
    if (prev && prev.messageId) {
        try {
            const prevMsg = await channel.messages.fetch(prev.messageId);
            await prevMsg.delete();
        } catch {
            // Already gone - fine.
        }
    }

    const embeds = buildShopEmbeds(guildId, itemIds);
    const message = await channel.send({ embeds });

    shop.setCurrentShop(guildId, { channelId, messageId: message.id, items: itemIds });
    await logToHost(client, `🛍️ Shop rotation posted (${itemIds.length} items) in <#${channelId}>.`);
    return message;
}

// Edits the currently-posted shop message in place with freshly-rendered embeds,
// so stock counts (and SOLD OUT) stay live as items sell. No-op if no shop is
// posted. Never throws - a failed stock refresh must not break a purchase.
async function updatePostedShop(client, guildId) {
    const current = shop.getCurrentShop(guildId);
    if (!current || !current.messageId) return;
    try {
        const channelId = current.channelId || getConfig().channels.shop;
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) return;
        const message = await channel.messages.fetch(current.messageId);
        await message.edit({ embeds: buildShopEmbeds(guildId, current.items) });
    } catch (err) {
        console.error('Failed to update posted shop:', err);
    }
}

module.exports = { postShop, updatePostedShop };
