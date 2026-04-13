const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

// CONFIG - Update these IDs for your server
const CONFIG = {
    CONFESSIONAL_CHANNEL_IDS: [
        "1414779620544483459",
        "1414779621613764700",
        "1414779623039963217",
        "1414779624667484210",
        "1414779630174470244",
        "1414779631474835476",
        "1414779634813370528",
        "1414779635765612695",
        "1414779637095075850",
        "1414779638168948898",
        "1414779639074783284",
        "1414779645349462066",
        "1414779647626842353",
        "1414779649476530226",
        "1414779651099856988",
        "1414779652718858402",
        "1414779654052778145",
        "1414779654996361226"
     ], // Replace with your confessional category ID
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Send a message to all confessional channels')
        .addStringOption(option =>
            option.setName('message')
                .setDescription('The message to send to all confessionals')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        try {
            const message = interaction.options.getString('message');

            // Get confessional channels from the ID list
            const confessionalChannels = [];
            const notFoundChannels = [];

            for (const channelId of CONFIG.CONFESSIONAL_CHANNEL_IDS) {
                const channel = interaction.guild.channels.cache.get(channelId);
                if (channel && channel.isTextBased()) {
                    confessionalChannels.push(channel);
                } else {
                    notFoundChannels.push(channelId);
                }
            }

            if (confessionalChannels.length === 0) {
                return await interaction.reply({
                    content: 'No valid confessional channels found. Please update CONFESSIONAL_CHANNEL_IDS in announce.js with your actual channel IDs.',
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            // Send message to all confessional channels
            const sendPromises = [];
            const results = {
                success: 0,
                failed: 0,
                failedChannels: []
            };

            for (const channel of confessionalChannels) {
                sendPromises.push(
                    channel.send(`${message}`)
                        .then(() => {
                            results.success++;
                        })
                        .catch(error => {
                            console.error(`Failed to send to ${channel.name}:`, error);
                            results.failed++;
                            results.failedChannels.push(channel.name);
                        })
                );
            }

            // Wait for all messages to be sent
            await Promise.allSettled(sendPromises);

            let responseMessage = `✅ Announcement sent successfully!\n\n` +
                                 `**📊 Results:**\n` +
                                 `• **Successful:** ${results.success} channels\n` +
                                 `• **Failed:** ${results.failed} channels\n` +
                                 `• **Total Channels:** ${confessionalChannels.length}`;

            if (results.failed > 0 && results.failedChannels.length > 0) {
                const failedList = results.failedChannels.length > 5 
                    ? `${results.failedChannels.slice(0, 5).join(', ')}, and ${results.failedChannels.length - 5} more...`
                    : results.failedChannels.join(', ');
                
                responseMessage += `\n\n⚠️ **Failed channels:** ${failedList}`;
            }

            if (notFoundChannels.length > 0) {
                responseMessage += `\n\n⚠️ **Channels not found:** ${notFoundChannels.length} channel IDs in config don't exist or aren't text channels`;
            }

            responseMessage += `\n\n**📝 Message sent:**\n> ${message.length > 100 ? message.substring(0, 100) + '...' : message}`;

            await interaction.editReply(responseMessage);

        } catch (error) {
            console.error('Error in announce command:', error);
            const errorMessage = 'There was an error sending the announcement.';
            
            if (interaction.deferred) {
                await interaction.editReply(errorMessage);
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    }
};