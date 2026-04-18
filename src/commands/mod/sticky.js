const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const stickyManager = require('../../handlers/stickyManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sticky')
        .setDescription('Manage sticky messages in a channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Add a sticky message to a channel')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('The channel to add the sticky to')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove the sticky message from a channel')
                .addChannelOption(opt =>
                    opt.setName('channel')
                        .setDescription('The channel to remove the sticky from')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(true))),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const channel = interaction.options.getChannel('channel');

        if (sub === 'add') {
            const existing = stickyManager.getSticky(channel.id);
            const modal = new ModalBuilder()
                .setCustomId(`sticky_add_modal_${channel.id}`)
                .setTitle(`Sticky message for #${channel.name.slice(0, 30)}`);

            const input = new TextInputBuilder()
                .setCustomId('sticky_content')
                .setLabel('Message content')
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(2000)
                .setRequired(true);

            if (existing?.content) {
                input.setValue(existing.content);
            }

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            return;
        }

        if (sub === 'remove') {
            const sticky = stickyManager.getSticky(channel.id);
            if (!sticky) {
                return interaction.reply({ content: `No sticky message in ${channel}.`, ephemeral: true });
            }

            // Delete the sticky message if it still exists
            if (sticky.messageId) {
                try {
                    const msg = await channel.messages.fetch(sticky.messageId).catch(() => null);
                    if (msg) await msg.delete().catch(() => {});
                } catch {}
            }

            stickyManager.removeSticky(channel.id);
            await interaction.reply({ content: `Removed sticky from ${channel}.`, ephemeral: true });
        }
    },

    async handleModalSubmit(interaction) {
        const channelId = interaction.customId.replace('sticky_add_modal_', '');
        const content = interaction.fields.getTextInputValue('sticky_content');

        const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            return interaction.reply({ content: 'Channel not found.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        // Delete existing sticky message if present
        const existing = stickyManager.getSticky(channelId);
        if (existing?.messageId) {
            try {
                const oldMsg = await channel.messages.fetch(existing.messageId).catch(() => null);
                if (oldMsg) await oldMsg.delete().catch(() => {});
            } catch {}
        }

        const msg = await channel.send(content).catch(err => {
            console.error('Failed to send sticky:', err);
            return null;
        });

        if (!msg) {
            return interaction.editReply({ content: `Failed to send sticky in ${channel}. Check my permissions.` });
        }

        stickyManager.setSticky(channelId, content, msg.id);
        await interaction.editReply({ content: `Sticky ${existing ? 'updated' : 'added'} in ${channel}.` });
    },
};
