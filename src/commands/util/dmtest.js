// Standalone DM check - anyone runs `!dmtest` and the bot tries to DM them. Both a
// resident and their pal must run this and confirm they received the DM BEFORE Love
// Day starts, since the puzzle images are delivered by DM. Not tied to any game state.
module.exports = {
    name: 'dmtest',

    async execute(message) {
        try {
            await message.author.send(
                "💌 This is a test DM from the Everest bot! If you can read this, you're all set - " +
                'the bot can reach you, so you\'ll receive your Love Day images here.'
            );
            await message.reply('✅ I just sent you a DM! Open it to confirm you can receive Love Day images.');
        } catch {
            await message.reply(
                "❌ I couldn't DM you. Open this server's **Privacy Settings** and enable " +
                '**Direct Messages**, then run `!dmtest` again. (Both you and your partner must pass this before Love Day.)'
            );
        }
    },
};
