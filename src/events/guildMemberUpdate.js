const { Events, EmbedBuilder } = require('discord.js');
const { LOG_CHANNEL_ID, COLORS } = require('../config/logging');

module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember) {
        try {
            const logChannel = newMember.guild.channels.cache.get(LOG_CHANNEL_ID);
            if (!logChannel) return;

            const changes = [];

            // Check nickname change
            if (oldMember.nickname !== newMember.nickname) {
                const oldNick = oldMember.nickname || oldMember.user.username;
                const newNick = newMember.nickname || newMember.user.username;
                changes.push({ name: 'Nickname Changed', value: `${oldNick} → ${newNick}` });
            }

            // Check role changes
            const oldRoles = oldMember.roles.cache.filter(role => role.id !== newMember.guild.id);
            const newRoles = newMember.roles.cache.filter(role => role.id !== newMember.guild.id);

            const addedRoles = newRoles.filter(role => !oldRoles.has(role.id));
            const removedRoles = oldRoles.filter(role => !newRoles.has(role.id));

            if (addedRoles.size > 0) {
                const roleList = addedRoles.map(role => role.name).join(', ');
                changes.push({ name: 'Roles Added', value: roleList });
            }

            if (removedRoles.size > 0) {
                const roleList = removedRoles.map(role => role.name).join(', ');
                changes.push({ name: 'Roles Removed', value: roleList });
            }

            // Check timeout change
            if (oldMember.communicationDisabledUntil !== newMember.communicationDisabledUntil) {
                if (newMember.communicationDisabledUntil) {
                    changes.push({
                        name: 'Timed Out',
                        value: `Until <t:${Math.floor(newMember.communicationDisabledUntil.getTime() / 1000)}:F>`
                    });
                } else {
                    changes.push({ name: 'Timeout', value: 'Timeout removed' });
                }
            }

            // If no changes detected, return
            if (changes.length === 0) return;

            const embed = new EmbedBuilder()
                .setColor(COLORS.MEMBER_UPDATE)
                .setTitle('👤 Member Updated')
                .setDescription(`**${newMember.user.tag} has been updated**`)
                .addFields(
                    { name: 'User', value: `${newMember.user.tag} (${newMember.user.id})`, inline: true }
                )
                .addFields(changes)
                .setThumbnail(newMember.user.displayAvatarURL())
                .setTimestamp();

            await logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('Error logging member update:', error);
        }
    },
};
