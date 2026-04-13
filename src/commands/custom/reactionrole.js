const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const REACTION_ROLES_PATH = path.join(__dirname, '..', '..', '..', 'data', 'reactionRoles.json');

// Helper to load reaction roles
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

// Helper to save reaction roles
function saveReactionRoles(data) {
    try {
        fs.writeFileSync(REACTION_ROLES_PATH, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving reaction roles:', error);
        throw error;
    }
}

// Parse message link to extract guild, channel, and message IDs
function parseMessageLink(link) {
    const regex = /discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/;
    const match = link.match(regex);
    if (match) {
        return {
            guildId: match[1],
            channelId: match[2],
            messageId: match[3]
        };
    }
    return null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reactionrole')
        .setDescription('Manage reaction roles')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a new reaction role')
                .addStringOption(option =>
                    option.setName('title')
                        .setDescription('A unique name/title for this reaction role')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('message_link')
                        .setDescription('The message link to add the reaction to')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('emoji')
                        .setDescription('The emoji to use for the reaction')
                        .setRequired(true))
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('The role to give when reacting')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all reaction roles'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a reaction role')
                .addStringOption(option =>
                    option.setName('title')
                        .setDescription('The title of the reaction role to remove')
                        .setRequired(true)
                        .setAutocomplete(true)))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    // Handle autocomplete for remove subcommand
    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused();
        const reactionRoles = loadReactionRoles();

        const choices = Object.keys(reactionRoles)
            .filter(title => title.toLowerCase().includes(focusedValue.toLowerCase()))
            .slice(0, 25);

        await interaction.respond(
            choices.map(title => ({ name: title, value: title }))
        );
    },

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'add') {
            await this.handleAdd(interaction);
        } else if (subcommand === 'list') {
            await this.handleList(interaction);
        } else if (subcommand === 'remove') {
            await this.handleRemove(interaction);
        }
    },

    async handleAdd(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const title = interaction.options.getString('title');
            const messageLink = interaction.options.getString('message_link');
            const emojiInput = interaction.options.getString('emoji');
            const role = interaction.options.getRole('role');

            // Check if title already exists
            const reactionRoles = loadReactionRoles();
            if (reactionRoles[title]) {
                return await interaction.editReply(`A reaction role with the title "${title}" already exists. Please use a different title.`);
            }

            // Parse message link
            const linkData = parseMessageLink(messageLink);
            if (!linkData) {
                return await interaction.editReply('Invalid message link. Please provide a valid Discord message link.');
            }

            // Verify the message exists and is in this guild
            if (linkData.guildId !== interaction.guild.id) {
                return await interaction.editReply('The message must be in this server.');
            }

            // Get the channel and message
            const channel = await interaction.guild.channels.fetch(linkData.channelId).catch(() => null);
            if (!channel) {
                return await interaction.editReply('Could not find the channel. Make sure the bot has access to it.');
            }

            const message = await channel.messages.fetch(linkData.messageId).catch(() => null);
            if (!message) {
                return await interaction.editReply('Could not find the message. Make sure it exists and the bot has access to the channel.');
            }

            // Try to add the reaction
            try {
                await message.react(emojiInput);
            } catch (error) {
                return await interaction.editReply(`Could not add reaction. Make sure the emoji "${emojiInput}" is valid and the bot can use it.`);
            }

            // Save the reaction role
            reactionRoles[title] = {
                messageId: linkData.messageId,
                channelId: linkData.channelId,
                guildId: linkData.guildId,
                emoji: emojiInput,
                roleId: role.id,
                roleName: role.name,
                createdBy: interaction.user.id,
                createdAt: new Date().toISOString()
            };

            saveReactionRoles(reactionRoles);

            // Update client collection if it exists
            if (interaction.client.reactionRoles) {
                interaction.client.reactionRoles.set(title, reactionRoles[title]);
            }

            await interaction.editReply(`Reaction role **${title}** created!\n\nEmoji: ${emojiInput}\nRole: ${role}\nMessage: ${messageLink}`);

        } catch (error) {
            console.error('Error adding reaction role:', error);
            await interaction.editReply('There was an error creating the reaction role.');
        }
    },

    async handleList(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const reactionRoles = loadReactionRoles();
            const entries = Object.entries(reactionRoles);

            if (entries.length === 0) {
                return await interaction.editReply('No reaction roles have been set up yet.');
            }

            const embed = new EmbedBuilder()
                .setTitle('Reaction Roles')
                .setColor(0x5865F2)
                .setTimestamp();

            let description = '';
            for (const [title, data] of entries) {
                const role = interaction.guild.roles.cache.get(data.roleId);
                const roleName = role ? role.name : data.roleName + ' (deleted)';
                const messageLink = `https://discord.com/channels/${data.guildId}/${data.channelId}/${data.messageId}`;

                description += `**${title}**\n`;
                description += `${data.emoji} - ${roleName}\n`;
                description += `[Message Link](${messageLink})\n\n`;
            }

            // Handle long descriptions by splitting
            if (description.length > 4096) {
                description = description.substring(0, 4090) + '...';
            }

            embed.setDescription(description);
            embed.setFooter({ text: `Total: ${entries.length} reaction role(s)` });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error listing reaction roles:', error);
            await interaction.editReply('There was an error listing reaction roles.');
        }
    },

    async handleRemove(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const title = interaction.options.getString('title');
            const reactionRoles = loadReactionRoles();

            if (!reactionRoles[title]) {
                return await interaction.editReply(`No reaction role found with the title "${title}".`);
            }

            const data = reactionRoles[title];

            // Try to remove the bot's reaction from the message
            try {
                const channel = await interaction.guild.channels.fetch(data.channelId).catch(() => null);
                if (channel) {
                    const message = await channel.messages.fetch(data.messageId).catch(() => null);
                    if (message) {
                        // Find and remove the bot's reaction
                        const reaction = message.reactions.cache.find(r =>
                            r.emoji.name === data.emoji ||
                            r.emoji.toString() === data.emoji ||
                            `<:${r.emoji.name}:${r.emoji.id}>` === data.emoji ||
                            `<a:${r.emoji.name}:${r.emoji.id}>` === data.emoji
                        );
                        if (reaction) {
                            await reaction.users.remove(interaction.client.user.id);
                        }
                    }
                }
            } catch (error) {
                console.error('Error removing reaction:', error);
                // Continue even if reaction removal fails
            }

            // Remove from storage
            delete reactionRoles[title];
            saveReactionRoles(reactionRoles);

            // Update client collection if it exists
            if (interaction.client.reactionRoles) {
                interaction.client.reactionRoles.delete(title);
            }

            await interaction.editReply(`Reaction role **${title}** has been removed.`);

        } catch (error) {
            console.error('Error removing reaction role:', error);
            await interaction.editReply('There was an error removing the reaction role.');
        }
    }
};
