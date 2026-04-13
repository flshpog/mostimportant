const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');

// CONFIG - Update this with your role ID
const CONFIG = {
    DEFAULT_AUTOROLE_ID: "1414011563895164990", // Your specified role ID
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autorole')
        .setDescription('Manage the autorole system')
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Set the autorole for new members')
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('The role to automatically assign to new members')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove the autorole (disable autorole system)'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Check the current autorole status'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('test')
                .setDescription('Test the autorole on yourself'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case 'set':
                    await this.handleSet(interaction);
                    break;
                case 'remove':
                    await this.handleRemove(interaction);
                    break;
                case 'status':
                    await this.handleStatus(interaction);
                    break;
                case 'test':
                    await this.handleTest(interaction);
                    break;
                default:
                    await interaction.reply({
                        content: 'Invalid subcommand.',
                        ephemeral: true
                    });
            }
        } catch (error) {
            console.error('Error in autorole command:', error);
            const errorMessage = 'There was an error with the autorole command.';
            
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: errorMessage, ephemeral: true });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    },

    async handleSet(interaction) {
        const role = interaction.options.getRole('role');

        // Check if bot can manage this role
        const botMember = interaction.guild.members.cache.get(interaction.client.user.id);
        if (role.position >= botMember.roles.highest.position) {
            return await interaction.reply({
                content: `I cannot assign the role **${role.name}** because it's higher than or equal to my highest role. Please move my role above this role in the server settings.`,
                ephemeral: true
            });
        }

        // Check if role is @everyone
        if (role.id === interaction.guild.id) {
            return await interaction.reply({
                content: 'You cannot set @everyone as the autorole.',
                ephemeral: true
            });
        }

        // Save autorole setting
        const autoroleData = {
            guildId: interaction.guild.id,
            roleId: role.id,
            roleName: role.name,
            setBy: interaction.user.id,
            setAt: Date.now()
        };

        try {
            // Ensure data directory exists
            if (!fs.existsSync('./data')) {
                fs.mkdirSync('./data');
            }

            // Load existing autorole settings
            let autoroleSettings = {};
            try {
                const data = fs.readFileSync('./data/autoroles.json', 'utf8');
                autoroleSettings = JSON.parse(data);
            } catch (error) {
                // File doesn't exist, start fresh
                autoroleSettings = {};
            }

            // Update settings for this guild
            autoroleSettings[interaction.guild.id] = autoroleData;

            // Save to file
            fs.writeFileSync('./data/autoroles.json', JSON.stringify(autoroleSettings, null, 2));

            const embed = new EmbedBuilder()
                .setTitle('✅ Autorole Set Successfully')
                .setColor(0x00FF00)
                .setDescription(`New members will now automatically receive the **${role.name}** role when they join the server.`)
                .addFields(
                    {
                        name: '🎭 Role',
                        value: `${role} (${role.name})`,
                        inline: true
                    },
                    {
                        name: '🆔 Role ID',
                        value: `\`${role.id}\``,
                        inline: true
                    },
                    {
                        name: '👤 Set By',
                        value: `${interaction.user}`,
                        inline: true
                    }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error saving autorole settings:', error);
            await interaction.reply({
                content: 'Autorole was set but could not be saved to file. It may not persist after restart.',
                ephemeral: true
            });
        }
    },

    async handleRemove(interaction) {
        try {
            // Load existing autorole settings
            let autoroleSettings = {};
            try {
                const data = fs.readFileSync('./data/autoroles.json', 'utf8');
                autoroleSettings = JSON.parse(data);
            } catch (error) {
                return await interaction.reply({
                    content: 'No autorole is currently set for this server.',
                    ephemeral: true
                });
            }

            // Check if autorole is set for this guild
            if (!autoroleSettings[interaction.guild.id]) {
                return await interaction.reply({
                    content: 'No autorole is currently set for this server.',
                    ephemeral: true
                });
            }

            const oldRole = autoroleSettings[interaction.guild.id];

            // Remove from settings
            delete autoroleSettings[interaction.guild.id];

            // Save updated settings
            fs.writeFileSync('./data/autoroles.json', JSON.stringify(autoroleSettings, null, 2));

            const embed = new EmbedBuilder()
                .setTitle('🗑️ Autorole Removed')
                .setColor(0xFF0000)
                .setDescription('The autorole system has been disabled for this server.')
                .addFields(
                    {
                        name: '🎭 Previous Role',
                        value: `${oldRole.roleName} (\`${oldRole.roleId}\`)`,
                        inline: true
                    },
                    {
                        name: '👤 Removed By',
                        value: `${interaction.user}`,
                        inline: true
                    }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error removing autorole:', error);
            await interaction.reply({
                content: 'There was an error removing the autorole settings.',
                ephemeral: true
            });
        }
    },

    async handleStatus(interaction) {
        try {
            // Load autorole settings
            let autoroleSettings = {};
            try {
                const data = fs.readFileSync('./data/autoroles.json', 'utf8');
                autoroleSettings = JSON.parse(data);
            } catch (error) {
                // No settings file
            }

            const guildSettings = autoroleSettings[interaction.guild.id];

            if (!guildSettings) {
                return await interaction.reply({
                    content: '❌ No autorole is currently set for this server.',
                    ephemeral: true
                });
            }

            // Check if role still exists
            const role = interaction.guild.roles.cache.get(guildSettings.roleId);
            const roleExists = role ? '✅ Role exists' : '❌ Role not found (may have been deleted)';

            const embed = new EmbedBuilder()
                .setTitle('📋 Autorole Status')
                .setColor(role ? 0x5865F2 : 0xFF0000)
                .addFields(
                    {
                        name: '🎭 Current Autorole',
                        value: role ? `${role} (${role.name})` : `${guildSettings.roleName} (ID: ${guildSettings.roleId})`,
                        inline: false
                    },
                    {
                        name: '🔍 Status',
                        value: roleExists,
                        inline: true
                    },
                    {
                        name: '📅 Set Date',
                        value: `<t:${Math.floor(guildSettings.setAt / 1000)}:F>`,
                        inline: true
                    },
                    {
                        name: '👤 Set By',
                        value: `<@${guildSettings.setBy}>`,
                        inline: true
                    }
                )
                .setTimestamp();

            if (!role) {
                embed.setDescription('⚠️ **Warning:** The autorole is set but the role no longer exists. Please set a new autorole or remove the current setting.');
            }

            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error checking autorole status:', error);
            await interaction.reply({
                content: 'There was an error checking the autorole status.',
                ephemeral: true
            });
        }
    },

    async handleTest(interaction) {
        try {
            // Load autorole settings
            let autoroleSettings = {};
            try {
                const data = fs.readFileSync('./data/autoroles.json', 'utf8');
                autoroleSettings = JSON.parse(data);
            } catch (error) {
                return await interaction.reply({
                    content: 'No autorole is currently set for this server.',
                    ephemeral: true
                });
            }

            const guildSettings = autoroleSettings[interaction.guild.id];
            if (!guildSettings) {
                return await interaction.reply({
                    content: 'No autorole is currently set for this server.',
                    ephemeral: true
                });
            }

            // Get the role
            const role = interaction.guild.roles.cache.get(guildSettings.roleId);
            if (!role) {
                return await interaction.reply({
                    content: 'The autorole is set but the role no longer exists. Please set a new autorole.',
                    ephemeral: true
                });
            }

            // Check if user already has the role
            if (interaction.member.roles.cache.has(role.id)) {
                return await interaction.reply({
                    content: `You already have the **${role.name}** role!`,
                    ephemeral: true
                });
            }

            // Add the role
            await interaction.member.roles.add(role, 'Autorole test command');

            await interaction.reply({
                content: `✅ Successfully added the **${role.name}** role to you as a test!`,
                ephemeral: true
            });

        } catch (error) {
            console.error('Error testing autorole:', error);
            await interaction.reply({
                content: 'There was an error testing the autorole. Please check bot permissions.',
                ephemeral: true
            });
        }
    },

    // Helper function for the member join event
    getAutorole: async function(guildId) {
        try {
            const data = fs.readFileSync('./data/autoroles.json', 'utf8');
            const autoroleSettings = JSON.parse(data);
            return autoroleSettings[guildId] || null;
        } catch (error) {
            // If default role is specified, return it
            if (CONFIG.DEFAULT_AUTOROLE_ID) {
                return {
                    roleId: CONFIG.DEFAULT_AUTOROLE_ID,
                    roleName: 'Default Role'
                };
            }
            return null;
        }
    }
};