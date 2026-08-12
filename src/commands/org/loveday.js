const { SlashCommandBuilder } = require('discord.js');
const loveDay = require('../../handlers/loveDay');

// Staff-only pairing command. Run inside the channel that will be the pair's private
// game channel — it registers channel_id -> { resident, pal }. Gated at runtime on the
// configurable staff role (config/loveday.json).
module.exports = {
    data: new SlashCommandBuilder()
        .setName('loveday')
        .setDescription('Register a Love Day resident + pal to this channel (staff only).')
        .addUserOption(o => o.setName('resident').setDescription('The resident').setRequired(true))
        .addUserOption(o => o.setName('pal').setDescription('Their pal').setRequired(true)),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'This command can only be used in the server.', ephemeral: true });
        }

        const staffRoleId = loveDay.getConfig().staff_role_id;
        if (!interaction.member.roles.cache.has(staffRoleId)) {
            return interaction.reply({ content: 'This command is staff-only.', ephemeral: true });
        }

        const resident = interaction.options.getUser('resident');
        const pal = interaction.options.getUser('pal');
        if (resident.id === pal.id) {
            return interaction.reply({ content: 'The resident and the pal must be different people.', ephemeral: true });
        }

        const result = loveDay.register(interaction.channelId, resident.id, pal.id);
        if (result.error) {
            return interaction.reply({ content: `⛔ ${result.error}`, ephemeral: true });
        }

        await interaction.reply({
            content:
                `💘 ${result.overwrote ? 'Updated' : 'Registered'} this channel's Love Day pair: ` +
                `resident ${resident}, pal ${pal}. They can now run \`!loveday\` to begin.`,
            ephemeral: true,
        });
    },
};
