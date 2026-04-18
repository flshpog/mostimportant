const { Events, EmbedBuilder } = require('discord.js');
const { LOG_CHANNEL_ID, COLORS } = require('../config/logging');
const { getSticky, resendSticky } = require('../handlers/stickyManager');
const https = require('https');

// Voice message flag (1 << 13)
const VOICE_MESSAGE_FLAG = 1 << 13;

function downloadBuffer(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return downloadBuffer(res.headers.location).then(resolve).catch(reject);
            }
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        // Ignore bot messages
        if (message.author.bot) return;

        if (message.guild && getSticky(message.channel.id)) {
            resendSticky(message.channel).catch(() => {});
        }

        // Voice message transcription
        if (message.flags.has(VOICE_MESSAGE_FLAG)) {
            const apiKey = process.env.GROQ_API_KEY;
            if (!apiKey) return;

            const attachment = message.attachments.first();
            if (!attachment) return;

            try {
                const OpenAI = require('openai');

                const url = attachment.proxyURL || attachment.url;
                const buffer = await downloadBuffer(url);

                const groq = new OpenAI({
                    apiKey,
                    baseURL: 'https://api.groq.com/openai/v1',
                });
                const file = await OpenAI.toFile(buffer, 'voice.ogg');
                const transcription = await groq.audio.transcriptions.create({
                    model: 'whisper-large-v3',
                    file,
                });

                const text = transcription.text?.trim();
                if (text) {
                    await message.reply({
                        content: `\`\`\`${text}\`\`\``,
                        allowedMentions: { repliedUser: false },
                    });
                }
            } catch (error) {
                console.error('Error transcribing voice message:', error.message || error);
            }
            return;
        }

        const client = message.client;
        const prefix = client.config.prefix;

        // Handle prefix commands
        if (!message.content.startsWith(prefix)) {
            // Check for custom commands
            const content = message.content.toLowerCase();
            if (content.startsWith(prefix)) {
                const commandName = content.slice(prefix.length).split(' ')[0];
                const customResponse = client.customCommands.get(commandName);

                if (customResponse) {
                    try {
                        // Process newlines in custom command responses
                        const processedResponse = customResponse.replace(/\\n/g, '\n');
                        await message.reply(processedResponse);

                        // Log custom command usage
                        try {
                            const logChannel = message.guild.channels.cache.get(LOG_CHANNEL_ID);
                            if (logChannel) {
                                const embed = new EmbedBuilder()
                                    .setColor(COLORS.CUSTOM_COMMAND)
                                    .setTitle('⚡ Custom Command Triggered')
                                    .setDescription(`**Custom command used in ${message.channel}**`)
                                    .addFields(
                                        { name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: true },
                                        { name: 'Command', value: `?${commandName}`, inline: true },
                                        { name: 'Channel', value: `${message.channel.name}`, inline: true }
                                    )
                                    .setThumbnail(message.author.displayAvatarURL())
                                    .setTimestamp();

                                await logChannel.send({ embeds: [embed] });
                            }
                        } catch (logError) {
                            console.error('Error logging custom command:', logError);
                        }
                    } catch (error) {
                        console.error('Error executing custom command:', error);
                    }
                }
            }
            return;
        }

        const args = message.content.slice(prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        // Check application commands first
        const appCommands = require('../commands/util/application-commands');
        if (await appCommands.handleApplicationCommand(message, commandName)) {
            return; // Application command was handled
        }

        // Check custom commands
        const customResponse = client.customCommands.get(commandName);
        if (customResponse) {
            try {
                // Process newlines in custom command responses
                const processedResponse = customResponse.replace(/\\n/g, '\n');

                // Split into 2000 char chunks if needed
                if (processedResponse.length <= 2000) {
                    await message.reply(processedResponse);
                } else {
                    const chunks = [];
                    let remaining = processedResponse;
                    while (remaining.length > 0) {
                        if (remaining.length <= 2000) {
                            chunks.push(remaining);
                            break;
                        }
                        let splitAt = remaining.lastIndexOf('\n', 2000);
                        if (splitAt === -1) splitAt = 2000;
                        chunks.push(remaining.substring(0, splitAt));
                        remaining = remaining.substring(splitAt).replace(/^\n/, '');
                    }
                    await message.reply(chunks[0]);
                    for (let i = 1; i < chunks.length; i++) {
                        await message.channel.send(chunks[i]);
                    }
                }

                // Log custom command usage
                try {
                    const logChannel = message.guild.channels.cache.get(LOG_CHANNEL_ID);
                    if (logChannel) {
                        const embed = new EmbedBuilder()
                            .setColor(COLORS.CUSTOM_COMMAND)
                            .setTitle('⚡ Custom Command Triggered')
                            .setDescription(`**Custom command used in ${message.channel}**`)
                            .addFields(
                                { name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: true },
                                { name: 'Command', value: `!${commandName}`, inline: true },
                                { name: 'Channel', value: `${message.channel.name}`, inline: true }
                            )
                            .setThumbnail(message.author.displayAvatarURL())
                            .setTimestamp();

                        await logChannel.send({ embeds: [embed] });
                    }
                } catch (logError) {
                    console.error('Error logging custom command:', logError);
                }

                return;
            } catch (error) {
                console.error('Error executing custom command:', error);
                return;
            }
        }

        // Check regular commands
        const command = client.commands.get(commandName);
        if (!command) return;

        try {
            await command.execute(message, args);
        } catch (error) {
            console.error('Error executing prefix command:', error);
            try {
                await message.reply('There was an error executing that command.');
            } catch (replyError) {
                console.error('Error sending error message:', replyError);
            }
        }
    },
};