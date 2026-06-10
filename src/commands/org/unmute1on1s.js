const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { processCategory } = require('../../handlers/oneOnOneMute');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unmute1on1s')
        .setDescription('Re-allow view/speak for involved player roles in every channel of a category')
        .addChannelOption(option =>
            option.setName('category')
                .setDescription('The category whose 1-1 channels to unmute')
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        try {
            await processCategory(interaction, 'unmute');
        } catch (error) {
            console.error('Error in unmute1on1s:', error);
            const msg = 'There was an error unmuting the 1-1 channels.';
            if (interaction.deferred) {
                await interaction.editReply(msg);
            } else {
                await interaction.reply({ content: msg, ephemeral: true });
            }
        }
    },
};
