// Application command template.
// Add entries to applicationData to define custom multi-message prefix commands.
// Each key becomes a command name (used as `?<name>`), with a required `message1`
// and optional `message2` that sends 2 seconds later.
//
// Example:
// 'my-info': {
//     message1: `Welcome! Here is some info...`,
//     message2: `And here is a follow-up message.`
// }

const applicationData = {
    // Add your application commands here
};

module.exports = {
    applicationData,

    async handleApplicationCommand(message, commandName) {
        const data = applicationData[commandName];
        if (!data) return false;

        try {
            await message.reply(data.message1);

            if (data.message2) {
                setTimeout(async () => {
                    try {
                        await message.channel.send(data.message2);
                    } catch (error) {
                        console.error('Error sending second application message:', error);
                    }
                }, 2000);
            }

            return true;
        } catch (error) {
            console.error('Error in application command handler:', error);
            return false;
        }
    }
};
