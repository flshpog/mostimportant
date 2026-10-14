const board = require('../../handlers/boardTs');

// /board ... host tools for the Season 3 board. Board choices come from
// packages/board-data/season-config.json when the bot starts.
module.exports = {
    data: board.discord().buildBoardCommand(board.boardData().loadSeasonConfig()),

    async execute(interaction) {
        const bridge = interaction.client.boardDiscord;
        if (!bridge) {
            return interaction.reply({ content: "The board isn't running right now. Check the bot's console.", ephemeral: true });
        }
        await bridge.handleHostCommand(interaction);
    },

    async autocomplete(interaction) {
        const bridge = interaction.client.boardDiscord;
        if (bridge) await bridge.autocomplete(interaction);
        else await interaction.respond([]);
    },
};
