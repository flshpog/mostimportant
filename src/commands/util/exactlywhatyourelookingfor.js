const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    // Discord requires a non-empty (1–100 char) description for slash commands,
    // so this is the most minimal valid value.
    data: new SlashCommandBuilder()
        .setName('exactlywhatyourelookingfor')
        .setDescription('.'),

    async execute(interaction) {
        await interaction.reply({ content: '🔑', ephemeral: true });
    },
};
