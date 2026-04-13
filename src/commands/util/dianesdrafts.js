module.exports = {
    name: 'dianesdrafts',
    description: 'Adds you to the Diane\'s Drafts thread',
    usage: '!dianesdrafts',

    async execute(message, args) {
        const THREAD_ID = '1466848001816531027';
// comment for fun
        try {
            const thread = await message.client.channels.fetch(THREAD_ID);

            if (!thread || !thread.isThread()) {
                console.log('Thread not found or invalid');
                return await message.reply('Could not find the thread.');
            }

            // Send ping message in the thread to add user
            const pingMessage = await thread.send(`<@${message.author.id}>`);

            // Delete the ping message
            await pingMessage.delete();

            // Reply with the cryptic message
            await message.reply(`Diane's manuscripts are notoriously personal. You've been granted temporary viewing access to her private drafts. Read carefully.\n\nhttps://discord.com/channels/${thread.guildId}/${THREAD_ID}\n\nThe answer lies in the second attempt, third thought, twelfth word spoken.\n\n-# IMPORTANT: once done in here, make sure to right click/hold down on the channel on the channel list, and click leave thread. if you do not do this, you will appear on the member list and other people who get here could find out that you have made it here.`);

            console.log(`Added ${message.author.tag} to Diane's Drafts thread`);
        } catch (error) {
            console.error('Error in dianesdrafts command:', error);
            await message.reply('An error occurred while trying to add you to the thread.');
        }
    }
};
