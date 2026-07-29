const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { processCategory } = require('../../handlers/oneOnOneMute');

module.exports = {
    data: (() => {
        const builder = new SlashCommandBuilder()
            .setName('unmute1on1s')
            .setDescription('Re-allow view/speak for involved player roles across one or more categories');

        for (let i = 1; i <= 10; i++) {
            builder.addChannelOption(option =>
                option.setName(i === 1 ? 'category' : `category${i}`)
                    .setDescription(i === 1 ? 'The category whose 1-1 channels to unmute' : `Additional category ${i} (optional)`)
                    .addChannelTypes(ChannelType.GuildCategory)
                    .setRequired(i === 1));
        }

        return builder.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);
    })(),

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
