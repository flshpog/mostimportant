const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const eco = require('../../handlers/economy');
const { formatBells } = require('../../config/economy');
const { ensureHost } = require('../../handlers/hostGate');
const { logToHost } = require('../../handlers/economyLog');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('grant')
        .setDescription('Add bells to a player (host only).')
        .addUserOption(o => o.setName('user').setDescription('The player').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('Bells to add').setRequired(true).setMinValue(1))
        .addStringOption(o => o.setName('reason').setDescription('Reason (optional)'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!(await ensureHost(interaction))) return;

        const user = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        const reason = interaction.options.getString('reason') || 'No reason given';

        const player = eco.getPlayer(interaction.guildId, user.id);
        const before = player.balance;
        eco.addBalance(player, amount);
        eco.savePlayer(interaction.guildId, user.id, player);

        await interaction.reply({
            content: `✅ Granted ${formatBells(amount)} to ${user}. New balance: ${formatBells(player.balance)}.`,
            ephemeral: true,
        });
        await logToHost(
            interaction.client,
            `➕ **${interaction.user.tag}** granted ${amount.toLocaleString('en-US')} bells to **${user.tag}** ` +
            `(${before.toLocaleString('en-US')} → ${player.balance.toLocaleString('en-US')}). Reason: ${reason}`
        );
    },
};
