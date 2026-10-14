// The Season 3 board is written in TypeScript (packages/). Requiring this module
// first lets the bot load those packages directly, with no build step.
require('tsx/cjs');

module.exports = {
    server: () => require('@everest/server'),
    discord: () => require('@everest/discord'),
    boardData: () => require('@everest/board-data'),
};
