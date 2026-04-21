const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

// CONFIG - Update these IDs for your server
const CONFIG = {
    APPLY_HERE_CHANNEL_ID: "1414336443660107857",
    TICKETS_CATEGORY_ID: "1496235029800681555",
    STAFF_ROLE_ID: "1414321682415357962",
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ticket-setup')
        .setDescription('Set up the ticket system with embed and button')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    
    async execute(interaction) {
        try {
            const applyChannel = interaction.guild.channels.cache.get(CONFIG.APPLY_HERE_CHANNEL_ID);
            
            if (!applyChannel) {
                return await interaction.reply({
                    content: 'Apply channel not found. Please update APPLY_HERE_CHANNEL_ID in ticket-setup.js',
                    ephemeral: true
                });
            }

            const embed = new EmbedBuilder()
                .setTitle('🎫 Create a Ticket')
                .setDescription('Click the button below if you wish to apply for Everest Hub!')
                .setColor(0x5865F2)
                .setFooter({ text: 'Everest Hub Applications' })
                .setTimestamp();

            const button = new ButtonBuilder()
                .setCustomId('create_ticket')
                .setLabel('Create Ticket')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🎫');

            const row = new ActionRowBuilder().addComponents(button);

            await applyChannel.send({
                embeds: [embed],
                components: [row]
            });

            await interaction.reply({
                content: 'Ticket system has been set up successfully!',
                ephemeral: true
            });

        } catch (error) {
            console.error('Error setting up ticket system:', error);
            await interaction.reply({
                content: 'There was an error setting up the ticket system.',
                ephemeral: true
            });
        }
    },

    async handleButton(interaction) {
        try {
            const category = interaction.guild.channels.cache.get(CONFIG.TICKETS_CATEGORY_ID);
            
            if (!category) {
                return await interaction.reply({
                    content: 'Tickets category not found. Please contact <@932329766063837246>.',
                    ephemeral: true
                });
            }

            // Check if user already has a ticket
            const existingTicket = interaction.guild.channels.cache.find(
                channel => channel.name === `ticket-${interaction.user.username.toLowerCase()}` &&
                          channel.parent?.id === CONFIG.TICKETS_CATEGORY_ID
            );

            if (existingTicket) {
                return await interaction.reply({
                    content: `You already have an open ticket: ${existingTicket}`,
                    ephemeral: true
                });
            }

            const staffRole = interaction.guild.roles.cache.get(CONFIG.STAFF_ROLE_ID);

            // Create ticket channel
            const ticketChannel = await interaction.guild.channels.create({
                name: `ticket-${interaction.user.username.toLowerCase()}`,
                type: ChannelType.GuildText,
                parent: category,
                permissionOverwrites: [
                    {
                        id: interaction.guild.id,
                        deny: [PermissionFlagsBits.ViewChannel],
                    },
                    {
                        id: interaction.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory
                        ],
                    },
                    ...(staffRole ? [{
                        id: staffRole.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.ManageChannels
                        ],
                    }] : [])
                ],
            });

            // Send welcome message in ticket
            const welcomeEmbed = new EmbedBuilder()
                .setTitle('🎫 Ticket Created')
                .setDescription(`Hello ${interaction.user}! Welcome to your application!\n\nTo get started, run \`?app-start\`.`)
                .setColor(0x00FF00)
                .addFields(
                    { name: '📋 Ticket Information', value: `**User:** ${interaction.user.tag}\n**Channel:** ${ticketChannel}\n**Created:** <t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
                )
                .setFooter({ text: 'To close this ticket, contact a staff member' })
                .setTimestamp();

            await ticketChannel.send({
                content: `${interaction.user}`,
                embeds: [welcomeEmbed]
            });

            await interaction.reply({
                content: `Ticket created: ${ticketChannel}`,
                ephemeral: true
            });

        } catch (error) {
            console.error('Error creating ticket:', error);
            await interaction.reply({
                content: 'There was an error creating your ticket. Please try again later.',
                ephemeral: true
            });
        }
    }
};