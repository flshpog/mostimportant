const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const eco = require('../../handlers/economy');
const { formatBells } = require('../../config/economy');

// Balance testers get topped up to, so they can buy anything even outside tester
// free-purchase (and see a healthy number in /inventory).
const TESTER_BALANCE = 1000000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('twisttester')
        .setDescription('Toggle god-mode test access for a user (staff only).')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Grant or revoke tester access')
                .setRequired(true)
                .addChoices(
                    { name: 'add', value: 'add' },
                    { name: 'remove', value: 'remove' }
                ))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to toggle')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'This command can only be used in the server.', ephemeral: true });
        }

        const action = interaction.options.getString('action');
        const user = interaction.options.getUser('user');
        const player = eco.getPlayer(interaction.guildId, user.id);

        if (action === 'add') {
            eco.setTester(player, true);
            eco.clearCooldown(player);
            if (player.balance < TESTER_BALANCE) eco.setBalance(player, TESTER_BALANCE);
            eco.savePlayer(interaction.guildId, user.id, player);
            return interaction.reply({
                content:
                    `🧪 **${user.tag}** is now a **tester** - no cooldowns, every item buyable, ` +
                    `free purchases, no slot cap. Balance topped to ${formatBells(player.balance)}.`,
                ephemeral: true,
            });
        }

        eco.setTester(player, false);
        eco.savePlayer(interaction.guildId, user.id, player);
        return interaction.reply({
            content:
                `🧪 **${user.tag}** is no longer a tester. ` +
                `(Balance and items are left as-is - delete \`data/economy.json\` to fully wipe.)`,
            ephemeral: true,
        });
    },
};
