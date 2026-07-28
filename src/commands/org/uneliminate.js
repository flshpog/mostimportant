const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const eco = require('../../handlers/economy');
const { ensureHost } = require('../../handlers/hostGate');
const { logToHost } = require('../../handlers/economyLog');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('uneliminate')
        .setDescription('Reverse an elimination (host only).')
        .addUserOption(o => o.setName('user').setDescription('The player').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!(await ensureHost(interaction))) return;

        const user = interaction.options.getUser('user');
        const player = eco.getPlayer(interaction.guildId, user.id);
        player.eliminated = false;
        eco.savePlayer(interaction.guildId, user.id, player);

        await interaction.reply({ content: `♻️ **${user.tag}** is no longer eliminated.`, ephemeral: true });
        await logToHost(interaction.client, `♻️ **${interaction.user.tag}** un-eliminated **${user.tag}**.`);
    },
};
