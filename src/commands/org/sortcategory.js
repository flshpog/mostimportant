const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sortcategory')
        .setDescription('Sort all channels in a category alphabetically')
        .addChannelOption(option =>
            option.setName('category')
                .setDescription('The category to sort channels in')
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        try {
            const category = interaction.options.getChannel('category');

            // Validate category
            if (category.type !== ChannelType.GuildCategory) {
                return await interaction.reply({
                    content: 'Please select a valid category channel.',
                    ephemeral: true
                });
            }

            // Get all channels in the category
            const channels = Array.from(category.children.cache.values());

            if (channels.length === 0) {
                return await interaction.reply({
                    content: 'This category has no channels to sort.',
                    ephemeral: true
                });
            }

            if (channels.length === 1) {
                return await interaction.reply({
                    content: 'This category only has one channel, no sorting needed.',
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            // Separate channels by type and sort alphabetically
            const textChannels = channels
                .filter(ch => ch.type === ChannelType.GuildText)
                .sort((a, b) => a.name.localeCompare(b.name));

            const voiceChannels = channels
                .filter(ch => ch.type === ChannelType.GuildVoice)
                .sort((a, b) => a.name.localeCompare(b.name));

            const forumChannels = channels
                .filter(ch => ch.type === ChannelType.GuildForum)
                .sort((a, b) => a.name.localeCompare(b.name));

            const announcementChannels = channels
                .filter(ch => ch.type === ChannelType.GuildAnnouncement)
                .sort((a, b) => a.name.localeCompare(b.name));

            const stageChannels = channels
                .filter(ch => ch.type === ChannelType.GuildStageVoice)
                .sort((a, b) => a.name.localeCompare(b.name));

            // Combine in order: announcements, text, voice, stage, forum
            const sortedChannels = [
                ...announcementChannels,
                ...textChannels,
                ...voiceChannels,
                ...stageChannels,
                ...forumChannels
            ];

            // Bulk-update all positions in a single atomic API call.
            // Positions are relative within the category here, so 0..N gives the sorted order.
            const positionUpdates = sortedChannels.map((channel, index) => ({
                channel: channel.id,
                position: index,
            }));

            await interaction.guild.channels.setPositions(positionUpdates);

            let responseMessage = `✅ Successfully sorted ${sortedChannels.length} channels in **${category.name}** alphabetically!`;

            // Show the new order
            const channelList = sortedChannels
                .map((ch, index) => {
                    const emoji = this.getChannelEmoji(ch.type);
                    return `${index + 1}. ${emoji} ${ch.name}`;
                })
                .join('\n');

            if (channelList.length < 1800) { // Discord embed limit
                responseMessage += `\n\n**New Order:**\n\`\`\`\n${channelList}\n\`\`\``;
            }

            await interaction.editReply(responseMessage);

        } catch (error) {
            console.error('Error sorting category:', error);
            const errorMessage = 'There was an error sorting the category channels.';
            
            if (interaction.deferred) {
                await interaction.editReply(errorMessage);
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    },

    getChannelEmoji(channelType) {
        switch (channelType) {
            case ChannelType.GuildText:
                return '#';
            case ChannelType.GuildVoice:
                return '🔊';
            case ChannelType.GuildAnnouncement:
                return '📢';
            case ChannelType.GuildStageVoice:
                return '🎭';
            case ChannelType.GuildForum:
                return '💬';
            default:
                return '📁';
        }
    }
};