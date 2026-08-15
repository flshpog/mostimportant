const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const eco = require('../../handlers/economy');
const { getConfig, itemsByCategory } = require('../../config/economy');
const { availableUnits } = require('../../handlers/shop');
const { ensureHost } = require('../../handlers/hostGate');

const AC_GREEN = 0x7CBB3F;

// Watering cans aren't stored as item instances — they're player.reductions flags
// (12, 20) and a use-counter array (24). Same IDs buy.js uses to apply them.
const GOLDEN_WC_ID = 12;
const WATERING_CAN_ID = 20;
const FLIMSY_WC_ID = 24;

// Rotation categories, paired with the config key holding their slot count.
// Cabinet has no rotation slots — it's always-on, so `slots` is null.
const CATEGORIES = [
    { key: 'special', label: '⭐ Store Specials', slots: 'specials' },
    { key: 'golden', label: '🌟 Golden Tools', slots: 'golden' },
    { key: 'standard', label: '🔨 Standard Tools', slots: 'standard' },
    { key: 'cabinet', label: '🗄️ Cabinet', slots: null },
];

// How many of each item ID players currently hold, split real vs fake. Fakes are
// conjured by /counterfeit and never consumed stock, so they're excluded from the
// reconciliation math — otherwise a counterfeit would mask a burned unit.
function heldCounts(guildId) {
    const real = {};
    const fake = {};
    for (const player of Object.values(eco.allPlayers(guildId))) {
        for (const inst of player.items) {
            const bucket = inst.is_fake ? fake : real;
            bucket[inst.id] = (bucket[inst.id] || 0) + 1;
        }
        if (player.reductions.golden_wc) real[GOLDEN_WC_ID] = (real[GOLDEN_WC_ID] || 0) + 1;
        if (player.reductions.watering_can) real[WATERING_CAN_ID] = (real[WATERING_CAN_ID] || 0) + 1;
        if ((player.flimsy_wc || []).length > 0) {
            real[FLIMSY_WC_ID] = (real[FLIMSY_WC_ID] || 0) + (player.flimsy_wc || []).length;
        }
    }
    return { real, fake };
}

// One item line: stock left, who's holding it, and why it might be stuck.
function itemLine(guildId, item, held) {
    const left = availableUnits(guildId, item.id);
    const realHeld = held.real[item.id] || 0;
    const fakeHeld = held.fake[item.id] || 0;

    let stock;
    if (left === Infinity) {
        stock = '∞ unlimited';
    } else if (left <= 0) {
        stock = `**SOLD OUT** (0/${item.stock})`;
    } else {
        stock = `${left}/${item.stock} left`;
    }

    const notes = [];
    if (item.enabled === false) notes.push('🚫 disabled');
    if (item.refreshes) notes.push('♻️ shown as "Refreshes" in the shop');
    // No stock left and nobody is holding one — the unit went out and never came
    // back. Since /editinventory now returns items automatically, this should only
    // appear for stock lost before that fix, or with the return flags turned off.
    if (left !== Infinity && left <= 0 && realHeld === 0) notes.push('⚠️ **burned** — nobody holds it');
    if (fakeHeld > 0) notes.push(`🎭 ${fakeHeld} fake in play`);

    const holding = realHeld > 0 ? ` · held by ${realHeld}` : '';
    const suffix = notes.length ? ` · ${notes.join(' · ')}` : '';
    return `• **${item.name}** (ID ${item.id}) — ${stock}${holding}${suffix}`;
}

// Discord caps an embed field at 1024 chars — split long categories across
// continuation fields rather than dropping items silently.
function pushField(fields, name, lines) {
    const chunks = [];
    let buf = '';
    for (const line of lines) {
        if ((buf + line + '\n').length > 1000) { chunks.push(buf); buf = ''; }
        buf += line + '\n';
    }
    if (buf.trim()) chunks.push(buf);
    if (chunks.length === 0) chunks.push('*No items in this category.*');
    chunks.forEach((chunk, i) => {
        fields.push({ name: i === 0 ? name : `${name} (cont.)`, value: chunk });
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stockcheck')
        .setDescription('Stock status of every shop item, and what can still be rotated (host only).')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!(await ensureHost(interaction))) return;

        const guildId = interaction.guildId;
        const cfg = getConfig();
        const held = heldCounts(guildId);

        const fields = [];
        const warnings = [];

        for (const category of CATEGORIES) {
            const items = itemsByCategory(category.key);
            // Mirrors shop.offerableItems() — what a random rotation can draw from.
            const offerable = items.filter(
                item => item.enabled !== false && availableUnits(guildId, item.id) > 0
            );

            let header = category.label;
            if (category.slots) {
                const needed = cfg.rotation[category.slots];
                header += ` — ${offerable.length} offerable / ${needed} slot${needed === 1 ? '' : 's'}`;
                if (offerable.length < needed) {
                    header += ' ⚠️';
                    warnings.push(
                        `**${category.label}**: only ${offerable.length} item${offerable.length === 1 ? '' : 's'} ` +
                        `available for ${needed} slots — a random rotation will post ${offerable.length} instead of ${needed}.`
                    );
                }
            } else {
                header += ` — ${offerable.length} offerable (always in shop)`;
            }

            pushField(fields, header, items.map(item => itemLine(guildId, item, held)));
        }

        const embed = new EmbedBuilder()
            .setColor(AC_GREEN)
            .setTitle('📦 Shop Stock Check')
            .setDescription(
                warnings.length
                    ? `⚠️ **Rotations will under-fill:**\n${warnings.map(w => `• ${w}`).join('\n')}`
                    : '✅ Every category has enough stock to fill its rotation slots.'
            )
            .addFields(fields)
            .setFooter({
                text: 'Removing an item in /editinventory returns it to the pool automatically; adding one '
                    + 'takes it out. /restockshop resets everything. Testers do not deplete stock.',
            });

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
