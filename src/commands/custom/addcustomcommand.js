const { SlashCommandBuilder, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const fs = require('fs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addcustomcommand')
        .setDescription('Add a custom command')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        // Create the modal
        const modal = new ModalBuilder()
            .setCustomId('addCustomCommandModal')
            .setTitle('Add Custom Command');

        // Create text inputs
        const nameInput = new TextInputBuilder()
            .setCustomId('commandName')
            .setLabel('Command Name')
            .setPlaceholder('Enter the command name (e.g., hello)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const responseInput = new TextInputBuilder()
            .setCustomId('commandResponse')
            .setLabel('Command Response')
            .setPlaceholder('Enter what the command should say')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        // Add inputs to action rows
        const nameRow = new ActionRowBuilder().addComponents(nameInput);
        const responseRow = new ActionRowBuilder().addComponents(responseInput);

        // Add rows to the modal
        modal.addComponents(nameRow, responseRow);

        // Show the modal
        await interaction.showModal(modal);
    },

    async handleModalSubmit(interaction) {
        try {
            const name = interaction.fields.getTextInputValue('commandName').toLowerCase();
            const response = interaction.fields.getTextInputValue('commandResponse');

            // Check if command name contains invalid characters
            if (!/^[a-z0-9_-]+$/i.test(name)) {
                return await interaction.reply({
                    content: 'Command name can only contain letters, numbers, underscores, and dashes.',
                    ephemeral: true
                });
            }

            // Check if command already exists
            if (interaction.client.customCommands.has(name)) {
                return await interaction.reply({
                    content: `Custom command "${name}" already exists!`,
                    ephemeral: true
                });
            }

            // Check if command conflicts with existing bot commands
            if (interaction.client.commands.has(name) || interaction.client.slashCommands.has(name)) {
                return await interaction.reply({
                    content: `Cannot create custom command "${name}" as it conflicts with an existing bot command.`,
                    ephemeral: true
                });
            }

            // Add to memory
            interaction.client.customCommands.set(name, response);

            // Save to file
            try {
                const customCommandsObj = {};
                interaction.client.customCommands.forEach((value, key) => {
                    customCommandsObj[key] = value;
                });

                fs.writeFileSync('./data/customCommands.json', JSON.stringify(customCommandsObj, null, 2));

                await interaction.reply({
                    content: `Custom command "${name}" has been added successfully!\nUsers can now use \`!${name}\` to trigger it.`,
                    ephemeral: true
                });

            } catch (error) {
                console.error('Error saving custom command:', error);
                await interaction.reply({
                    content: 'Custom command was added to memory but could not be saved to file. It will be lost on restart.',
                    ephemeral: true
                });
            }

        } catch (error) {
            console.error('Error in addcustomcommand modal submit:', error);

            // Check if we haven't replied yet
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: 'There was an error adding the custom command.',
                    ephemeral: true
                });
            }
        }
    },
};