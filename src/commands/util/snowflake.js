const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('snowflake')
        .setDescription('Convert Discord snowflake ID(s) to timestamps')
        .addStringOption(option =>
            option.setName('id1')
                .setDescription('First Discord ID to convert')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('id2')
                .setDescription('Second Discord ID to compare (optional)')
                .setRequired(false)),

    name: 'snowflake',
    description: 'Convert Discord snowflake ID(s) to timestamps',
    usage: '!snowflake <id1> [id2]',

    async execute(interaction, args) {
        const isSlash = !args; // If args is undefined, it's a slash command
        
        try {
            let id1, id2;

            if (isSlash) {
                id1 = interaction.options.getString('id1');
                id2 = interaction.options.getString('id2');
            } else {
                const message = interaction; // interaction is actually message for prefix commands
                
                if (args.length === 0) {
                    return await message.reply('Please provide at least one Discord ID.\nUsage: `!snowflake <id1> [id2]`');
                }
                
                id1 = args[0];
                id2 = args[1] || null;
            }

            // Validate first ID
            if (!this.isValidSnowflake(id1)) {
                const errorMsg = `"${id1}" is not a valid Discord snowflake ID.`;
                return await (isSlash ? 
                    interaction.reply({ content: errorMsg, ephemeral: true }) :
                    interaction.reply(errorMsg)
                );
            }

            // Validate second ID if provided
            if (id2 && !this.isValidSnowflake(id2)) {
                const errorMsg = `"${id2}" is not a valid Discord snowflake ID.`;
                return await (isSlash ? 
                    interaction.reply({ content: errorMsg, ephemeral: true }) :
                    interaction.reply(errorMsg)
                );
            }

            const timestamp1 = this.snowflakeToTimestamp(id1);
            const date1 = new Date(timestamp1);

            const embed = new EmbedBuilder()
                .setTitle('❄️ Snowflake Timestamp Converter')
                .setColor(0x5865F2)
                .addFields(
                    {
                        name: '🆔 ID 1',
                        value: `\`${id1}\``,
                        inline: true
                    },
                    {
                        name: '🕐 Timestamp',
                        value: `<t:${Math.floor(timestamp1 / 1000)}:F>`,
                        inline: true
                    },
                    {
                        name: '📅 Relative',
                        value: `<t:${Math.floor(timestamp1 / 1000)}:R>`,
                        inline: true
                    }
                );

            if (id2) {
                const timestamp2 = this.snowflakeToTimestamp(id2);
                const date2 = new Date(timestamp2);
                const timeDiff = Math.abs(timestamp2 - timestamp1);

                embed.addFields(
                    {
                        name: '🆔 ID 2',
                        value: `\`${id2}\``,
                        inline: true
                    },
                    {
                        name: '🕐 Timestamp',
                        value: `<t:${Math.floor(timestamp2 / 1000)}:F>`,
                        inline: true
                    },
                    {
                        name: '📅 Relative',
                        value: `<t:${Math.floor(timestamp2 / 1000)}:R>`,
                        inline: true
                    },
                    {
                        name: '⏱️ Time Difference',
                        value: this.formatTimeDifference(timeDiff),
                        inline: false
                    }
                );

            }

            embed.setFooter({ 
                text: 'Discord Epoch: January 1, 2015 00:00:00 UTC' 
            }).setTimestamp();

            await (isSlash ? 
                interaction.reply({ embeds: [embed] }) :
                interaction.reply({ embeds: [embed] })
            );

        } catch (error) {
            console.error('Error in snowflake command:', error);
            const errorMsg = 'There was an error processing the snowflake ID(s).';
            
            await (isSlash ? 
                interaction.reply({ content: errorMsg, ephemeral: true }) :
                interaction.reply(errorMsg)
            );
        }
    },

    isValidSnowflake(id) {
        // Discord snowflakes are 64-bit integers
        return /^\d{17,19}$/.test(id) && !isNaN(id) && BigInt(id) >= 0n;
    },

    snowflakeToTimestamp(snowflake) {
        // Discord epoch starts at January 1, 2015 00:00:00 UTC
        const DISCORD_EPOCH = 1420070400000;
        const id = BigInt(snowflake);
        const timestamp = Number(id >> 22n) + DISCORD_EPOCH;
        return timestamp;
    },

    formatTimeDifference(milliseconds) {
        const totalMs = milliseconds;
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        const weeks = Math.floor(days / 7);
        const months = Math.floor(days / 30);
        const years = Math.floor(days / 365);

        // Get remaining milliseconds after extracting seconds
        const remainingMs = totalMs % 1000;

        if (years > 0) {
            return `${years} year${years !== 1 ? 's' : ''}, ${days % 365} day${(days % 365) !== 1 ? 's' : ''}, ${(seconds % 60)}.${remainingMs.toString().padStart(3, '0')}s`;
        } else if (months > 0) {
            return `${months} month${months !== 1 ? 's' : ''}, ${days % 30} day${(days % 30) !== 1 ? 's' : ''}, ${(seconds % 60)}.${remainingMs.toString().padStart(3, '0')}s`;
        } else if (weeks > 0) {
            return `${weeks} week${weeks !== 1 ? 's' : ''}, ${days % 7} day${(days % 7) !== 1 ? 's' : ''}, ${(seconds % 60)}.${remainingMs.toString().padStart(3, '0')}s`;
        } else if (days > 0) {
            return `${days} day${days !== 1 ? 's' : ''}, ${hours % 24} hour${(hours % 24) !== 1 ? 's' : ''}, ${(seconds % 60)}.${remainingMs.toString().padStart(3, '0')}s`;
        } else if (hours > 0) {
            return `${hours} hour${hours !== 1 ? 's' : ''}, ${minutes % 60} minute${(minutes % 60) !== 1 ? 's' : ''}, ${(seconds % 60)}.${remainingMs.toString().padStart(3, '0')}s`;
        } else if (minutes > 0) {
            return `${minutes} minute${minutes !== 1 ? 's' : ''}, ${(seconds % 60)}.${remainingMs.toString().padStart(3, '0')}s`;
        } else {
            return `${seconds}.${remainingMs.toString().padStart(3, '0')}s`;
        }
    }
};