const { SlashCommandBuilder } = require('discord.js');
const { executeIncome } = require('../../handlers/incomeCommand');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bottle')
        .setDescription('Search the shore for a message in a bottle.'),

    async execute(interaction) {
        await executeIncome(interaction, 'bottle');
    },
};
