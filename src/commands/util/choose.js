const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('choose')
        .setDescription('Randomly chooses from the given options')
        .addStringOption(option =>
            option.setName('options')
                .setDescription('Options separated by commas or spaces (e.g., "pizza, pasta, burgers" or "yes no maybe")')
                .setRequired(true)),

    name: 'choose',
    description: 'Randomly chooses from the given options',
    usage: '!choose <option1> <option2> <option3> OR !choose option1, option2, option3',

    async execute(interaction, args) {
        const isSlash = !args; // If args is undefined, it's a slash command

        try {
            let options = [];

            if (isSlash) {
                // Slash command
                const optionsString = interaction.options.getString('options');

                // Check if input contains commas (comma-separated)
                if (optionsString.includes(',')) {
                    options = optionsString.split(',').map(opt => opt.trim()).filter(opt => opt.length > 0);
                } else {
                    // Space-separated
                    options = optionsString.split(/\s+/).filter(opt => opt.length > 0);
                }

            } else {
                // Prefix command
                const msg = interaction; // interaction is actually message for prefix commands

                if (args.length === 0) {
                    return await msg.reply('Please provide options to choose from.\nUsage: `!choose option1 option2 option3` or `!choose option1, option2, option3`');
                }

                // Join all args and check if it contains commas
                const fullString = args.join(' ');

                if (fullString.includes(',')) {
                    // Comma-separated
                    options = fullString.split(',').map(opt => opt.trim()).filter(opt => opt.length > 0);
                } else {
                    // Space-separated (use original args)
                    options = args.filter(opt => opt.length > 0);
                }
            }

            // Validate that we have at least 2 options
            if (options.length < 2) {
                const errorMsg = 'Please provide at least 2 options to choose from.';
                return await (isSlash ?
                    interaction.reply({ content: errorMsg, ephemeral: true }) :
                    interaction.reply(errorMsg));
            }

            // Randomly choose an option
            const chosenOption = options[Math.floor(Math.random() * options.length)];

            // Send the response
            const response = `🎲 I choose: **${chosenOption}**`;
            await (isSlash ?
                interaction.reply(response) :
                interaction.reply(response));

        } catch (error) {
            console.error('Error in choose command:', error);
            const errorMsg = 'There was an error processing the choose command.';

            await (isSlash ?
                interaction.reply({ content: errorMsg, ephemeral: true }) :
                interaction.reply(errorMsg));
        }
    }
};
