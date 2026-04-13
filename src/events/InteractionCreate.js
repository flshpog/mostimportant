const { Events } = require('discord.js');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        // Handle autocomplete
        if (interaction.isAutocomplete()) {
            const command = interaction.client.slashCommands.get(interaction.commandName);

            if (!command || !command.autocomplete) {
                return;
            }

            try {
                await command.autocomplete(interaction);
            } catch (error) {
                console.error('Error handling autocomplete:', error);
            }
            return;
        }

        // Handle slash commands
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.slashCommands.get(interaction.commandName);

            if (!command) {
                console.error(`No command matching ${interaction.commandName} was found.`);
                return;
            }

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error('Error executing slash command:', error);
                const reply = { 
                    content: 'There was an error while executing this command!', 
                    ephemeral: true 
                };
                
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(reply);
                } else {
                    await interaction.reply(reply);
                }
            }
        }

        // Handle button interactions
        else if (interaction.isButton()) {
            if (interaction.customId === 'create_ticket') {
                // Handle ticket creation
                const ticketCommand = interaction.client.slashCommands.get('ticket-setup');
                if (ticketCommand && ticketCommand.handleButton) {
                    try {
                        await ticketCommand.handleButton(interaction);
                    } catch (error) {
                        console.error('Error handling ticket button:', error);
                        await interaction.reply({
                            content: 'There was an error creating your ticket. Please try again later.',
                            ephemeral: true
                        });
                    }
                }
            }
            
            // Handle Stop Rocks button
            else if (interaction.customId.startsWith('stop_rocks_')) {
                try {
                    const userId = interaction.customId.split('_')[2];
                    
                    // Check if the user clicking is the same user who started rocks
                    if (interaction.user.id !== userId) {
                        return await interaction.reply({
                            content: 'Only the person who started the rock draw can stop it.',
                            ephemeral: true
                        });
                    }

                    // Stop the rocks game
                    if (interaction.client.rocksGames) {
                        interaction.client.rocksGames.set(userId, { active: false });
                    }

                    // Update the message to show it was stopped
                    await interaction.update({
                        content: interaction.message.content + '\n\n⏹️ **Rock draw stopped by ' + interaction.user.username + '**',
                        components: [] // Remove the stop button
                    });

                } catch (error) {
                    console.error('Error handling stop rocks button:', error);
                    await interaction.reply({
                        content: 'There was an error stopping the rock draw.',
                        ephemeral: true
                    });
                }
            }
        }

        // Handle modal submissions
        else if (interaction.isModalSubmit()) {
            if (interaction.customId === 'addCustomCommandModal') {
                const command = interaction.client.slashCommands.get('addcustomcommand');
                if (command && command.handleModalSubmit) {
                    try {
                        await command.handleModalSubmit(interaction);
                    } catch (error) {
                        console.error('Error handling modal submit:', error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({
                                content: 'There was an error processing your submission.',
                                ephemeral: true
                            });
                        }
                    }
                }
            }
            else if (interaction.customId.startsWith('editCustomCommandModal_')) {
                const oldName = interaction.customId.replace('editCustomCommandModal_', '');
                const command = interaction.client.slashCommands.get('editcustomcommand');
                if (command && command.handleModalSubmit) {
                    try {
                        await command.handleModalSubmit(interaction, oldName);
                    } catch (error) {
                        console.error('Error handling edit modal submit:', error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({
                                content: 'There was an error processing your edit.',
                                ephemeral: true
                            });
                        }
                    }
                }
            }
        }
    },
};