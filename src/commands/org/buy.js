const { SlashCommandBuilder } = require('discord.js');
const eco = require('../../handlers/economy');
const { getConfig, formatBells, slotCap } = require('../../config/economy');
const { getBuyableItems, consumeUnit } = require('../../handlers/shop');
const { logToHost, hostPing, logUsage } = require('../../handlers/economyLog');

// Permanent-reduction upgrade items → the player.reductions flag they set.
const REDUCTION_FLAG_BY_ITEM = { 12: 'golden_wc', 20: 'watering_can' };
const FLIMSY_WC_ID = 24;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('buy')
        .setDescription('Buy an item from the shop (private).')
        .addStringOption(option =>
            option.setName('item')
                .setDescription('The item to buy')
                .setRequired(true)
                .setAutocomplete(true)),

    // Autocomplete + validation both read getBuyableItems — the single source of
    // truth for what's purchasable. Never hardcode the buyable set here.
    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const choices = getBuyableItems(interaction.guildId, interaction.user.id)
            .filter(item => item.name.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(item => ({
                name: `${item.name} — ${item.price.toLocaleString('en-US')} Bells`,
                value: String(item.id),
            }));
        await interaction.respond(choices);
    },

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'This command can only be used in the server.', ephemeral: true });
        }

        const cfg = getConfig();
        const buyable = getBuyableItems(interaction.guildId, interaction.user.id);
        const raw = interaction.options.getString('item').trim();

        // Resolve by id (autocomplete value) or by typed name — but only within the
        // buyable set, so players can never buy something they weren't shown.
        let item = null;
        const asId = Number(raw);
        if (Number.isInteger(asId)) item = buyable.find(i => i.id === asId) || null;
        if (!item) item = buyable.find(i => i.name.toLowerCase() === raw.toLowerCase()) || null;
        if (!item) {
            return interaction.reply({ content: "That item isn't available to buy right now.", ephemeral: true });
        }

        await logUsage(interaction.client, `🛒 **${interaction.user.tag}** ran \`/buy\` for **${item.name}**.`);

        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        const player = eco.getPlayer(guildId, userId);
        const isTester = eco.isTester(player);
        const reductionFlag = REDUCTION_FLAG_BY_ITEM[item.id];

        // Testers bypass every restriction (see /twisttester).
        if (!isTester) {
            if (eco.isEliminated(player)) {
                return interaction.reply({ content: "You've been eliminated — you can't buy anything.", ephemeral: true });
            }

            if (item.once_per_player && player.bought_once.includes(item.id)) {
                return interaction.reply({ content: `You can only buy **${item.name}** once.`, ephemeral: true });
            }

            if (reductionFlag && player.reductions[reductionFlag]) {
                return interaction.reply({ content: `You already own the **${item.name}** upgrade.`, ephemeral: true });
            }

            if (player.balance < item.price) {
                return interaction.reply({
                    content: `You can't afford **${item.name}** — it costs ${formatBells(item.price)}, and you have ${formatBells(player.balance)}.`,
                    ephemeral: true,
                });
            }

            // Slot cap — hard block. Stackable item you already own adds no slot.
            if (item.occupies_slot) {
                const alreadyHasStackable = item.stackable && player.items.some(i => i.id === item.id);
                if (!alreadyHasStackable && eco.countSlotsUsed(player) >= slotCap()) {
                    return interaction.reply({
                        content: `Your inventory is full (${slotCap()} slots). Free a slot before buying.`,
                        ephemeral: true,
                    });
                }
            }
        }

        // NOTE: finite-stock enforcement arrives with the shop state machine
        // (Phase 4). Cabinet items are unlimited, so nothing to check here yet.

        // Apply the purchase. Testers buy free.
        if (!isTester) eco.addBalance(player, -item.price);
        if (item.id === FLIMSY_WC_ID) {
            player.flimsy_wc.push(cfg.reductions.flimsy_wc_uses);
        } else if (reductionFlag) {
            player.reductions[reductionFlag] = true;
        } else {
            eco.addItem(player, item.id, false);
        }
        if (item.once_per_player && !player.bought_once.includes(item.id)) {
            player.bought_once.push(item.id);
        }
        eco.savePlayer(guildId, userId, player);

        // Deplete shop stock (no-op for unlimited items; testers don't deplete).
        if (!isTester) consumeUnit(guildId, item.id);

        // Silent to players — ephemeral only, no public message.
        await interaction.reply({
            content:
                `✅ You bought **${item.name}** for ${formatBells(item.price)}!\n` +
                `Your balance is now ${formatBells(player.balance)}.\n\n` +
                `*Production will be with you shortly.*`,
            ephemeral: true,
        });

        // Ping the hosts so they can deliver the advantage writeup.
        const ping = hostPing();
        await logToHost(interaction.client, {
            content:
                `${ping ? ping + ' ' : ''}🛒 **${interaction.user.tag}** (${userId}) bought ` +
                `**${item.name}** (ID ${item.id}) for ${item.price.toLocaleString('en-US')} bells. ` +
                `Balance: ${player.balance.toLocaleString('en-US')}.`,
            allowedMentions: { parse: ['roles'] },
        });
    },
};
