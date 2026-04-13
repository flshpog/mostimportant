const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('permfix')
        .setDescription('Fix Suite Rentees role permissions in specified categories')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        try {
            // Role and category IDs
            const ROLE_ID = '1414012718293323776'; // Suite Rentees
            const CATEGORY_IDS = [
                '1414015320305307708',
                '1414015358783852666',
                '1414015400806580404',
                '1414015462458790029'
            ];

            await interaction.deferReply({ ephemeral: true });

            // Get the role
            const role = interaction.guild.roles.cache.get(ROLE_ID);
            if (!role) {
                return await interaction.editReply({
                    content: `Could not find role with ID ${ROLE_ID}.`
                });
            }

            let updatedChannels = [];
            let skippedChannels = [];
            let failedChannels = [];

            // Process each category
            for (const categoryId of CATEGORY_IDS) {
                const category = interaction.guild.channels.cache.get(categoryId);

                if (!category) {
                    failedChannels.push(`Category ${categoryId} not found`);
                    continue;
                }

                // Get all channels in this category
                const channels = interaction.guild.channels.cache.filter(
                    channel => channel.parentId === categoryId
                );

                for (const [channelId, channel] of channels) {
                    try {
                        // Check current permissions for the role
                        const currentOverwrite = channel.permissionOverwrites.cache.get(ROLE_ID);

                        // Check if permissions already match what we want
                        let needsUpdate = false;

                        if (!currentOverwrite) {
                            // No override exists, we need to create one
                            needsUpdate = true;
                        } else {
                            // Check if the permissions are exactly what we want
                            const hasViewChannel = currentOverwrite.allow.has(PermissionFlagsBits.ViewChannel);
                            const deniesViewChannel = currentOverwrite.deny.has(PermissionFlagsBits.ViewChannel);
                            const hasSendMessages = currentOverwrite.allow.has(PermissionFlagsBits.SendMessages);
                            const deniesSendMessages = currentOverwrite.deny.has(PermissionFlagsBits.SendMessages);

                            // We want ViewChannel to be allowed and SendMessages to be denied
                            // If either is not set correctly, we need to update
                            if (!hasViewChannel || hasSendMessages || deniesViewChannel || !deniesSendMessages) {
                                needsUpdate = true;
                            }
                        }

                        if (needsUpdate) {
                            // Update permissions - only modify ViewChannel and SendMessages
                            await channel.permissionOverwrites.edit(ROLE_ID, {
                                ViewChannel: true,
                                SendMessages: false
                            }, {
                                reason: `Permission fix executed by ${interaction.user.tag}`
                            });

                            updatedChannels.push(channel.name);
                        } else {
                            skippedChannels.push(channel.name);
                        }
                    } catch (error) {
                        console.error(`Error updating permissions for ${channel.name}:`, error);
                        failedChannels.push(channel.name);
                    }
                }
            }

            // Build response message
            let responseMessage = `**Permission Fix Complete for ${role.name}**\n\n`;

            if (updatedChannels.length > 0) {
                responseMessage += `✅ **Updated ${updatedChannels.length} channel(s):**\n`;
                responseMessage += updatedChannels.map(name => `• ${name}`).join('\n');
                responseMessage += '\n\n';
            }

            if (skippedChannels.length > 0) {
                responseMessage += `⏭️ **Skipped ${skippedChannels.length} channel(s)** (already correct):\n`;
                responseMessage += skippedChannels.map(name => `• ${name}`).join('\n');
                responseMessage += '\n\n';
            }

            if (failedChannels.length > 0) {
                responseMessage += `❌ **Failed ${failedChannels.length} channel(s):**\n`;
                responseMessage += failedChannels.map(name => `• ${name}`).join('\n');
                responseMessage += '\n\n';
            }

            if (updatedChannels.length === 0 && skippedChannels.length === 0 && failedChannels.length === 0) {
                responseMessage += 'No channels found in the specified categories.';
            }

            responseMessage += `\n**Permissions Set:**\n• View Channel: ✅ Allow\n• Send Messages: ❌ Deny`;

            await interaction.editReply(responseMessage);

        } catch (error) {
            console.error('Error in permfix command:', error);
            const errorMessage = 'There was an error fixing the permissions.';

            if (interaction.deferred) {
                await interaction.editReply(errorMessage);
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    }
};
