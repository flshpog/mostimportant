const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { setChannels, parseChannelIds } = require('../../handlers/announceChannels');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('initializesubmissions')
        .setDescription('Set the full list of submission channels (replaces the existing list)')
        .addStringOption(option =>
            option.setName('channels')
                .setDescription('All submission channels as mentions or IDs, space-separated')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        const raw = interaction.options.getString('channels');
        const ids = parseChannelIds(raw);

        const valid = [];
        const invalid = [];
        for (const id of ids) {
            const channel = interaction.guild.channels.cache.get(id);
            if (channel && channel.isTextBased()) valid.push(id);
            else invalid.push(id);
        }

        setChannels(interaction.guildId, 'submissions', valid);

        let msg = `✅ Submission list set - **${valid.length}** channel(s) stored. This replaced any previous list.`;
        if (invalid.length) {
            msg += `\n\n⚠️ Skipped ${invalid.length} ID(s) not found or not text channels:\n${invalid.join(', ')}`;
        }

        await interaction.reply({ content: msg, ephemeral: true });
    },
};
