const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const eco = require('../../handlers/economy');
const { ensureHost } = require('../../handlers/hostGate');
const { logToHost } = require('../../handlers/economyLog');

// Freezes a player: income commands and /buy are blocked. Their held items do NOT
// return to the shop pool (handled in /editinventory). The single biggest exploit
// guard in the game — a jury farming bells for an ally.
module.exports = {
    data: new SlashCommandBuilder()
        .setName('eliminate')
        .setDescription('Freeze a player from all economy actions (host only).')
        .addUserOption(o => o.setName('user').setDescription('The player').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!(await ensureHost(interaction))) return;

        const user = interaction.options.getUser('user');
        const player = eco.getPlayer(interaction.guildId, user.id);
        player.eliminated = true;
        eco.savePlayer(interaction.guildId, user.id, player);

        await interaction.reply({ content: `☠️ **${user.tag}** has been eliminated and frozen from all economy actions.`, ephemeral: true });
        await logToHost(interaction.client, `☠️ **${interaction.user.tag}** eliminated **${user.tag}**.`);
    },
};
