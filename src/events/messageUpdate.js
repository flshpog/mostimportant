const { Events, EmbedBuilder } = require('discord.js');
const { LOG_CHANNEL_ID, COLORS } = require('../config/logging');

module.exports = {
    name: Events.MessageUpdate,
    async execute(oldMessage, newMessage) {
        // Ignore partial messages, bot messages, or if content didn't change
        if (oldMessage.partial || newMessage.partial || oldMessage.author?.bot) return;
        if (oldMessage.content === newMessage.content) return;

        try {
            const logChannel = newMessage.guild.channels.cache.get(LOG_CHANNEL_ID);
            if (!logChannel) return;

            const embed = new EmbedBuilder()
                .setColor(COLORS.MESSAGE_EDIT)
                .setTitle('✏️ Message Edited')
                .setDescription(`**Message edited by ${newMessage.author} in ${newMessage.channel}**\n[Jump to Message](${newMessage.url})`)
                .addFields(
                    { name: 'Author', value: `${newMessage.author.tag} (${newMessage.author.id})`, inline: true },
                    { name: 'Channel', value: `${newMessage.channel.name} (${newMessage.channel.id})`, inline: true }
                )
                .setTimestamp();

            // Add old content
            if (oldMessage.content) {
                embed.addFields({
                    name: 'Before',
                    value: oldMessage.content.length > 1024 ? oldMessage.content.substring(0, 1021) + '...' : oldMessage.content
                });
            }

            // Add new content
            if (newMessage.content) {
                embed.addFields({
                    name: 'After',
                    value: newMessage.content.length > 1024 ? newMessage.content.substring(0, 1021) + '...' : newMessage.content
                });
            }

            if (newMessage.author.displayAvatarURL) {
                embed.setThumbnail(newMessage.author.displayAvatarURL());
            }

            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('Error logging message edit:', error);
        }
    },
};
