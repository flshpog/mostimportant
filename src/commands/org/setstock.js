const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getConfig, getItem } = require('../../config/economy');
const shop = require('../../handlers/shop');
const { updatePostedShop } = require('../../handlers/shopService');
const { ensureHost } = require('../../handlers/hostGate');
const { logToHost } = require('../../handlers/economyLog');

// Manual per-item stock control - the escape hatch for cases /syncstock can't
// infer, e.g. holding a unit back on purpose, or an item that exists in a
// player's hands without ever having been sold.
module.exports = {
    data: new SlashCommandBuilder()
        .setName('setstock')
        .setDescription('Set how many units of one item are available to sell (host only).')
        .addStringOption(o => o.setName('item')
            .setDescription('The item to adjust')
            .setRequired(true)
            .setAutocomplete(true))
        .addIntegerOption(o => o.setName('units')
            .setDescription('Units available (0 = sold out; capped at the item\'s configured stock)')
            .setRequired(true)
            .setMinValue(0))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    // Finite-stock items only - unlimited ones have nothing to set. Current
    // availability is shown inline so hosts pick against real numbers.
    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const choices = getConfig().items
            .filter(item => item.stock !== null && item.name.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(item => ({
                name: `${item.name} (ID ${item.id}) - ${shop.availableUnits(interaction.guildId, item.id)}/${item.stock} left`,
                value: String(item.id),
            }));
        await interaction.respond(choices);
    },

    async execute(interaction) {
        if (!(await ensureHost(interaction))) return;

        const raw = interaction.options.getString('item').trim();
        const requested = interaction.options.getInteger('units');

        // Resolve by ID (the autocomplete value) or by typed name, so a host who
        // types a name instead of picking still lands on the right item.
        const asId = Number(raw);
        let item = Number.isInteger(asId) ? getItem(asId) : null;
        if (!item) {
            item = getConfig().items.find(i => i.name.toLowerCase() === raw.toLowerCase()) || null;
        }
        if (!item) {
            return interaction.reply({ content: 'Unknown item - pick one from autocomplete.', ephemeral: true });
        }
        if (item.stock === null) {
            return interaction.reply({
                content: `**${item.name}** has unlimited stock - there's nothing to set. It's always available.`,
                ephemeral: true,
            });
        }

        const before = shop.availableUnits(interaction.guildId, item.id);
        const after = shop.setUnits(interaction.guildId, item.id, requested);

        // Keep the posted shop honest - otherwise it keeps reading SOLD OUT while
        // /buy sells happily from the new number.
        await updatePostedShop(interaction.client, interaction.guildId).catch(() => {});

        const capped = requested > item.stock
            ? `\n⚠️ Capped at **${item.stock}** - that's this item's \`stock\` in \`config/economy.json\`.`
            : '';

        await interaction.reply({
            content:
                `✅ **${item.name}** (ID ${item.id}) stock: **${before}** → **${after}** of ${item.stock}.` +
                capped +
                (after > 0 ? '\nIt can be slotted into a rotation and bought.' : '\nIt is now sold out.'),
            ephemeral: true,
        });

        await logToHost(
            interaction.client,
            `📦 **${interaction.user.tag}** set stock for **${item.name}** (ID ${item.id}): ${before} → ${after} of ${item.stock}.`
        );
    },
};
