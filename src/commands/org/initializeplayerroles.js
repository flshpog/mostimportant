const { SlashCommandBuilder, PermissionFlagsBits, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { getPlayerRoles, setPlayerRoles, parsePlayerRoleIds } = require('../../handlers/playerRoles');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('initializeplayerroles')
        .setDescription('Set the full list of player roles (replaces the existing list)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    async execute(interaction) {
        const existing = getPlayerRoles(interaction.guild.id);

        const modal = new ModalBuilder()
            .setCustomId('initialize_player_roles_modal')
            .setTitle('Initialize Player Roles');

        const input = new TextInputBuilder()
            .setCustomId('player_roles')
            .setLabel('Player roles (mentions or IDs)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('@Player1 @Player2 @Player3 ...')
            .setMaxLength(4000)
            .setRequired(true);

        if (existing.length) {
            input.setValue(existing.map(id => `<@&${id}>`).join(' '));
        }

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
    },

    async handleModalSubmit(interaction) {
        const raw = interaction.fields.getTextInputValue('player_roles');
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
