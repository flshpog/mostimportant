const { SlashCommandBuilder, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const fs = require('fs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('editcustomcommand')
        .setDescription('Edit an existing custom command')
        .addStringOption(option =>
            option.setName('command')
                .setDescription('The custom command to edit')
                .setRequired(true)
                .setAutocomplete(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async autocomplete(interaction) {
        const focusedValue = interaction.options.getFocused();
        const commands = Array.from(interaction.client.customCommands.keys());
        const filtered = commands.filter(command =>
            command.toLowerCase().includes(focusedValue.toLowerCase())
        ).slice(0, 25);

        await interaction.respond(
            filtered.map(command => ({ name: command, value: command }))
        );
    },

    async execute(interaction) {
        const name = interaction.options.getString('command').toLowerCase();

        // Check if command exists
        if (!interaction.client.customCommands.has(name)) {
            return await interaction.reply({
                content: `Custom command "${name}" does not exist.`,
                ephemeral: true
            });
        }

        const currentResponse = interaction.client.customCommands.get(name);

        // Create the modal
        const modal = new ModalBuilder()
            .setCustomId(`editCustomCommandModal_${name}`)
            .setTitle('Edit Custom Command');

        const nameInput = new TextInputBuilder()
            .setCustomId('commandName')
            .setLabel('Command Name')
            .setStyle(TextInputStyle.Short)
            .setValue(name)
            .setRequired(true);

        const responseInput = new TextInputBuilder()
            .setCustomId('commandResponse')
            .setLabel('Command Response')
            .setStyle(TextInputStyle.Paragraph)
            .setValue(currentResponse)
            .setRequired(true);

        const nameRow = new ActionRowBuilder().addComponents(nameInput);
        const responseRow = new ActionRowBuilder().addComponents(responseInput);

        modal.addComponents(nameRow, responseRow);

        await interaction.showModal(modal);
    },

    async handleModalSubmit(interaction, oldName) {
        try {
            const newName = interaction.fields.getTextInputValue('commandName').toLowerCase();
            const newResponse = interaction.fields.getTextInputValue('commandResponse');

            // Validate new name
            if (!/^[a-z0-9_-]+$/i.test(newName)) {
                return await interaction.reply({
                    content: 'Command name can only contain letters, numbers, underscores, and dashes.',
                    ephemeral: true
                });
            }

            // If name changed, check for conflicts
            if (newName !== oldName) {
                if (interaction.client.customCommands.has(newName)) {
                    return await interaction.reply({
                        content: `Custom command "${newName}" already exists. Choose a different name.`,
                        ephemeral: true
                    });
                }

                if (interaction.client.commands.has(newName) || interaction.client.slashCommands.has(newName)) {
                    return await interaction.reply({
                        content: `Cannot rename to "${newName}" as it conflicts with an existing bot command.`,
                        ephemeral: true
                    });
                }

                // Remove old entry
                interaction.client.customCommands.delete(oldName);
            }

            // Set the (possibly renamed) command
            interaction.client.customCommands.set(newName, newResponse);

            // Save to file
            try {
                const customCommandsObj = {};
                interaction.client.customCommands.forEach((value, key) => {
                    customCommandsObj[key] = value;
                });

                fs.writeFileSync('./data/customCommands.json', JSON.stringify(customCommandsObj, null, 2));

                let replyMessage = `Custom command "${newName}" has been updated successfully!`;
                if (newName !== oldName) {
                    replyMessage = `Custom command renamed from "${oldName}" to "${newName}" and updated!`;
                }

                await interaction.reply({
                    content: replyMessage,
                    ephemeral: true
                });

            } catch (error) {
                console.error('Error saving edited custom command:', error);
                await interaction.reply({
                    content: 'Custom command was updated in memory but could not be saved to file. It may revert on restart.',
                    ephemeral: true
                });
            }

        } catch (error) {
            console.error('Error in editcustomcommand modal submit:', error);

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: 'There was an error editing the custom command.',
                    ephemeral: true
                });
            }
        }
    },
};
