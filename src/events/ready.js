const { Events, REST, Routes } = require('discord.js');
const { startPeriodicCheck } = require('../handlers/stickyManager');
const { startShopScheduler } = require('../handlers/shopScheduler');
const { resumeAll: resumeBugFrenzy } = require('../handlers/bugFrenzy');
const { resumeAll: resumeFishingFrenzy } = require('../handlers/fishingFrenzy');

const GUILD_ID = '1414321682025545822';

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`Ready! Logged in as ${client.user.tag}`);

        const commands = [];
        client.slashCommands.forEach(command => {
            commands.push(command.data.toJSON());
        });

        const rest = new REST().setToken(client.config.token);

        console.log(`Started refreshing ${commands.length} application (/) commands.`);

        // Guild-scoped registration applies the moment the bot restarts, while a
        // global one can take Discord up to an hour to propagate. Register to every
        // server the bot is in so command changes show up immediately in all of
        // them, not just the main one. GUILD_ID is kept in the set in case the bot
        // is registered there but not currently connected.
        const guildIds = new Set([GUILD_ID, ...client.guilds.cache.keys()]);
        for (const guildId of guildIds) {
            const label = client.guilds.cache.get(guildId)?.name || guildId;
            try {
                const data = await rest.put(
                    Routes.applicationGuildCommands(client.user.id, guildId),
                    { body: commands },
                );
                console.log(`Registered ${data.length} commands in ${label}.`);
            } catch (error) {
                // One bad guild (bot removed, missing scope) must not stop the rest.
                console.error(`Failed to register commands in ${label}:`, error.message);
            }
        }

        try {
            // Also register globally, for the Supports Commands badge and for any
            // server that joins later, before the next restart re-runs this.
            await rest.put(
                Routes.applicationCommands(client.user.id),
                { body: commands },
            );
            console.log('Successfully registered global application (/) commands.');
        } catch (error) {
            console.error('Error registering global slash commands:', error);
        }

        client.user.setPresence({
            activities: [{ name: 'Everest Hub', type: 3 }],
            status: 'idle',
        });

        startPeriodicCheck(client);
        startShopScheduler(client);
        resumeBugFrenzy(client);
        resumeFishingFrenzy(client);
    },
};
