const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('deletecustomcommand')
        .setDescription('Delete a custom command')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('The name of the custom command to delete')
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
        try {
            const name = interaction.options.getString('name').toLowerCase();

            // Check if command exists
            if (!interaction.client.customCommands.has(name)) {
                return await interaction.reply({
                    content: `Custom command "${name}" does not exist.`,
                    ephemeral: true
                });
            }

            // Remove from memory
            interaction.client.customCommands.delete(name);

            // Save to file
            try {
                const customCommandsObj = {};
                interaction.client.customCommands.forEach((value, key) => {
                    customCommandsObj[key] = value;
                });

                fs.writeFileSync('./data/customCommands.json', JSON.stringify(customCommandsObj, null, 2));

                await interaction.reply({
                    content: `Custom command "${name}" has been deleted successfully!`,
                    ephemeral: true
                });

            } catch (error) {
                console.error('Error saving after deleting custom command:', error);
                await interaction.reply({
                    content: 'Custom command was removed from memory but the file could not be updated. Changes may not persist on restart.',
                    ephemeral: true
                });
            }

        } catch (error) {
            console.error('Error in deletecustomcommand:', error);
            await interaction.reply({
                content: 'There was an error deleting the custom command.',
                ephemeral: true
            });
        }
    },
};