const { Events, EmbedBuilder } = require('discord.js');
const { LOG_CHANNEL_ID, COLORS } = require('../config/logging');

// CONFIG - Update these IDs for your server
const CONFIG = {
    JOIN_LOG_CHANNEL_ID: "1414321682839109815",
};

module.exports = {
    name: Events.GuildMemberRemove,
    async execute(member) {
        try {
            const joinLogChannel = member.guild.channels.cache.get(CONFIG.JOIN_LOG_CHANNEL_ID);

            if (joinLogChannel) {
                const goodbyeMessage = `${member.displayName} just left the server. Someone's missing out!`;
                await joinLogChannel.send(goodbyeMessage);
            } else {
                console.error('Join log channel not found. Please update JOIN_LOG_CHANNEL_ID in guildMemberRemove.js');
            }

            // Log member leave to logging channel
            try {
                const logChannel = member.guild.channels.cache.get(LOG_CHANNEL_ID);
                if (logChannel) {
                    const memberCount = member.guild.memberCount;

                    // Calculate how long they were in the server
                    const joinedTimestamp = member.joinedTimestamp;
                    let memberDuration = 'Unknown';
                    if (joinedTimestamp) {
                        const duration = Date.now() - joinedTimestamp;
                        const days = Math.floor(duration / (1000 * 60 * 60 * 24));
                        const hours = Math.floor((duration % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

                        if (days > 0) {
                            memberDuration = `${days} day${days !== 1 ? 's' : ''} ${hours} hour${hours !== 1 ? 's' : ''}`;
                        } else {
                            memberDuration = `${hours} hour${hours !== 1 ? 's' : ''}`;
                        }
                    }

                    const embed = new EmbedBuilder()
                        .setColor(COLORS.MEMBER_LEAVE)
                        .setTitle('📤 Member Left')
                        .setDescription(`**${member.user.tag} left the server**`)
                        .addFields(
                            { name: 'User', value: `${member.user.tag}`, inline: true },
                            { name: 'User ID', value: member.user.id, inline: true },
                            { name: 'Member Count', value: `${memberCount}`, inline: true }
                        )
                        .setThumbnail(member.user.displayAvatarURL())
                        .setTimestamp();

                    if (joinedTimestamp) {
                        embed.addFields(
                            { name: 'Joined', value: `<t:${Math.floor(joinedTimestamp / 1000)}:R>`, inline: true },
                            { name: 'Time in Server', value: memberDuration, inline: true }
                        );
                    }

                    // Add roles they had
                    const roles = member.roles.cache
                        .filter(role => role.id !== member.guild.id) // Exclude @everyone
                        .map(role => role.name)
                        .join(', ');

                    if (roles) {
                        embed.addFields({ name: 'Roles', value: roles });
                    }

                    await logChannel.send({ embeds: [embed] });
                }
            } catch (logError) {
                console.error('Error logging member leave:', logError);
            }

        } catch (error) {
            console.error('Error in guildMemberRemove event:', error);
        }
    },
};