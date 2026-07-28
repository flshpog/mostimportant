const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const eco = require('../../handlers/economy');
const { getConfig, getItem } = require('../../config/economy');
const { ensureHost } = require('../../handlers/hostGate');
const { logToHost } = require('../../handlers/economyLog');

// Places a FAKE item instance in a player's inventory (Redd's Counterfeit). It is
// indistinguishable from a real one in /inventory — only /viewinventory shows the
// flag. Host override: no slot-cap or affordability checks.
module.exports = {
    data: new SlashCommandBuilder()
        .setName('counterfeit')
        .setDescription('Place a fake item in a player\'s inventory (host only).')
        .addUserOption(o => o.setName('user').setDescription('The player').setRequired(true))
        .addStringOption(o => o.setName('item').setDescription('The item to fake').setRequired(true).setAutocomplete(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const choices = getConfig().items
            .filter(item => item.name.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(item => ({ name: `${item.name} (ID ${item.id})`, value: String(item.id) }));
        await interaction.respond(choices);
    },

    async execute(interaction) {
        if (!(await ensureHost(interaction))) return;

        const user = interaction.options.getUser('user');
        const raw = interaction.options.getString('item').trim();
        const id = Number(raw);
        const item = Number.isInteger(id) ? getItem(id) : getItem(NaN);
        if (!item) {
            return interaction.reply({ content: 'Unknown item — pick one from autocomplete.', ephemeral: true });
        }

        const player = eco.getPlayer(interaction.guildId, user.id);
        eco.addItem(player, item.id, true);
        eco.savePlayer(interaction.guildId, user.id, player);

        await interaction.reply({
            content: `🎭 Placed a **fake ${item.name}** in ${user}'s inventory. It looks identical to the real thing.`,
            ephemeral: true,
        });
        await logToHost(interaction.client, `🎭 **${interaction.user.tag}** counterfeited a **${item.name}** (ID ${item.id}) into **${user.tag}**'s inventory.`);
    },
};
