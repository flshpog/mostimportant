const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Delete a specified number of messages from the channel')
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Number of messages to delete (1-1000)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(1000))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    name: 'purge',
    description: 'Delete a specified number of messages from the channel',
    usage: '!purge <amount>',

    async execute(interaction) {
        // Handle both slash commands and prefix commands
        const isSlashCommand = interaction.isCommand?.();

        try {
            let amount;
            let channel;

            if (isSlashCommand) {
                // Slash command
                amount = interaction.options.getInteger('amount');
                channel = interaction.channel;
                await interaction.deferReply({ ephemeral: true });
            } else {
                // Prefix command (interaction is actually a message)
                const message = interaction;
                const args = message.content.split(' ').slice(1);

                if (!args[0]) {
                    return await message.reply('Please specify the number of messages to delete. Usage: `!purge <amount>`');
                }

                amount = parseInt(args[0]);

                if (isNaN(amount)) {
                    return await message.reply('Please provide a valid number.');
                }

                if (amount < 1 || amount > 1000) {
                    return await message.reply('Please specify a number between 1 and 1000.');
                }

                // Check if user has permissions
                if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
                    return await message.reply('You need the Manage Messages permission to use this command.');
                }

                channel = message.channel;
            }

            // Delete messages
            try {
                let deletedCount = 0;
                let remaining = amount;

                // Discord API limits bulk delete to 100 messages at a time
                // Also can only delete messages less than 14 days old with bulkDelete
                while (remaining > 0) {
                    const deleteAmount = Math.min(remaining, 100);
                    const messages = await channel.messages.fetch({ limit: deleteAmount });

                    if (messages.size === 0) break;

                    // Filter out messages older than 14 days (Discord API limitation)
                    const deletableMessages = messages.filter(
                        msg => Date.now() - msg.createdTimestamp < 14 * 24 * 60 * 60 * 1000
                    );

                    if (deletableMessages.size === 0) break;

                    const deleted = await channel.bulkDelete(deletableMessages, true);
                    deletedCount += deleted.size;
                    remaining -= deleteAmount;

                    if (deleted.size < deleteAmount) break;
                }

                // Delete the command message if it's a prefix command
                if (!isSlashCommand) {
                    await interaction.delete().catch(() => {});
                }

                const successMessage = `✅ Successfully deleted **${deletedCount}** message${deletedCount !== 1 ? 's' : ''}.`;

                if (isSlashCommand) {
                    await interaction.editReply(successMessage);
                } else {
                    // Send a temporary success message for prefix command
                    const reply = await channel.send(successMessage);
                    setTimeout(() => reply.delete().catch(() => {}), 5000);
                }

            } catch (deleteError) {
                console.error('Error deleting messages:', deleteError);

                let errorMessage = 'Failed to delete messages. ';

                if (deleteError.code === 50013) {
                    errorMessage += 'I don\'t have permission to manage messages in this channel.';
                } else if (deleteError.code === 50001) {
                    errorMessage += 'I don\'t have access to this channel.';
                } else {
                    errorMessage += 'Please check that I have the necessary permissions.';
                }

                if (isSlashCommand) {
                    await interaction.editReply(errorMessage);
                } else {
                    await channel.send(errorMessage);
                }
            }

        } catch (error) {
            console.error('Error in purge command:', error);
            const errorMessage = 'There was an error processing the purge command.';

            if (isSlashCommand) {
                if (interaction.deferred) {
                    await interaction.editReply(errorMessage);
                } else {
                    await interaction.reply({ content: errorMessage, ephemeral: true });
                }
            } else {
                await interaction.channel.send(errorMessage);
            }
        }
    }
};
