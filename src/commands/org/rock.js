const { SlashCommandBuilder } = require('discord.js');
const { executeIncome } = require('../../handlers/incomeCommand');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rock')
        .setDescription('Whack the rocks for bells.'),

    async execute(interaction) {
        await executeIncome(interaction, 'rock');
    },
};
