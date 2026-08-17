const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const eco = require('../../handlers/economy');
const { formatBells } = require('../../config/economy');
const { ensureHost } = require('../../handlers/hostGate');
const { logToHost } = require('../../handlers/economyLog');

// The house-payment tool - runs ~13 times per tribal, so keep it fast: one user,
// one amount, one confirm.
module.exports = {
    data: new SlashCommandBuilder()
        .setName('deduct')
        .setDescription('Remove bells from a player - the house payment tool (host only).')
        .addUserOption(o => o.setName('user').setDescription('The player').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('Bells to remove').setRequired(true).setMinValue(1))
        .addStringOption(o => o.setName('reason').setDescription('Reason (optional)'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!(await ensureHost(interaction))) return;

        const user = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        const reason = interaction.options.getString('reason') || 'House payment';

        const player = eco.getPlayer(interaction.guildId, user.id);
        const before = player.balance;
        eco.setBalance(player, before - amount);
        eco.savePlayer(interaction.guildId, user.id, player);

        await interaction.reply({
            content: `✅ Deducted ${formatBells(amount)} from ${user}. New balance: ${formatBells(player.balance)}.`,
            ephemeral: true,
        });
        await logToHost(
            interaction.client,
            `➖ **${interaction.user.tag}** deducted ${amount.toLocaleString('en-US')} bells from **${user.tag}** ` +
            `(${before.toLocaleString('en-US')} → ${player.balance.toLocaleString('en-US')}). Reason: ${reason}`
        );
    },
};
