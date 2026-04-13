const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stopwatch')
        .setDescription('Manage your personal stopwatch')
        .addSubcommand(subcommand =>
            subcommand
                .setName('start')
                .setDescription('Start your stopwatch'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('stop')
                .setDescription('Stop your stopwatch and show elapsed time'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('check')
                .setDescription('Check your current stopwatch time'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset your stopwatch'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all active stopwatches')),

    name: 'stopwatch',
    description: 'Manage your personal stopwatch',
    usage: '!stopwatch <start|stop|check|reset|list>',

    async execute(interaction, args) {
        const isSlash = !args;
        let action;

        if (isSlash) {
            action = interaction.options.getSubcommand();
        } else {
            const message = interaction;
            if (args.length === 0) {
                return await message.reply('Please specify an action.\nUsage: `!stopwatch <start|stop|check|reset|list>`');
            }
            action = args[0].toLowerCase();
        }

        const userId = isSlash ? interaction.user.id : interaction.author.id;
        const userName = isSlash ? interaction.user.displayName : interaction.author.displayName;

        try {
            switch (action) {
                case 'start':
                    await this.handleStart(interaction, userId, userName, isSlash);
                    break;
                case 'stop':
                    await this.handleStop(interaction, userId, userName, isSlash);
                    break;
                case 'check':
                    await this.handleCheck(interaction, userId, userName, isSlash);
                    break;
                case 'reset':
                    await this.handleReset(interaction, userId, userName, isSlash);
                    break;
                case 'list':
                    await this.handleList(interaction, isSlash);
                    break;
                default:
                    const errorMsg = 'Invalid action. Use: start, stop, check, reset, or list';
                    await (isSlash ? 
                        interaction.reply({ content: errorMsg, ephemeral: true }) :
                        interaction.reply(errorMsg));
            }
        } catch (error) {
            console.error('Error in stopwatch command:', error);
            const errorMsg = 'There was an error with the stopwatch command.';
            await (isSlash ? 
                interaction.reply({ content: errorMsg, ephemeral: true }) :
                interaction.reply(errorMsg));
        }
    },

    async handleStart(interaction, userId, userName, isSlash) {
        const client = isSlash ? interaction.client : interaction.client;
        
        if (client.stopwatches.has(userId)) {
            const errorMsg = 'You already have an active stopwatch! Use `stopwatch stop` to stop it first.';
            return await (isSlash ? 
                interaction.reply({ content: errorMsg, ephemeral: true }) :
                interaction.reply(errorMsg));
        }

        const startTime = Date.now();
        client.stopwatches.set(userId, {
            startTime,
            userName
        });

        this.saveStopwatches(client);

        const embed = new EmbedBuilder()
            .setTitle('⏱️ Stopwatch Started')
            .setDescription(`${userName}'s stopwatch has been started!`)
            .setColor(0x00FF00)
            .addFields({
                name: '🕐 Started At',
                value: `<t:${Math.floor(startTime / 1000)}:T>`,
                inline: true
            })
            .setTimestamp();

        await (isSlash ? 
            interaction.reply({ embeds: [embed] }) :
            interaction.reply({ embeds: [embed] }));
    },

    async handleStop(interaction, userId, userName, isSlash) {
        const client = isSlash ? interaction.client : interaction.client;
        
        if (!client.stopwatches.has(userId)) {
            const errorMsg = 'You don\'t have an active stopwatch to stop.';
            return await (isSlash ? 
                interaction.reply({ content: errorMsg, ephemeral: true }) :
                interaction.reply(errorMsg));
        }

        const stopwatchData = client.stopwatches.get(userId);
        const endTime = Date.now();
        const elapsed = endTime - stopwatchData.startTime;

        client.stopwatches.delete(userId);
        this.saveStopwatches(client);

        const embed = new EmbedBuilder()
            .setTitle('⏹️ Stopwatch Stopped')
            .setDescription(`${userName}'s stopwatch has been stopped!`)
            .setColor(0xFF0000)
            .addFields(
                {
                    name: '🕐 Started At',
                    value: `<t:${Math.floor(stopwatchData.startTime / 1000)}:T>`,
                    inline: true
                },
                {
                    name: '🕐 Stopped At',
                    value: `<t:${Math.floor(endTime / 1000)}:T>`,
                    inline: true
                },
                {
                    name: '⏱️ Total Time',
                    value: this.formatElapsedTime(elapsed),
                    inline: false
                }
            )
            .setTimestamp();

        await (isSlash ? 
            interaction.reply({ embeds: [embed] }) :
            interaction.reply({ embeds: [embed] }));
    },

    async handleCheck(interaction, userId, userName, isSlash) {
        const client = isSlash ? interaction.client : interaction.client;
        
        if (!client.stopwatches.has(userId)) {
            const errorMsg = 'You don\'t have an active stopwatch.';
            return await (isSlash ? 
                interaction.reply({ content: errorMsg, ephemeral: true }) :
                interaction.reply(errorMsg));
        }

        const stopwatchData = client.stopwatches.get(userId);
        const currentTime = Date.now();
        const elapsed = currentTime - stopwatchData.startTime;

        const embed = new EmbedBuilder()
            .setTitle('⏱️ Stopwatch Check')
            .setDescription(`${userName}'s current stopwatch time:`)
            .setColor(0x5865F2)
            .addFields(
                {
                    name: '🕐 Started At',
                    value: `<t:${Math.floor(stopwatchData.startTime / 1000)}:T>`,
                    inline: true
                },
                {
                    name: '⏱️ Elapsed Time',
                    value: this.formatElapsedTime(elapsed),
                    inline: true
                }
            )
            .setTimestamp();

        await (isSlash ? 
            interaction.reply({ embeds: [embed] }) :
            interaction.reply({ embeds: [embed] }));
    },

    async handleReset(interaction, userId, userName, isSlash) {
        const client = isSlash ? interaction.client : interaction.client;
        
        if (!client.stopwatches.has(userId)) {
            const errorMsg = 'You don\'t have an active stopwatch to reset.';
            return await (isSlash ? 
                interaction.reply({ content: errorMsg, ephemeral: true }) :
                interaction.reply(errorMsg));
        }

        client.stopwatches.delete(userId);
        this.saveStopwatches(client);

        const embed = new EmbedBuilder()
            .setTitle('🔄 Stopwatch Reset')
            .setDescription(`${userName}'s stopwatch has been reset!`)
            .setColor(0xFFFF00)
            .setTimestamp();

        await (isSlash ? 
            interaction.reply({ embeds: [embed] }) :
            interaction.reply({ embeds: [embed] }));
    },

    formatElapsedTime(milliseconds) {
        const totalMs = milliseconds;
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        // Get remaining milliseconds after extracting seconds
        const remainingMs = totalMs % 1000;

        if (days > 0) {
            return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}.${remainingMs.toString().padStart(3, '0')}s`;
        } else if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}.${remainingMs.toString().padStart(3, '0')}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}.${remainingMs.toString().padStart(3, '0')}s`;
        } else {
            return `${seconds}.${remainingMs.toString().padStart(3, '0')}s`;
        }
    },

    saveStopwatches(client) {
        try {
            const stopwatchesObj = {};
            client.stopwatches.forEach((value, key) => {
                stopwatchesObj[key] = value;
            });
            fs.writeFileSync('./data/stopwatches.json', JSON.stringify(stopwatchesObj, null, 2));
        } catch (error) {
            console.error('Error saving stopwatches:', error);
        }
    }
};