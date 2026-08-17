const {
    SlashCommandBuilder, PermissionFlagsBits,
    ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
} = require('discord.js');
const eco = require('../../handlers/economy');
const { getItem, getConfig } = require('../../config/economy');
const { ensureHost } = require('../../handlers/hostGate');
const { logToHost } = require('../../handlers/economyLog');
const shop = require('../../handlers/shop');
const { updatePostedShop } = require('../../handlers/shopService');

function yesNo(value) {
    return String(value).trim().toLowerCase().startsWith('y');
}

// Counts REAL instances only. Counterfeits (/counterfeit) never consumed a shop
// unit, so returning one on removal would conjure stock out of nothing.
function countById(items) {
    const map = {};
    for (const inst of items) {
        if (inst.is_fake) continue;
        map[inst.id] = (map[inst.id] || 0) + 1;
    }
    return map;
}

// Reconciles the shop pool against what actually changed in a player's inventory.
// Any finite-stock item removed goes back to the pool; any added is taken out of
// it. Unlimited items are a no-op inside consume/returnUnit. Returns a list of
// human-readable changes for the host log.
function syncStock(guildId, beforeItems, afterItems, player) {
    const flags = getConfig().flags;
    const oldCounts = countById(beforeItems);
    const newCounts = countById(afterItems);
    const changes = [];

    // Eliminated players are frozen; whether their items re-enter circulation is
    // a host call, not ours. Both switches live in config/economy.json.
    const mayReturn = flags.return_stock_on_removal !== false
        && (!player.eliminated || flags.return_stock_from_eliminated !== false);
    const mayConsume = flags.consume_stock_on_grant !== false;

    for (const idStr of new Set([...Object.keys(oldCounts), ...Object.keys(newCounts)])) {
        const id = Number(idStr);
        const item = getItem(id);
        if (!item || item.stock === null) continue;

        const delta = (oldCounts[id] || 0) - (newCounts[id] || 0);
        if (delta === 0) continue;

        // Report what the pool ACTUALLY did - return/consume clamp at the item's
        // configured stock and at zero, so the requested delta can differ.
        const unitsBefore = shop.availableUnits(guildId, id);
        if (delta > 0 && mayReturn) {
            for (let k = 0; k < delta; k++) shop.returnUnit(guildId, id);
        } else if (delta < 0 && mayConsume) {
            for (let k = 0; k < -delta; k++) shop.consumeUnit(guildId, id);
        } else {
            continue;
        }

        const moved = shop.availableUnits(guildId, id) - unitsBefore;
        if (moved > 0) {
            changes.push(`**${item.name}** +${moved} back in the pool (now ${unitsBefore + moved}/${item.stock})`);
        } else if (moved < 0) {
            changes.push(`**${item.name}** ${moved} out of the pool (now ${unitsBefore + moved}/${item.stock})`);
        } else {
            changes.push(`**${item.name}** unchanged (already ${unitsBefore}/${item.stock})`);
        }
    }
    return changes;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('editinventory')
        .setDescription("Edit a player's balance, items, and upgrades (host only).")
        .addUserOption(o => o.setName('user').setDescription('The player').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!(await ensureHost(interaction))) return;

        const user = interaction.options.getUser('user');
        const player = eco.getPlayer(interaction.guildId, user.id);
        const flimsyTotal = (player.flimsy_wc || []).reduce((a, b) => a + b, 0);

        const modal = new ModalBuilder()
            .setCustomId(`editinv_modal_${user.id}`)
            .setTitle(`Edit - ${user.username}`.slice(0, 45));

        const fields = [
            new TextInputBuilder().setCustomId('balance').setLabel('Balance')
                .setStyle(TextInputStyle.Short).setValue(String(player.balance)).setRequired(true),
            new TextInputBuilder().setCustomId('items').setLabel('Items (CSV of IDs, e.g. 13, 19, 19)')
                .setStyle(TextInputStyle.Paragraph).setValue(player.items.map(i => i.id).join(', ')).setRequired(false),
            new TextInputBuilder().setCustomId('flimsy').setLabel('Flimsy WC uses remaining')
                .setStyle(TextInputStyle.Short).setValue(String(flimsyTotal)).setRequired(false),
            new TextInputBuilder().setCustomId('golden').setLabel('Golden Watering Can (yes/no)')
                .setStyle(TextInputStyle.Short).setValue(player.reductions.golden_wc ? 'yes' : 'no').setRequired(true),
            new TextInputBuilder().setCustomId('watering').setLabel('Watering Can (yes/no)')
                .setStyle(TextInputStyle.Short).setValue(player.reductions.watering_can ? 'yes' : 'no').setRequired(true),
        ];
        modal.addComponents(...fields.map(f => new ActionRowBuilder().addComponents(f)));

        await interaction.showModal(modal);
    },

    async handleModalSubmit(interaction) {
        // Guard: modal is also host-gated (the /editinventory that opened it was).
        if (!(await ensureHost(interaction))) return;

        const userId = interaction.customId.replace('editinv_modal_', '');
        const player = eco.getPlayer(interaction.guildId, userId);
        const before = JSON.parse(JSON.stringify(player));

        // Balance
        const balRaw = interaction.fields.getTextInputValue('balance').trim();
        const bal = parseInt(balRaw, 10);
        if (!Number.isNaN(bal)) player.balance = bal;

        // Items - rebuild from CSV, preserving fakes by id where they existed.
        const csv = interaction.fields.getTextInputValue('items').trim();
        const newIds = csv.length
            ? csv.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && getItem(n))
            : [];
        const fakePool = {};
        for (const inst of before.items) if (inst.is_fake) fakePool[inst.id] = (fakePool[inst.id] || 0) + 1;
        const newItems = newIds.map(id => {
            if (fakePool[id] > 0) { fakePool[id] -= 1; return { id, is_fake: true }; }
            return { id, is_fake: false };
        });

        // Put removed items back in the shop pool (and take added ones out).
        const stockChanges = syncStock(interaction.guildId, before.items, newItems, player);
        player.items = newItems;

        // Flimsy - a single combined counter (the modal is one field).
        const flimsy = parseInt(interaction.fields.getTextInputValue('flimsy').trim(), 10);
        player.flimsy_wc = !Number.isNaN(flimsy) && flimsy > 0 ? [flimsy] : [];

        // Upgrade toggles
        player.reductions.golden_wc = yesNo(interaction.fields.getTextInputValue('golden'));
        player.reductions.watering_can = yesNo(interaction.fields.getTextInputValue('watering'));

        eco.savePlayer(interaction.guildId, userId, player);

        // Tell the host exactly what the shop pool did - the old silent behaviour
        // is what made removals feel like they vanished into the void.
        const stockNote = stockChanges.length
            ? `\n📦 Shop stock: ${stockChanges.join(', ')}.`
            : '';
        await interaction.reply({
            content: `✅ Updated inventory for <@${userId}>.${stockNote}`,
            ephemeral: true,
        });

        // Keep the posted shop honest - otherwise a returned item still reads
        // SOLD OUT while /buy will happily sell it.
        if (stockChanges.length) {
            await updatePostedShop(interaction.client, interaction.guildId).catch(() => {});
        }

        const fmtItems = arr => arr.map(i => i.id + (i.is_fake ? 'f' : '')).join(', ') || '(none)';
        await logToHost(
            interaction.client,
            `✏️ **${interaction.user.tag}** edited **<@${userId}>**:\n` +
            `• Balance: ${before.balance.toLocaleString('en-US')} → ${player.balance.toLocaleString('en-US')}\n` +
            `• Items: [${fmtItems(before.items)}] → [${fmtItems(player.items)}]\n` +
            `• Golden WC: ${before.reductions.golden_wc} → ${player.reductions.golden_wc}\n` +
            `• Watering Can: ${before.reductions.watering_can} → ${player.reductions.watering_can}\n` +
            `• Flimsy uses: ${(before.flimsy_wc || []).reduce((a, b) => a + b, 0)} → ${(player.flimsy_wc || []).reduce((a, b) => a + b, 0)}` +
            (stockChanges.length ? `\n• Shop stock: ${stockChanges.join(', ')}` : '')
        );
    },
};
