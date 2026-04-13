const { Events } = require('discord.js');
const fs = require('fs');
const path = require('path');

const REACTION_ROLES_PATH = path.join(__dirname, '..', '..', 'data', 'reactionRoles.json');

function loadReactionRoles() {
    try {
        if (fs.existsSync(REACTION_ROLES_PATH)) {
            const data = fs.readFileSync(REACTION_ROLES_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading reaction roles:', error);
    }
    return {};
}

module.exports = {
    name: Events.MessageReactionRemove,
    async execute(reaction, user) {
        // Ignore bot reactions
        if (user.bot) return;

        // Handle partial reactions
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error('Error fetching reaction:', error);
                return;
            }
        }

        try {
            const reactionRoles = loadReactionRoles();
            const messageId = reaction.message.id;

            // Find matching reaction role
            for (const [title, data] of Object.entries(reactionRoles)) {
                if (data.messageId !== messageId) continue;

                // Check if emoji matches
                const reactionEmoji = reaction.emoji.id
                    ? `<${reaction.emoji.animated ? 'a' : ''}:${reaction.emoji.name}:${reaction.emoji.id}>`
                    : reaction.emoji.name;

                if (reactionEmoji === data.emoji || reaction.emoji.name === data.emoji || reaction.emoji.toString() === data.emoji) {
                    // Get the guild and member
                    const guild = reaction.message.guild;
                    if (!guild) return;

                    const member = await guild.members.fetch(user.id).catch(() => null);
                    if (!member) return;

                    // Get the role
                    const role = guild.roles.cache.get(data.roleId);
                    if (!role) {
                        console.error(`Role ${data.roleId} not found for reaction role "${title}"`);
                        return;
                    }

                    // Remove the role
                    try {
                        await member.roles.remove(role);
                        console.log(`Removed role "${role.name}" from ${user.tag} via reaction role "${title}"`);
                    } catch (error) {
                        console.error(`Error removing role for reaction role "${title}":`, error);
                    }

                    break;
                }
            }
        } catch (error) {
            console.error('Error in messageReactionRemove:', error);
        }
    }
};
