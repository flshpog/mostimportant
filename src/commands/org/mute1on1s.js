const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { processCategory } = require('../../handlers/oneOnOneMute');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mute1on1s')
        .setDescription('Deny view/speak for involved player roles in every channel of a category')
        .addChannelOption(option =>
            option.setName('category')
                .setDescription('The category whose 1-1 channels to mute')
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        try {
            await processCategory(interaction, 'mute');
        } catch (error) {
            console.error('Error in mute1on1s:', error);
            const msg = 'There was an error muting the 1-1 channels.';
            if (interaction.deferred) {
                await interaction.editReply(msg);
            } else {
                await interaction.reply({ content: msg, ephemeral: true });
            }
        }
    },
};
