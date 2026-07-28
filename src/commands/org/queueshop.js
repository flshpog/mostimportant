const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { addRotationOptions, handleRotationAutocomplete, collectRotationIds } = require('../../handlers/rotationOptions');
const { ensureHost } = require('../../handlers/hostGate');
const { getConfig } = require('../../config/economy');
const shop = require('../../handlers/shop');

module.exports = {
    data: addRotationOptions(
        new SlashCommandBuilder()
            .setName('queueshop')
            .setDescription('Queue a shop rotation to post at the next scheduled time (host only).')
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

        shop.setQueuedShop(interaction.guildId, { items: ids, by: interaction.user.id });

        const cfg = getConfig();
        await interaction.reply({
            content:
                `✅ Shop queued (${ids.length} items). It will post automatically at ` +
                `**${cfg.rotation.post_time} ${cfg.rotation.timezone}** and replace the current shop post.`,
            ephemeral: true,
        });
    },
};
