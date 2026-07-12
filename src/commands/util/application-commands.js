const { sendAsCharacter } = require('../../handlers/characterWebhook');

// ---------------------------------------------------------------------------
// Season interview flow (Animal Crossing).
//
// Each value below is a Discohook-style payload — paste the JSON you design
// directly as the value: { username, avatar_url, embeds: [ { title,
// description, image: { url } } ] }. Embeds default to leaf green unless the
// payload sets its own `color`. Messages post via webhook so the bot appears
// as the character (e.g. Orville).
// ---------------------------------------------------------------------------

// Auto-sent when a ticket is opened (see ticket-setup.js). The applicant is
// pinged in the message content alongside this embed.
const WELCOME = {
    "username": "Orville",
    "avatar_url": "https://i.ytimg.com/vi/hyzqLZri-E0/oar2.jpg?sqp=-oaymwEYCJUDENAFSFqQAgHyq4qpAwcIARUAAIhC&rs=AOn4CLByKJA0CJ_ehgG6a7T2fNIQBDA5BQ&usqp=CCk",
    "embeds": [
        {
            "title": "Welcome!",
            "description": "I’m **Orville**, and I’ll be running you through your interview.\n\nWe at **Everest** appreciate your interest in playing the season! To ensure a high chance of being cast, please **take your time** on this interview. Don’t rush through it too fast, it isn’t long and tedious. The best answers are thought out ones!\n\nFor this season, our producers have personally recruited some people to be on the season. If you’re one of those people, you can do **`!recruit-1`** to proceed. If you’re not, you can do **`!interview-1`** to proceed.",
            "image": {
                "url": "https://static2.klipy.com/ii/d7aec6f6f171607374b2065c836f92f4/eb/10/B2sU82Sb.gif"
            }
        }
    ]
};

