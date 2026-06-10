const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { setPlayerRoles, parsePlayerRoleIds } = require('../../handlers/playerRoles');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('initializeplayerroles')
        .setDescription('Set the full list of player roles (replaces the existing list)')
        .addStringOption(option =>
            option.setName('roles')
                .setDescription('All player roles as mentions or IDs, space-separated')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    async execute(interaction) {
        const raw = interaction.options.getString('roles');
        const ids = parsePlayerRoleIds(raw);

        const valid = [];
        const invalid = [];
        for (const id of ids) {
            if (interaction.guild.roles.cache.get(id)) valid.push(id);
            else invalid.push(id);
        }

        setPlayerRoles(interaction.guild.id, valid);

        let msg = `✅ Player role list set — **${valid.length}** role(s) stored. This replaced any previous list.`;
        if (invalid.length) {
            msg += `\n\n⚠️ Skipped ${invalid.length} ID(s) not found in this server:\n${invalid.join(', ')}`;
        }

        await interaction.reply({ content: msg, ephemeral: true });
    },
};
