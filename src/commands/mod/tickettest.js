const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tickettest')
        .setDescription('Send the ticket creation embed in the current channel (for testing)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        try {
            const embed = new EmbedBuilder()
                .setTitle('🎫 Create a Ticket')
                .setDescription('Click the button below if you wish to apply for Everest Survivor S1: Twin Peaks!')
                .setColor(0x5865F2)
                .setFooter({ text: 'Everest Survivor Applications' })
                .setTimestamp();

            const button = new ButtonBuilder()
                .setCustomId('create_ticket')
                .setLabel('Create Ticket')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🎫');

            const row = new ActionRowBuilder().addComponents(button);

            await interaction.channel.send({
                embeds: [embed],
                components: [row],
            });

            await interaction.reply({
                content: 'Ticket test embed sent in this channel.',
                ephemeral: true,
            });
        } catch (error) {
            console.error('Error sending ticket test:', error);
            await interaction.reply({
                content: 'There was an error sending the ticket test embed.',
                ephemeral: true,
            });
        }
    },
};
