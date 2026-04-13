const { Events, EmbedBuilder, ChannelType } = require('discord.js');
const { LOG_CHANNEL_ID, COLORS } = require('../config/logging');

module.exports = {
    name: Events.ChannelUpdate,
    async execute(oldChannel, newChannel) {
        try {
            const logChannel = newChannel.guild.channels.cache.get(LOG_CHANNEL_ID);
            if (!logChannel) return;

            const changes = [];

            // Check name change
            if (oldChannel.name !== newChannel.name) {
                changes.push({ name: 'Name Changed', value: `${oldChannel.name} → ${newChannel.name}` });
            }

            // Check topic change (text channels)
            if (oldChannel.topic !== newChannel.topic) {
                const oldTopic = oldChannel.topic || 'None';
                const newTopic = newChannel.topic || 'None';
                changes.push({ name: 'Topic Changed', value: `${oldTopic} → ${newTopic}` });
            }

            // Check NSFW change
            if (oldChannel.nsfw !== newChannel.nsfw) {
                changes.push({ name: 'NSFW', value: `${oldChannel.nsfw ? 'Yes' : 'No'} → ${newChannel.nsfw ? 'Yes' : 'No'}` });
            }

            // Check slowmode change (text channels)
            if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
                changes.push({
                    name: 'Slowmode',
                    value: `${oldChannel.rateLimitPerUser || 0}s → ${newChannel.rateLimitPerUser || 0}s`
                });
            }

            // Check bitrate change (voice channels)
            if (oldChannel.bitrate !== undefined && oldChannel.bitrate !== newChannel.bitrate) {
                changes.push({
                    name: 'Bitrate',
                    value: `${oldChannel.bitrate / 1000}kbps → ${newChannel.bitrate / 1000}kbps`
                });
            }

            // Check user limit change (voice channels)
            if (oldChannel.userLimit !== undefined && oldChannel.userLimit !== newChannel.userLimit) {
                const oldLimit = oldChannel.userLimit === 0 ? 'Unlimited' : oldChannel.userLimit;
                const newLimit = newChannel.userLimit === 0 ? 'Unlimited' : newChannel.userLimit;
                changes.push({ name: 'User Limit', value: `${oldLimit} → ${newLimit}` });
            }

            // Check parent change (category)
            if (oldChannel.parentId !== newChannel.parentId) {
                const oldParent = oldChannel.parent?.name || 'None';
                const newParent = newChannel.parent?.name || 'None';
                changes.push({ name: 'Category', value: `${oldParent} → ${newParent}` });
            }

            // Check permission overwrites
            if (oldChannel.permissionOverwrites && newChannel.permissionOverwrites) {
                const oldPerms = oldChannel.permissionOverwrites.cache.size;
                const newPerms = newChannel.permissionOverwrites.cache.size;
                if (oldPerms !== newPerms) {
                    changes.push({ name: 'Permissions', value: 'Permission overwrites modified' });
                }
            }

            // If no changes detected, return
            if (changes.length === 0) return;

            const channelTypes = {
                [ChannelType.GuildText]: 'Text Channel',
                [ChannelType.GuildVoice]: 'Voice Channel',
                [ChannelType.GuildCategory]: 'Category',
                [ChannelType.GuildAnnouncement]: 'Announcement Channel',
                [ChannelType.GuildStageVoice]: 'Stage Channel',
                [ChannelType.GuildForum]: 'Forum Channel'
            };

            const channelTypeName = channelTypes[newChannel.type] || 'Unknown';

            const embed = new EmbedBuilder()
                .setColor(COLORS.CHANNEL_UPDATE)
                .setTitle('🔧 Channel Updated')
                .setDescription(`**${newChannel.name} has been updated**`)
                .addFields(
                    { name: 'Channel', value: `${newChannel.name} (${newChannel.id})`, inline: true },
                    { name: 'Type', value: channelTypeName, inline: true }
                )
                .addFields(changes)
                .setTimestamp();

            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('Error logging channel update:', error);
        }
    },
};
