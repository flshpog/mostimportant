const { SlashCommandBuilder } = require('discord.js');
const { executeIncome } = require('../../handlers/incomeCommand');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tree')
        .setDescription('Shake a tree for bells... watch out for wasps.'),

    async execute(interaction) {
        await executeIncome(interaction, 'tree');
    },
};