// Command-triggered steps. Key = the command name (no prefix), e.g. `recruit-1`
// fires on `!recruit-1`. Paste each step's payload as you provide it.
const steps = {
    "recruit-1": {
        "username": "Orville",
        "avatar_url": "https://i.ytimg.com/vi/hyzqLZri-E0/oar2.jpg?sqp=-oaymwEYCJUDENAFSFqQAgHyq4qpAwcIARUAAIhC&rs=AOn4CLByKJA0CJ_ehgG6a7T2fNIQBDA5BQ&usqp=CCk",
        "embeds": [
            {
                "title": "Recruit 1",
                "description": "Well, let’s start off with the question you all know and love.\n\nIf you’re here, someone on the host team probably knows all of this already. Still, we need some info!\n\n> Your **name**\n> Your **age**\n> Your **pronouns**\n> Your **timezone**\n\nTo continue, do **`!recruit-2`**.",
                "image": {
                    "url": "https://static2.klipy.com/ii/c3a19a0b747a76e98651f2b9a3cca5ff/bd/6e/ovdfM5WM.gif"
                }
            }
        ]
    },

    "recruit-2": {
        "username": "Orville",
        "avatar_url": "https://i.ytimg.com/vi/hyzqLZri-E0/oar2.jpg?sqp=-oaymwEYCJUDENAFSFqQAgHyq4qpAwcIARUAAIhC&rs=AOn4CLByKJA0CJ_ehgG6a7T2fNIQBDA5BQ&usqp=CCk",
        "embeds": [
            {
                "title": "Recruit 2",
                "description": "Let’s get a little deeper into it. Of course, we aren’t going to make you do a standard interview. We just have proper question for you today.\n\n**Why will you win Everest Survivor S2: New Horizons?**\n\nWhen you’re ready to continue, you can do **`!recruit-3`**.\n",
                "image": {
                    "url": "https://static2.klipy.com/ii/c3a19a0b747a76e98651f2b9a3cca5ff/24/a5/kzXJhjlg.gif"
                }
            }
        ]
    },

    "recruit-3": {
        "username": "Orville",
        "avatar_url": "https://i.ytimg.com/vi/hyzqLZri-E0/oar2.jpg?sqp=-oaymwEYCJUDENAFSFqQAgHyq4qpAwcIARUAAIhC&rs=AOn4CLByKJA0CJ_ehgG6a7T2fNIQBDA5BQ&usqp=CCk",
        "embeds": [
            {
                "title": "Recruit 3",
                "description": "And now for the fun part!\n\nThis season, each castaway will be represented by a **villager**. If you’re unfamiliar with Animal Crossing, there are over 400 villagers that can choose to come live on or visit your island.\n\nHead over to [this link](https://animalcrossing.fandom.com/wiki/Villager_list_(New_Horizons)) and find **three** villagers you would like to represent you. Then, send them here in order of highest to lowest priority.\n\nWe work on a first come, first serve basis, so the quicker you do this the higher your chances are of getting your favorite!\n\nThe following villagers are **off-limits**:\n> * Erik (fishpog)\n> * Lopez (Kebab)\n> * Raymond (Mike)\n> * Fang (Fio)\n> * Admiral (xSoul)\n> * Sasha (Lemmy)\n> * Kid Cat (Woofley)\n> * Boots (Void)\n> * Freya (Fuggles)\n> - Any **special** characters, i.e. Tom Nook or Blathers\n\nTo continue, do **`!acknowledgements`**.",
                "image": {
                    "url": "https://static2.klipy.com/ii/35ccce3d852f7995dd2da910f2abd795/7d/8a/g3aT5CSX.gif"
                }
            }
        ]
    },

    "acknowledgements": {
        "username": "Orville",
        "avatar_url": "https://i.ytimg.com/vi/hyzqLZri-E0/oar2.jpg?sqp=-oaymwEYCJUDENAFSFqQAgHyq4qpAwcIARUAAIhC&rs=AOn4CLByKJA0CJ_ehgG6a7T2fNIQBDA5BQ&usqp=CCk",
        "embeds": [
            {
                "description": "# ACKNOWLEDGEMENTS & UNDERSTANDINGS\n\nIn order for you to formally enter the casting pool, you must read and agree to all of the following:\n\n1. *I have read the <#1414321682839109818> and understand what I can be given a strike for. I recognize that cheating of any kind and extreme instances of toxicity will not be tolerated in this environment.*\n\n2. *I am signing up for a game that can be very mentally taxing at times. While this ORG is important, I understand that real life and mental health will always take priority over a silly online game.*\n\n3. *It is expected of me to do confessionals each episode in my confessional channel. I will not leave my confessional blank and actively contribute content (and my personal narrative) to the season!*\n\n4. *I understand that this will be a time commitment, and I will do my best to be available as often as I can be. While it is not expected of me to be on Discord 24/7, I have the free time needed to be an active participant in the game.*\n\nIf you don't want to fill out a DNC list, you're done! Continue with **`!finish`**.\nIf you DO feel the need to fill one out, the command to do so is **`!dnc-list`**.",
                "image": {
                    "url": "https://static2.klipy.com/ii/8ce8357c78ea940b9c2015daf05ce1a5/b0/ea/ufiUgoyu.gif"
                }
            }
        ]
    },

    "dnc-list": {
        "username": "Orville",
        "avatar_url": "https://i.ytimg.com/vi/hyzqLZri-E0/oar2.jpg?sqp=-oaymwEYCJUDENAFSFqQAgHyq4qpAwcIARUAAIhC&rs=AOn4CLByKJA0CJ_ehgG6a7T2fNIQBDA5BQ&usqp=CCk",
        "embeds": [
            {
                "description": "# DNC INFO\nLet's be very clear. **I do not like or endorse cancel culture, and I especially do not like a mob mentality against one particular person**. That being said, at Everest, we want to ensure that every player feels comfortable within the game. So with that being said, here is how this will work.\n\nIf you have someone who you have PERSONAL beef with or someone who you just absolutely cannot stand for one reason or another, please let us know their name and discord tag. We can guarantee that you will not start on the same Tribe to minimize the impact of your feud/prevent metagaming.\n\nIf there is someone who you OBJECTIVELY believe should not be allowed to touch this season with a 20-foot pole, please let us know their name, discord tag and a list of reasons they should not play the season. We 100% expect you to provide evidence (screenshots, docs, whatever) to back up your claims here.\n\nAfter *this*, you're done. do **`!finish`** to finish your interview.",
                "image": {
                    "url": "https://media1.tenor.com/m/OUkL8sFsLb4AAAAd/animal-crossing-wave-race-wave-race.gif"
                }
            }
        ]
    },

    "finish": {
        "username": "Orville",
        "avatar_url": "https://i.ytimg.com/vi/hyzqLZri-E0/oar2.jpg?sqp=-oaymwEYCJUDENAFSFqQAgHyq4qpAwcIARUAAIhC&rs=AOn4CLByKJA0CJ_ehgG6a7T2fNIQBDA5BQ&usqp=CCk",
        "embeds": [
            {
                "description": "# ...And that's all!\n\nThank you again for your interest in playing.\n\nWe are extremely excited for this season, and we hope you are equally as excited to play.\n\nIf you wish, ping Producers to let us know you've completed your interview. If not, Fio would probably like you just a little bit more.",
                "image": {
                    "url": "https://static2.klipy.com/ii/d7aec6f6f171607374b2065c836f92f4/4f/b8/E1A33yAd.gif"
                }
            }
        ]
    },

    "interview-1": {
        "username": "Orville",
        "avatar_url": "https://i.ytimg.com/vi/hyzqLZri-E0/oar2.jpg?sqp=-oaymwEYCJUDENAFSFqQAgHyq4qpAwcIARUAAIhC&rs=AOn4CLByKJA0CJ_ehgG6a7T2fNIQBDA5BQ&usqp=CCk",
        "embeds": [
            {
                "title": "Interview 1",
                "description": "Let's begin by making sure we have everything right for our **cast info**.\n\nPlease provide..\n> * Your **name**\n> * Your **age**\n> * Your **pronouns**\n> * Your **timezone**\n\nTo continue, **`!interview-2`**.",
                "image": {
                    "url": "https://static2.klipy.com/ii/d7aec6f6f171607374b2065c836f92f4/74/6c/zy5n9I93.gif"
                }
            }
        ]
    },

    "interview-2": {
        "username": "Orville",
        "avatar_url": "https://i.ytimg.com/vi/hyzqLZri-E0/oar2.jpg?sqp=-oaymwEYCJUDENAFSFqQAgHyq4qpAwcIARUAAIhC&rs=AOn4CLByKJA0CJ_ehgG6a7T2fNIQBDA5BQ&usqp=CCk",
        "embeds": [
            {
                "title": "Interview 2",
                "description": "*Now let's get into this.*\n\n*What's your reasoning for applying to this season? Are you interested in the theme? Were you in and around season 1 of Everest and wanted to take a crack at season 2? Let us know!*\n\nTo continue, **`!interview-3`**.",
                "image": {
                    "url": "https://static2.klipy.com/ii/4e7bea9f7a3371424e6c16ebc93252fe/fa/7c/LUoNVl1d5Fas00BLHH.gif"
                }
            }
        ]
    },

    "interview-3": {
        "username": "Orville",
        "avatar_url": "https://i.ytimg.com/vi/hyzqLZri-E0/oar2.jpg?sqp=-oaymwEYCJUDENAFSFqQAgHyq4qpAwcIARUAAIhC&rs=AOn4CLByKJA0CJ_ehgG6a7T2fNIQBDA5BQ&usqp=CCk",
        "embeds": [
            {
                "title": "Interview 3",
                "description": "Now into the personal territory...\n\n*Tell us about your ORG history! Are you the kind of player who's always involved in a game? Are you more of a once-a-year kind of player? Did you come out of retirement just for this? Please share your experiences with any fun or notable games from your ORG career!*\n\n*...or if this is your first ORG ever, welcome! Are you a fan of the show, did you get introduced by a friend? How'd you end up here? More importantly... how do you plan to navigate the game for your first time playing?*\n\n*Additionally, what from your previous ORG runs do you want to replicate here in Everest? What worked well for you before? What do you want to change this time around? Give us the tea!*\n\nTo continue, **`!interview-4`**.",
                "image": {
                    "url": "https://static2.klipy.com/ii/4e7bea9f7a3371424e6c16ebc93252fe/d2/55/QkkoPeSb57MaCm.gif"
                }
            }
        ]
    },

    "interview-4": {
        "username": "Orville",
        "avatar_url": "https://i.ytimg.com/vi/hyzqLZri-E0/oar2.jpg?sqp=-oaymwEYCJUDENAFSFqQAgHyq4qpAwcIARUAAIhC&rs=AOn4CLByKJA0CJ_ehgG6a7T2fNIQBDA5BQ&usqp=CCk",
        "embeds": [
            {
                "title": "Interview 4",
                "description": "We've got just 2 more questions for you today.\n\n*Every Survivor season is full of characters… heroes, villains, side-kicks, comedic reliefs, trainwrecks and so much more. How would you describe the kind of character you anticipate being this season?*\n\n*Enough about Survivor and ORGs now. Tell us a little more about yourself, outside of the game. How do you describe yourself, and how might that compare to how OTHERS describe you? Additionally, tell us about your hobbies and what you do for work/school!*\n\nTo continue, **`!interview-5`**.",
                "image": {
                    "url": "https://static2.klipy.com/ii/71b2873e478b9d8d0482ea3ec777ba7f/63/dd/JVZ19MeI.gif"
                }
            }
        ]
    },

    "interview-5": {
        "username": "Orville",
        "avatar_url": "https://i.ytimg.com/vi/hyzqLZri-E0/oar2.jpg?sqp=-oaymwEYCJUDENAFSFqQAgHyq4qpAwcIARUAAIhC&rs=AOn4CLByKJA0CJ_ehgG6a7T2fNIQBDA5BQ&usqp=CCk",
        "embeds": [
            {
                "title": "Interview 5",
                "description": "And now for the fun part!\n\nThis season, each castaway will be represented by a **villager**. If you’re unfamiliar with Animal Crossing, there are over 400 villagers that can choose to come live on or visit your island.\n\nHead over to [this link](https://animalcrossing.fandom.com/wiki/Villager_list_(New_Horizons)) and find **three** villagers you would like to represent you. Then, send them here in order of highest to lowest priority.\n\nWe work on a first come, first serve basis, so the quicker you do this the higher your chances are of getting your favorite!\n\nThe following villagers are **off-limits**:\n> * Erik (fishpog)\n> * Lopez (Kebab)\n> * Raymond (Mike)\n> * Fang (Fio)\n> * Admiral (xSoul)\n> * Sasha (Lemmy)\n> * Kid Cat (Woofley)\n> * Boots (Void)\n> * Freya (Fuggles)\n> - Any **special** characters, i.e. Tom Nook or Blathers\n\nTo continue, do **`!acknowledgements`**.",
                "image": {
                    "url": "https://static2.klipy.com/ii/35ccce3d852f7995dd2da910f2abd795/7d/8a/g3aT5CSX.gif"
                }
            }
        ]
    },
};

module.exports = {
    WELCOME,
    steps,

    // Called by ticket-setup.js when a ticket channel is created.
    async sendWelcome(channel, user) {
        return sendAsCharacter(channel, WELCOME, `${user}`);
    },

    // Called by messageCreate.js for prefix commands. Returns true if handled.
    async handleApplicationCommand(message, commandName) {
        const payload = steps[commandName];
        if (!payload) return false;

        try {
            await sendAsCharacter(message.channel, payload);
            return true;
        } catch (error) {
            console.error('Error in application command handler:', error);
            return false;
        }
    }
};
