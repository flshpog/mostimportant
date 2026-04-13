const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('say')
        .setDescription('Send a message to a specific channel')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel to send the message to')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true))
        .addStringOption(option =>
            option.setName('message')
                .setDescription('The message to send')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    name: 'say',
    description: 'Send a message to a specific channel',
    usage: '?say <#channel|channel_id> <message>',

    async execute(interaction, args) {
        const isSlash = !args; // If args is undefined, it's a slash command
        
        try {
            let targetChannel, message;

            if (isSlash) {
                // Slash command
                targetChannel = interaction.options.getChannel('channel');
                message = interaction.options.getString('message');

                // Validate channel type
                if (!targetChannel.isTextBased()) {
                    return await interaction.reply({
                        content: 'You can only send messages to text-based channels.',
                        ephemeral: true
                    });
                }

            } else {
                // Prefix command
                const msg = interaction; // interaction is actually message for prefix commands
                
                if (args.length < 2) {
                    return await msg.reply('Please provide both a channel and a message.\nUsage: `?say <#channel|channel_id> <message>`');
                }

                // Parse channel from first argument
                const channelArg = args[0];
                const channelId = channelArg.replace(/[<#>]/g, ''); // Remove <#> if it's a mention
                
                targetChannel = msg.guild.channels.cache.get(channelId);
                
                if (!targetChannel) {
                    return await msg.reply('Invalid channel provided. Please use a channel mention (#channel) or valid channel ID.');
                }

                if (!targetChannel.isTextBased()) {
                    return await msg.reply('You can only send messages to text-based channels.');
                }

                // Get message content (everything after the channel argument)
                message = args.slice(1).join(' ');
            }

            // Check if message is empty or too long
            if (!message || message.trim().length === 0) {
                const errorMsg = 'Message cannot be empty.';
                return await (isSlash ? 
                    interaction.reply({ content: errorMsg, ephemeral: true }) :
                    interaction.reply(errorMsg));
            }

            if (message.length > 2000) {
                const errorMsg = 'Message is too long. Discord messages must be 2000 characters or less.';
                return await (isSlash ? 
                    interaction.reply({ content: errorMsg, ephemeral: true }) :
                    interaction.reply(errorMsg));
            }

            // Check bot permissions in target channel
            const botMember = targetChannel.guild.members.cache.get(targetChannel.client.user.id);
            if (!targetChannel.permissionsFor(botMember).has('SendMessages')) {
                const errorMsg = `I don't have permission to send messages in ${targetChannel}.`;
                return await (isSlash ? 
                    interaction.reply({ content: errorMsg, ephemeral: true }) :
                    interaction.reply(errorMsg));
            }

            // Check user permissions in target channel (for security)
            const userMember = isSlash ? interaction.member : interaction.member;
            if (!targetChannel.permissionsFor(userMember).has('SendMessages')) {
                const errorMsg = `You don't have permission to send messages in ${targetChannel}.`;
                return await (isSlash ? 
                    interaction.reply({ content: errorMsg, ephemeral: true }) :
                    interaction.reply(errorMsg));
            }

            try {
                // Send the message to target channel
                await targetChannel.send(message);

                // Confirm to user
                const successMsg = `✅ Message sent to ${targetChannel}`;
                await (isSlash ? 
                    interaction.reply({ content: successMsg, ephemeral: true }) :
                    interaction.reply(successMsg));

                // Delete the original command message if it's a prefix command
                if (!isSlash) {
                    try {
                        await interaction.delete();
                    } catch (deleteError) {
                        // Ignore delete errors (might not have permission)
                        console.log('Could not delete original say command message');
                    }
                }

            } catch (sendError) {
                console.error('Error sending message:', sendError);
                let errorMsg = 'Failed to send the message. ';
                
                if (sendError.code === 50013) {
                    errorMsg += 'I don\'t have permission to send messages in that channel.';
                } else if (sendError.code === 50001) {
                    errorMsg += 'I don\'t have access to that channel.';
                } else {
                    errorMsg += 'Please check channel permissions and try again.';
                }

                await (isSlash ? 
                    interaction.reply({ content: errorMsg, ephemeral: true }) :
                    interaction.reply(errorMsg));
            }

        } catch (error) {
            console.error('Error in say command:', error);
            const errorMsg = 'There was an error processing the say command.';
            
            await (isSlash ? 
                interaction.reply({ content: errorMsg, ephemeral: true }) :
                interaction.reply(errorMsg));
        }
    }
};