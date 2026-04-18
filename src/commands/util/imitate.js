const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('imitate')
        .setDescription("Send a message as another user (uses their pfp and display name)")
        .addUserOption(opt =>
            opt.setName('user').setDescription('The user to imitate').setRequired(true))
        .addStringOption(opt =>
            opt.setName('text').setDescription('The message to send').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');
        const text = interaction.options.getString('text');

        if (interaction.channel.type !== ChannelType.GuildText && interaction.channel.type !== ChannelType.GuildAnnouncement) {
            return interaction.reply({ content: 'This command can only be used in regular text channels.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            const displayName = member?.displayName || targetUser.username;
            const avatarURL = member?.displayAvatarURL({ size: 256 }) || targetUser.displayAvatarURL({ size: 256 });

            const webhooks = await interaction.channel.fetchWebhooks();
            let webhook = webhooks.find(w => w.owner?.id === interaction.client.user.id && w.name === 'Imitate');

            if (!webhook) {
                webhook = await interaction.channel.createWebhook({
                    name: 'Imitate',
                    reason: 'Imitate command',
                });
            }

            await webhook.send({
                content: text,
                username: displayName,
                avatarURL: avatarURL,
                allowedMentions: { parse: [] },
            });

            await interaction.editReply({ content: `Sent as **${displayName}**.` });
        } catch (error) {
            console.error('Error in imitate command:', error);
            await interaction.editReply({ content: 'There was an error sending the message. Make sure I have **Manage Webhooks** permission in this channel.' });
        }
    },
};
