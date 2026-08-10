const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ensureHost } = require('../../handlers/hostGate');
const shop = require('../../handlers/shop');
const { updatePostedShop } = require('../../handlers/shopService');

// Resets all shop stock to the config defaults — every sold-out / finite item
// (Golden Shovel, May Day Ticket, etc.) becomes fully available and offerable
// again. Useful for a season reset or to clear stock depleted during testing.
module.exports = {
    data: new SlashCommandBuilder()
        .setName('restockshop')
        .setDescription('Reset all shop stock to full — every item available again (host only).')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!(await ensureHost(interaction))) return;

        shop.restockAll(interaction.guildId);
        // Refresh the live post so any SOLD OUT flips back to a stock count.
        await updatePostedShop(interaction.client, interaction.guildId).catch(() => {});

        await interaction.reply({
            content: '✅ All shop stock reset to full — every item is offerable in `/setupshop` and buyable again.',
            ephemeral: true,
        });
    },
};
