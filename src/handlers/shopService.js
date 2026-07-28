const { getConfig } = require('../config/economy');
const { buildShopEmbeds } = require('./shopEmbed');
const shop = require('./shop');
const { logToHost } = require('./economyLog');

// Posts a shop rotation to the configured shop channel, deleting the previously
// stored shop message first (by its stored ID — never "the last bot message").
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
            // Already gone — fine.
        }
    }

    const embeds = buildShopEmbeds(guildId, itemIds);
    const message = await channel.send({ embeds });

    shop.setCurrentShop(guildId, { channelId, messageId: message.id, items: itemIds });
    await logToHost(client, `🛍️ Shop rotation posted (${itemIds.length} items) in <#${channelId}>.`);
    return message;
}

module.exports = { postShop };
