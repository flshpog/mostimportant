const { Events, EmbedBuilder, ChannelType } = require('discord.js');
const { LOG_CHANNEL_ID, COLORS } = require('../config/logging');

module.exports = {
    name: Events.ChannelDelete,
    async execute(channel) {
        try {
            const logChannel = channel.guild.channels.cache.get(LOG_CHANNEL_ID);
            if (!logChannel) return;

            // Get channel type name
            const channelTypes = {
                [ChannelType.GuildText]: 'Text Channel',
                [ChannelType.GuildVoice]: 'Voice Channel',
                [ChannelType.GuildCategory]: 'Category',
                [ChannelType.GuildAnnouncement]: 'Announcement Channel',
                [ChannelType.GuildStageVoice]: 'Stage Channel',
                [ChannelType.GuildForum]: 'Forum Channel'
            };

            const channelTypeName = channelTypes[channel.type] || 'Unknown';

            const embed = new EmbedBuilder()
                .setColor(COLORS.CHANNEL_DELETE)
                .setTitle('➖ Channel Deleted')
                .setDescription(`**A channel has been deleted**`)
                .addFields(
                    { name: 'Channel', value: `${channel.name} (${channel.id})`, inline: true },
                    { name: 'Type', value: channelTypeName, inline: true }
                )
                .setTimestamp();

            // Add parent category if exists
            if (channel.parent) {
                embed.addFields({ name: 'Category', value: channel.parent.name, inline: true });
            }

            // Add topic if text channel
            if (channel.topic) {
                embed.addFields({ name: 'Topic', value: channel.topic });
            }

            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('Error logging channel deletion:', error);
        }
    },
};
