const board = require('../../handlers/boardTs');

module.exports = {
    data: board.discord().buildRollCommand(),

    async execute(interaction) {
        const bridge = interaction.client.boardDiscord;
        if (!bridge) {
            return interaction.reply({ content: "The board isn't running right now. Try again in a bit.", ephemeral: true });
        }
        await bridge.handleRoll(interaction);
    },
};
