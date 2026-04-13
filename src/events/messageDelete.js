const { Events, EmbedBuilder } = require('discord.js');
const { LOG_CHANNEL_ID, COLORS } = require('../config/logging');

module.exports = {
    name: Events.MessageDelete,
    async execute(message) {
        // Ignore partial messages or bot messages
        if (message.partial || message.author?.bot) return;

        // Store message for snipe command
        try {
            const client = message.client;
            if (!client.snipedMessages) {
                const { Collection } = require('discord.js');
                client.snipedMessages = new Collection();
            }

            client.snipedMessages.set(message.channel.id, {
                content: message.content,
                authorTag: message.author.tag,
                authorAvatar: message.author.displayAvatarURL(),
                channelName: message.channel.name,
                deletedAt: new Date(),
                attachments: message.attachments.map(att => att.url)
            });
        } catch (snipeError) {
            console.error('Error storing sniped message:', snipeError);
        }

        try {
            const logChannel = message.guild.channels.cache.get(LOG_CHANNEL_ID);
            if (!logChannel) return;

            const embed = new EmbedBuilder()
                .setColor(COLORS.MESSAGE_DELETE)
                .setTitle('📝 Message Deleted')
                .setDescription(`**Message sent by ${message.author} deleted in ${message.channel}**`)
                .addFields(
                    { name: 'Author', value: `${message.author.tag} (${message.author.id})`, inline: true },
                    { name: 'Channel', value: `${message.channel.name} (${message.channel.id})`, inline: true }
                )
                .setTimestamp();

            // Add message content if available
            if (message.content) {
                embed.addFields({
                    name: 'Content',
                    value: message.content.length > 1024 ? message.content.substring(0, 1021) + '...' : message.content
                });
            }

            // Add attachment info if present
            if (message.attachments.size > 0) {
                const attachmentList = message.attachments.map(att => `[${att.name}](${att.url})`).join('\n');
                embed.addFields({
                    name: `Attachments (${message.attachments.size})`,
                    value: attachmentList.length > 1024 ? attachmentList.substring(0, 1021) + '...' : attachmentList
                });
            }

            if (message.author.displayAvatarURL) {
                embed.setThumbnail(message.author.displayAvatarURL());
            }

            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('Error logging message deletion:', error);
        }
    },
};
