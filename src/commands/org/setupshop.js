const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { addRotationOptions, handleRotationAutocomplete, collectRotationIds } = require('../../handlers/rotationOptions');
const { ensureHost } = require('../../handlers/hostGate');
const { postShop } = require('../../handlers/shopService');

module.exports = {
    data: addRotationOptions(
        new SlashCommandBuilder()
            .setName('setupshop')
            .setDescription('Post a new shop rotation immediately (host only).')
    ).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async autocomplete(interaction) {
        await handleRotationAutocomplete(interaction);
    },

    async execute(interaction) {
        if (!(await ensureHost(interaction))) return;

        const { ids, error } = collectRotationIds(interaction);
        if (error) {
            return interaction.reply({ content: error, ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        try {
            const message = await postShop(interaction.client, interaction.guildId, ids);
            await interaction.editReply(`✅ Shop posted: ${message.url}`);
        } catch (err) {
            console.error('Error posting shop:', err);
            await interaction.editReply(`❌ Could not post the shop: ${err.message}`);
        }
    },
};
