const applicationData = {
    'app-start': {
        message1: `To get started, give us your basic information to keep track of throughout the season!

> - Age
> - Timezone
> - Pronouns

To move onto the next question, say \`?app-2\``,
        message2: `https://tenor.com/view/james-james-hurley-hurley-twin-peaks-david-lynch-gif-11288087606734761187`
    },

    'app-2': {
        message1: `If possible, give us **five** photos to use for custom banners and the spreadsheet! Additionally, give us a color **hex code** to represent you!

To move onto the next question, say \`?app-3\``,
        message2: `https://tenor.com/view/ben-horne-benjamin-horne-twin-peaks-griddy-dance-gif-8435781383529448770`
    },

    'app-3': {
        message1: `Give a brief summary of your prior **ORG** experience and knowledge about **Survivor**! If this is your first **ORG**, enlighten us with what made you want to apply!

To move onto the next question, say \`?app-4\``,
        message2: `https://tenor.com/view/twin-peaks-horse-reverse-meme-twin-gif-14001485492006164695`
    },

    'app-4': {
        message1: `Let's get to know you a little better. What is your **outlook** on life, and what **motivates** you to keep going?

To move onto the next question, say \`?app-5\``,
        message2: `https://tenor.com/view/dale-cooper-twin-peaks-dale-cooper-like-%D0%B4%D0%B5%D0%B9%D0%BB-%D0%BA%D1%83%D0%BF%D0%B5%D1%80-%D0%BB%D0%B0%D0%B9%D0%BA-gif-2081521185677286158`
    },

    'app-5': {
        message1: `This one's simple. Give us **three** fun facts about you!

To move onto the next question, say \`?app-6\``,
        message2: `https://tenor.com/view/kyle-gif-9584846`
    },

    'app-6': {
        message1: `Final question, make this one count! Why should we **cast** you, and why will you **win**?

To finish your application, say \`?app-done\``,
        message2: `https://klipy.com/gifs/twin-peaks-thumbs-up-8Vp`
    },

    'app-done': {
        message1: `Thank you for taking time to apply! EIther ping Producers or don't, it's up to you. Just kidding I'm going to. <@1414321682415357962> HIIIIIIIIIIII`,
        message2: `https://tenor.com/view/twin-peaks-fire-walk-with-gif-9672236`
    },
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
