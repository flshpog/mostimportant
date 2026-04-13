const { Events, EmbedBuilder } = require('discord.js');
const { LOG_CHANNEL_ID, COLORS } = require('../config/logging');

module.exports = {
    name: Events.VoiceStateUpdate,
    async execute(oldState, newState) {
        try {
            const logChannel = newState.guild.channels.cache.get(LOG_CHANNEL_ID);
            if (!logChannel) return;

            const member = newState.member;
            let embed;

            if (!oldState.channel && newState.channel) {
                embed = new EmbedBuilder()
                    .setColor(COLORS.VOICE_JOIN)
                    .setTitle('🔊 Voice Channel Joined')
                    .setDescription(`**${member.user.tag} joined a voice channel**`)
                    .addFields(
                        { name: 'User', value: `${member.user.tag} (${member.user.id})`, inline: true },
                        { name: 'Channel', value: `${newState.channel.name}`, inline: true }
                    )
                    .setThumbnail(member.user.displayAvatarURL())
                    .setTimestamp();
            } else if (oldState.channel && !newState.channel) {
                embed = new EmbedBuilder()
                    .setColor(COLORS.VOICE_LEAVE)
                    .setTitle('🔇 Voice Channel Left')
                    .setDescription(`**${member.user.tag} left a voice channel**`)
                    .addFields(
                        { name: 'User', value: `${member.user.tag} (${member.user.id})`, inline: true },
                        { name: 'Channel', value: `${oldState.channel.name}`, inline: true }
                    )
                    .setThumbnail(member.user.displayAvatarURL())
                    .setTimestamp();
            } else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
                embed = new EmbedBuilder()
                    .setColor(COLORS.VOICE_MOVE)
                    .setTitle('🔀 Voice Channel Switched')
                    .setDescription(`**${member.user.tag} switched voice channels**`)
                    .addFields(
                        { name: 'User', value: `${member.user.tag} (${member.user.id})`, inline: true },
                        { name: 'From', value: `${oldState.channel.name}`, inline: true },
                        { name: 'To', value: `${newState.channel.name}`, inline: true }
                    )
                    .setThumbnail(member.user.displayAvatarURL())
                    .setTimestamp();
            }

            if (embed) {
                await logChannel.send({ embeds: [embed] });
            }
        } catch (error) {
            console.error('Error logging voice state update:', error);
        }
    },
};
