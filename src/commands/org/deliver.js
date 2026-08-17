const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const eco = require('../../handlers/economy');
const { getConfig, getItem, formatBells, slotCap } = require('../../config/economy');
const { ensureHost } = require('../../handlers/hostGate');
const { logToHost } = require('../../handlers/economyLog');

// Pete's Special Delivery. Moves bells and/or one item between players, deducting
// the shipping fee from the sender. Bounces if the recipient is at the slot cap.
// Silent - no public message, no DM. Logged.
module.exports = {
    data: new SlashCommandBuilder()
        .setName('deliver')
        .setDescription("Pete's delivery: move bells and/or an item between players (host only).")
        .addUserOption(o => o.setName('from').setDescription('Sender').setRequired(true))
        .addUserOption(o => o.setName('to').setDescription('Recipient').setRequired(true))
        .addIntegerOption(o => o.setName('bells').setDescription('Bells to send').setMinValue(1))
        .addStringOption(o => o.setName('item').setDescription("Item from the sender's inventory").setAutocomplete(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true);
        if (focused.name !== 'item') return interaction.respond([]);
        const from = interaction.options.getUser('from');
        if (!from) return interaction.respond([]);

        const player = eco.getPlayer(interaction.guildId, from.id);
        const unique = new Map();
        for (const inst of player.items) {
            const item = getItem(inst.id);
            if (item && !unique.has(item.id)) unique.set(item.id, item);
        }
        const query = String(focused.value).toLowerCase();
        const choices = [...unique.values()]
            .filter(item => item.name.toLowerCase().includes(query))
            .slice(0, 25)
            .map(item => ({ name: item.name, value: String(item.id) }));
        await interaction.respond(choices);
    },

    async execute(interaction) {
        if (!(await ensureHost(interaction))) return;

        const from = interaction.options.getUser('from');
        const to = interaction.options.getUser('to');
        const bells = interaction.options.getInteger('bells') || 0;
        const itemRaw = interaction.options.getString('item');

        if (from.id === to.id) {
            return interaction.reply({ content: 'Sender and recipient must be different players.', ephemeral: true });
        }
        if (!bells && !itemRaw) {
            return interaction.reply({ content: 'Nothing to deliver - provide bells, an item, or both.', ephemeral: true });
        }

        const cfg = getConfig();
        const shipping = cfg.delivery.shipping_fee;
        const fromPlayer = eco.getPlayer(interaction.guildId, from.id);
        const toPlayer = eco.getPlayer(interaction.guildId, to.id);

        // Resolve the item instance from the sender (preserve is_fake).
        let item = null;
        let instanceFake = false;
        if (itemRaw) {
            const id = Number(itemRaw);
            item = Number.isInteger(id) ? getItem(id) : null;
            if (!item) {
                return interaction.reply({ content: 'Unknown item - pick from autocomplete.', ephemeral: true });
            }
            const inst = fromPlayer.items.find(i => i.id === item.id);
            if (!inst) {
                return interaction.reply({ content: `${from} doesn't have a **${item.name}** to send.`, ephemeral: true });
            }
            instanceFake = inst.is_fake;
        }

        // Sender must cover bells + shipping.
        const cost = bells + shipping;
        if (fromPlayer.balance < cost) {
            return interaction.reply({
                content: `📦 Bounced - ${from} can't cover ${formatBells(bells)} + ${formatBells(shipping)} shipping (has ${formatBells(fromPlayer.balance)}).`,
                ephemeral: true,
            });
        }

        // Recipient slot check for an item delivery.
        if (item && item.occupies_slot) {
            const alreadyHasStackable = item.stackable && toPlayer.items.some(i => i.id === item.id);
            if (!alreadyHasStackable && eco.countSlotsUsed(toPlayer) >= slotCap()) {
                return interaction.reply({
                    content: `📦 Bounced - ${to}'s inventory is full (${slotCap()} slots).`,
                    ephemeral: true,
                });
            }
        }

        // Apply.
        eco.addBalance(fromPlayer, -cost);
        if (bells) eco.addBalance(toPlayer, bells);
        if (item) {
            eco.removeItem(fromPlayer, item.id, instanceFake);
            eco.addItem(toPlayer, item.id, instanceFake);
        }
        eco.savePlayer(interaction.guildId, from.id, fromPlayer);
        eco.savePlayer(interaction.guildId, to.id, toPlayer);

        const parts = [];
        if (bells) parts.push(formatBells(bells));
        if (item) parts.push(`**${item.name}**`);
        await interaction.reply({
            content: `📦 Delivered ${parts.join(' + ')} from ${from} to ${to}. Shipping ${formatBells(shipping)} charged to sender.`,
            ephemeral: true,
        });
        await logToHost(
            interaction.client,
            `📦 **${interaction.user.tag}** delivered ${parts.join(' + ')} from **${from.tag}** to **${to.tag}** ` +
            `(shipping ${shipping.toLocaleString('en-US')} charged to sender).`
        );
    },
};
