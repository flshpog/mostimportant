const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('chmove')
        .setDescription('Move a channel to a different category')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel to move')
                .setRequired(true))
        .addChannelOption(option =>
            option.setName('category')
                .setDescription('The category to move the channel to')
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    name: 'chmove',
    description: 'Move a channel to a different category',
    usage: '!chmove <category name>',

    async execute(interaction) {
        // Handle both slash commands and prefix commands
        const isSlashCommand = interaction.isCommand?.();

        try {
            let channel;
            let category;
            let user;

            if (isSlashCommand) {
                // Slash command
                channel = interaction.options.getChannel('channel');
                category = interaction.options.getChannel('category');
                user = interaction.user;
            } else {
                // Prefix command (interaction is actually a message)
                const message = interaction;
                const args = message.content.slice(message.content.indexOf(' ') + 1).trim();

                if (!args || args === '!chmove') {
                    return await message.reply('Please specify a category name. Usage: `!chmove <category name>`\nExample: `!chmove Complete Applications`');
                }

                // Check if user has permissions
                if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
                    return await message.reply('You need the Manage Channels permission to use this command.');
                }

                // Channel is where the command was run
                channel = message.channel;
                user = message.author;

                // Find category by name (case-insensitive partial matching)
                const searchTerm = args.toLowerCase();
                const categories = message.guild.channels.cache.filter(ch => ch.type === ChannelType.GuildCategory);

                // Try to find exact match first
                category = categories.find(cat => cat.name.toLowerCase() === searchTerm);

                // If no exact match, try partial match
                if (!category) {
                    category = categories.find(cat =>
                        cat.name.toLowerCase().includes(searchTerm) ||
                        // Remove special characters and emojis for better matching
                        cat.name.replace(/[^\w\s]/gi, '').toLowerCase().includes(searchTerm)
                    );
                }

                // If still no match, try matching without special characters in search term
                if (!category) {
                    const cleanSearchTerm = searchTerm.replace(/[^\w\s]/gi, '');
                    category = categories.find(cat =>
                        cat.name.toLowerCase().includes(cleanSearchTerm) ||
                        cat.name.replace(/[^\w\s]/gi, '').toLowerCase().includes(cleanSearchTerm)
                    );
                }

                if (!category) {
                    // List available categories to help user
                    const availableCategories = categories.map(cat => `• ${cat.name}`).join('\n');
                    return await message.reply(
                        `Could not find a category matching "${args}".\n\n**Available categories:**\n${availableCategories || 'No categories found'}`
                    );
                }
            }

            // Validate channel type
            if (!channel.isTextBased() &&
                channel.type !== ChannelType.GuildVoice &&
                channel.type !== ChannelType.GuildStageVoice &&
                channel.type !== ChannelType.GuildForum &&
                channel.type !== ChannelType.GuildAnnouncement) {
                const errorMsg = 'You can only move text, voice, stage, forum, or announcement channels.';
                if (isSlashCommand) {
                    return await interaction.reply({ content: errorMsg, ephemeral: true });
                } else {
                    return await interaction.reply(errorMsg);
                }
            }

            // Validate category
            if (category.type !== ChannelType.GuildCategory) {
                const errorMsg = 'Please select a valid category channel.';
                if (isSlashCommand) {
                    return await interaction.reply({ content: errorMsg, ephemeral: true });
                } else {
                    return await interaction.reply(errorMsg);
                }
            }

            // Check if channel is already in the target category
            if (channel.parentId === category.id) {
                const errorMsg = `${channel} is already in the **${category.name}** category.`;
                if (isSlashCommand) {
                    return await interaction.reply({ content: errorMsg, ephemeral: true });
                } else {
                    return await interaction.reply(errorMsg);
                }
            }

            // Check category channel limit (Discord limit is 50 channels per category)
            const categoryChannelCount = category.children.cache.size;
            if (categoryChannelCount >= 50) {
                const errorMsg = `The **${category.name}** category is full (50/50 channels). Please choose a different category or remove some channels first.`;
                if (isSlashCommand) {
                    return await interaction.reply({ content: errorMsg, ephemeral: true });
                } else {
                    return await interaction.reply(errorMsg);
                }
            }

            const oldCategory = channel.parent ? channel.parent.name : 'No Category';

            if (isSlashCommand) {
                await interaction.deferReply({ ephemeral: true });
            }

            try {
                // Move the channel while preserving permissions
                await channel.setParent(category, {
                    lockPermissions: false,
                    reason: `Channel moved by ${user.tag} using chmove command`
                });

                const successMessage = `✅ Successfully moved ${channel} to the **${category.name}** category!\n\n` +
                                      `**📊 Move Details:**\n` +
                                      `• **Channel:** ${channel.name}\n` +
                                      `• **From:** ${oldCategory}\n` +
                                      `• **To:** ${category.name}\n` +
                                      `• **Category Usage:** ${categoryChannelCount + 1}/50 channels`;

                if (isSlashCommand) {
                    await interaction.editReply(successMessage);
                } else {
                    await interaction.reply(successMessage);
                }

            } catch (moveError) {
                console.error('Error moving channel:', moveError);

                let errorMessage = 'Failed to move the channel. ';

                if (moveError.code === 50013) {
                    errorMessage += 'I don\'t have permission to manage this channel or category.';
                } else if (moveError.code === 50001) {
                    errorMessage += 'I don\'t have access to the specified channel or category.';
                } else {
                    errorMessage += 'Please check that I have the necessary permissions and try again.';
                }

                if (isSlashCommand) {
                    await interaction.editReply(errorMessage);
                } else {
                    await interaction.reply(errorMessage);
                }
            }

        } catch (error) {
            console.error('Error in chmove command:', error);
            const errorMessage = 'There was an error processing the channel move command.';

            if (isSlashCommand) {
                if (interaction.deferred) {
                    await interaction.editReply(errorMessage);
                } else {
                    await interaction.reply({ content: errorMessage, ephemeral: true });
                }
            } else {
                await interaction.reply(errorMessage);
            }
        }
    }
};