const {
    SlashCommandBuilder, PermissionFlagsBits,
    ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
} = require('discord.js');
const { getChannels } = require('../../handlers/announceChannels');

const TARGETS = { confessionals: 'Confessionals', submissions: 'Submissions' };

module.exports = {
    data: new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Announce a message to all confessional or submission channels')
        .addStringOption(option =>
            option.setName('to')
                .setDescription('Where to announce')
                .setRequired(true)
                .addChoices(
                    { name: 'Confessionals', value: 'confessionals' },
                    { name: 'Submissions', value: 'submissions' }
                ))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    // Picking the target opens a modal for the message body. (Modals can't hold a
    // dropdown in this discord.js version, so the target is the command option.)
    async execute(interaction) {
        const to = interaction.options.getString('to');

        const modal = new ModalBuilder()
            .setCustomId(`announce_modal_${to}`)
            .setTitle(`Announce → ${TARGETS[to]}`.slice(0, 45));

        const input = new TextInputBuilder()
            .setCustomId('message')
            .setLabel('Message')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('What should be posted to every channel?')
            .setRequired(true)
            .setMaxLength(2000);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
    },

    async handleModalSubmit(interaction) {
        const kind = interaction.customId.replace('announce_modal_', '');
        const label = TARGETS[kind] || kind;
        const message = interaction.fields.getTextInputValue('message');

        const ids = getChannels(interaction.guildId, kind);
        if (ids.length === 0) {
            return interaction.reply({
                content: `No ${label} channels are set yet. Run \`/initialize${kind}\` first.`,
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        let success = 0;
        let failed = 0;
        let missing = 0;
        const failedNames = [];

        for (const id of ids) {
            const channel = interaction.guild.channels.cache.get(id);
            if (!channel || !channel.isTextBased()) { missing++; continue; }
            try {
                await channel.send(message);
                success++;
            } catch (err) {
                console.error(`Announce failed for ${channel.name}:`, err);
                failed++;
                failedNames.push(channel.name);
            }
        }

        let resp =
            `✅ Announcement sent to **${label}**.\n` +
            `• Sent: **${success}**\n` +
            `• Failed: **${failed}**\n` +
            `• Missing/not found: **${missing}**`;
        if (failedNames.length) {
            resp += `\n\n⚠️ Failed: ${failedNames.slice(0, 10).join(', ')}`;
        }

        await interaction.editReply(resp);
    },
};
