const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clearcategorypermissions')
        .setDescription('Reset permission overwrites for all channels in a category')
        .addChannelOption(option =>
            option.setName('category')
                .setDescription('The category to reset permissions for')
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('sync_to_category')
                .setDescription('Sync all channels to the category permissions? (default: true)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const category = interaction.options.getChannel('category');
            const syncToCategory = interaction.options.getBoolean('sync_to_category') ?? true;

            // Get all channels in the category
            const channels = category.children.cache;

            if (channels.size === 0) {
                return await interaction.editReply('This category has no channels.');
            }

            let successCount = 0;
            let failCount = 0;
            const errors = [];

            for (const [, channel] of channels) {
                try {
                    if (syncToCategory) {
                        // Sync channel permissions to the category
                        await channel.lockPermissions();
                    } else {
                        // Remove all permission overwrites (except @everyone)
                        const overwrites = channel.permissionOverwrites.cache;
                        for (const [id, overwrite] of overwrites) {
                            // Skip @everyone role
                            if (id === interaction.guild.id) continue;
                            await overwrite.delete();
                        }
                    }
                    successCount++;
                } catch (error) {
                    failCount++;
                    errors.push(`${channel.name}: ${error.message}`);
                }
            }

            // Build response
            let response = `**Permission Reset Complete**\n`;
            response += `Category: **${category.name}**\n`;
            response += `Mode: **${syncToCategory ? 'Synced to category' : 'Cleared all overwrites'}**\n\n`;
            response += `Successfully reset: **${successCount}** channels\n`;

            if (failCount > 0) {
                response += `Failed: **${failCount}** channels\n`;
                response += `\nErrors:\n${errors.slice(0, 5).join('\n')}`;
                if (errors.length > 5) {
                    response += `\n...and ${errors.length - 5} more errors`;
                }
            }

            await interaction.editReply(response);

        } catch (error) {
            console.error('Error in clearcategorypermissions command:', error);
            await interaction.editReply('There was an error resetting permissions. Please check bot permissions.');
        }
    }
};
