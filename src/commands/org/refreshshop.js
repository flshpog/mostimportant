const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ensureHost } = require('../../handlers/hostGate');
const shop = require('../../handlers/shop');
const { postShop } = require('../../handlers/shopService');

// Re-posts the CURRENT shop rotation (same items) using the latest config, so
// edits to item names/descriptions/prices - and newly added Cabinet items - show
// up on the live shop without re-picking the rotation. Deletes the old post and
// posts a fresh one, exactly like /setupshop.
module.exports = {
    data: new SlashCommandBuilder()
        .setName('refreshshop')
        .setDescription('Re-post the current shop with the latest config (host only).')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!(await ensureHost(interaction))) return;

        const current = shop.getCurrentShop(interaction.guildId);
        if (!current || !Array.isArray(current.items) || current.items.length === 0) {
            return interaction.reply({
                content: 'No shop is currently posted. Use `/setupshop` first.',
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });
        try {
            const message = await postShop(interaction.client, interaction.guildId, current.items);
            await interaction.editReply(`✅ Shop refreshed with the latest config: ${message.url}`);
        } catch (err) {
            console.error('Error refreshing shop:', err);
            await interaction.editReply(`❌ Could not refresh the shop: ${err.message}`);
        }
    },
};
