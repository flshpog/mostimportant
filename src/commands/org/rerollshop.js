const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ensureHost } = require('../../handlers/hostGate');
const shop = require('../../handlers/shop');
const { postShop } = require('../../handlers/shopService');

// Posts a new shop built from a random rotation of currently-available items —
// the same thing the midnight scheduler does automatically when no shop is
// queued. Handy for a manual reroll or for testing the auto-reroll.
module.exports = {
    data: new SlashCommandBuilder()
        .setName('rerollshop')
        .setDescription('Post a new shop with a random rotation of available items (host only).')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!(await ensureHost(interaction))) return;

        await interaction.deferReply({ ephemeral: true });
        try {
            const items = shop.randomRotation(interaction.guildId);
            if (!items.length) {
                return interaction.editReply('No available items to build a rotation from.');
            }
            const message = await postShop(interaction.client, interaction.guildId, items);
            await interaction.editReply(`🎲 Rerolled a random shop (${items.length} items): ${message.url}`);
        } catch (err) {
            console.error('Error rerolling shop:', err);
            await interaction.editReply(`❌ Could not reroll the shop: ${err.message}`);
        }
    },
};
