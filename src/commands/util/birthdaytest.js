const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { announce, getConfig } = require('../../handlers/birthdays');

// Posts a birthday message + wishes thread in the current channel, exactly as the
// real one will look. It doesn't give the role or count as the real post.
module.exports = {
    data: new SlashCommandBuilder()
        .setName('birthdaytest')
        .setDescription('Preview a birthday post and thread in this channel.')
        .addUserOption(o => o.setName('user').setDescription('Whose birthday (defaults to you)'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!interaction.inGuild() || !interaction.channel?.threads) {
            await interaction.reply({ content: 'Run this in a normal text channel in the server.', ephemeral: true });
            return;
        }

        const user = interaction.options.getUser('user') || interaction.user;
        await interaction.deferReply({ ephemeral: true });
        try {
            await announce(interaction.channel, user.id, getConfig());
            await interaction.editReply('Posted a test birthday message and thread here.');
        } catch (err) {
            console.error('[birthdays] Test post failed:', err);
            await interaction.editReply("Couldn't post the test message. Check that I can send messages and create threads here.");
        }
    },
};
