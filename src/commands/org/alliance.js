const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { spectatorRole } = require('../../config/org');
const { parseRoleIds } = require('../../handlers/roles');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('alliance')
        .setDescription('Create a private alliance channel')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Type of channel')
                .setRequired(true)
                .addChoices(
                    { name: '1-1', value: '1on1' },
                    { name: 'Alliance', value: 'alliance' }
                ))
        .addChannelOption(option =>
            option.setName('category')
                .setDescription('The category to create the alliance channel in')
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(true))
        .addStringOption(option =>
            option.setName('roles')
                .setDescription('Space-separated role IDs or mentions for alliance members')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('requested')
                .setDescription('Who requested this alliance (only applies to alliances, not 1-1s)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        try {
            const type = interaction.options.getString('type');
            const category = interaction.options.getChannel('category');
            const rolesInput = interaction.options.getString('roles');
            const requestedBy = interaction.options.getString('requested');

            // Validate category
            if (category.type !== ChannelType.GuildCategory) {
                return await interaction.reply({
                    content: 'Please select a valid category channel.',
                    ephemeral: true
                });
            }

            // Parse roles from input
            const roleIds = this.parseRoles(rolesInput);
            if (roleIds.length === 0) {
                return await interaction.reply({
                    content: 'Please provide valid role IDs or mentions. Example: `@Role1 @Role2` or `123456789 987654321`',
                    ephemeral: true
                });
            }

            // Validate roles exist
            const validRoles = [];
            const invalidRoles = [];

            for (const roleId of roleIds) {
                const role = interaction.guild.roles.cache.get(roleId);
                if (role) {
                    validRoles.push(role);
                } else {
                    invalidRoles.push(roleId);
                }
            }

            if (validRoles.length === 0) {
                return await interaction.reply({
                    content: 'None of the provided roles were found in this server.',
                    ephemeral: true
                });
            }

            // Sort members alphabetically so the channel name is consistent no matter
            // what order the roles were given in.
            validRoles.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

            // Create channel name based on role names
            const channelName = validRoles.map(r => r.name.toLowerCase().replace(/[^a-z0-9]/g, '-')).join('-');

            // Check if alliance already exists
            const existingChannel = category.children.cache.find(
                channel => channel.name === channelName
            );

            if (existingChannel) {
                const channelTypeLabel = type === '1on1' ? '1-on-1' : 'alliance';
                return await interaction.reply({
                    content: `A ${channelTypeLabel} channel with the name "${channelName}" already exists in this category.`,
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            // Create permission overwrites
            const permissionOverwrites = [
                {
                    id: interaction.guild.id, // @everyone
                    deny: [PermissionFlagsBits.ViewChannel],
                }
            ];

            // Add permissions for each valid role
            validRoles.forEach(role => {
                permissionOverwrites.push({
                    id: role.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.UseExternalEmojis,
                        PermissionFlagsBits.AddReactions
                    ],
                });
            });

            // Spectators can view alliances only, NOT 1-1s, and never speak. Configured
            // per server in config/org.json; skipped entirely in servers without one.
            const spectator = spectatorRole(interaction.guild);
            if (spectator) {
                permissionOverwrites.push(type === 'alliance'
                    ? {
                        id: spectator.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                        deny: [PermissionFlagsBits.SendMessages]
                    }
                    : {
                        id: spectator.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    });
            }

            // Create the channel
            const channelTypeLabel = type === '1on1' ? '1-on-1' : 'alliance';
            const allianceChannel = await interaction.guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: category,
                permissionOverwrites: permissionOverwrites,
                topic: validRoles.map(r => r.name).join(', ')
            });

            const channelType = type === '1on1' ? '1-on-1' : 'alliance';

            // Send welcome message in the channel
            let welcomeMessage = `🤝 **Welcome!**\n\n` +
                `This is a private ${channelType} for:\n` +
                `${validRoles.map(role => `• ${role}`).join('\n')}`;

            // Only add "requested by" for alliances if the requested field is filled
            if (type === 'alliance' && requestedBy) {
                welcomeMessage += `\n\nThis alliance was requested by **${requestedBy}**`;
            }

            await allianceChannel.send(welcomeMessage);

            let responseMessage = `✅ ${channelType.charAt(0).toUpperCase() + channelType.slice(1)} channel created: ${allianceChannel}\n\n` +
                                 `**Type:** ${channelType}\n` +
                                 `**Roles with access:** ${validRoles.map(r => r.name).join(', ')}`;

            if (invalidRoles.length > 0) {
                responseMessage += `\n\n⚠️ **Warning:** The following role IDs were not found and were skipped:\n${invalidRoles.join(', ')}`;
            }

            await interaction.editReply(responseMessage);

        } catch (error) {
            console.error('Error creating alliance:', error);
            const errorMessage = 'There was an error creating the alliance channel.';
            
            if (interaction.deferred) {
                await interaction.editReply(errorMessage);
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    },

    // Shared with /tribe1on1s — see src/handlers/roles.js.
    parseRoles(input) {
        return parseRoleIds(input);
    }
};