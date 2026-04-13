const { Events, REST, Routes } = require('discord.js');

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

        try {
            console.log(`Started refreshing ${commands.length} application (/) commands.`);

            const data = await rest.put(
                Routes.applicationGuildCommands(client.user.id, GUILD_ID),
                { body: commands },
            );

            console.log(`Successfully reloaded ${data.length} guild application (/) commands.`);

            // Also register globally for the Supports Commands badge
            await rest.put(
                Routes.applicationCommands(client.user.id),
                { body: commands },
            );

            console.log('Successfully registered global application (/) commands.');
        } catch (error) {
            console.error('Error registering slash commands:', error);
        }

        client.user.setActivity('Everest Hub', { type: 'WATCHING' });
    },
};
