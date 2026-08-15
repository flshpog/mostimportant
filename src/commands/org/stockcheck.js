const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const eco = require('../../handlers/economy');
const { getConfig, itemsByCategory } = require('../../config/economy');
const { availableUnits } = require('../../handlers/shop');
const { ensureHost } = require('../../handlers/hostGate');

const AC_GREEN = 0x7CBB3F;

// Rotation categories, paired with the config key holding their slot count.
// Cabinet has no rotation slots — it's always-on, so `slots` is null.
const CATEGORIES = [
    { key: 'special', label: '⭐ Store Specials', slots: 'specials' },
    { key: 'golden', label: '🌟 Golden Tools', slots: 'golden' },
    { key: 'standard', label: '🔨 Standard Tools', slots: 'standard' },
    { key: 'cabinet', label: '🗄️ Cabinet', slots: null },
];

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
    // Available stock should always be `stock - copies actually held`. Anything
    // else is drift — units burned before removals returned to the pool, or data
    // edited by hand. /syncstock recomputes it from inventories.
    const expected = item.stock === null ? null : Math.max(0, item.stock - realHeld);
    const drifted = expected !== null && left !== expected;
    if (drifted) notes.push(`🔧 **out of sync** — should be ${expected}`);
    if (fakeHeld > 0) notes.push(`🎭 ${fakeHeld} fake in play`);

    const holding = realHeld > 0 ? ` · held by ${realHeld}` : '';
    const suffix = notes.length ? ` · ${notes.join(' · ')}` : '';
    return { line: `• **${item.name}** (ID ${item.id}) — ${stock}${holding}${suffix}`, drifted };
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
        const held = eco.heldItemCounts(guildId);

        const fields = [];
        const warnings = [];
        let driftCount = 0;

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

            const rendered = items.map(item => itemLine(guildId, item, held));
            driftCount += rendered.filter(r => r.drifted).length;
            pushField(fields, header, rendered.map(r => r.line));
        }

        if (driftCount > 0) {
            warnings.unshift(
                `**${driftCount} item${driftCount === 1 ? '' : 's'} out of sync** with what players ` +
                'actually hold — run `/syncstock` to correct them (or `/syncstock preview:true` first).'
            );
        }

        const embed = new EmbedBuilder()
            .setColor(AC_GREEN)
            .setTitle('📦 Shop Stock Check')
            .setDescription(
                warnings.length
                    ? `⚠️ **Needs attention:**\n${warnings.map(w => `• ${w}`).join('\n')}`
                    : '✅ Stock matches player inventories, and every category can fill its rotation slots.'
            )
            .addFields(fields)
            .setFooter({
                text: 'Removing an item in /editinventory returns it to the pool automatically; adding one '
                    + 'takes it out. /restockshop resets everything. Testers do not deplete stock.',
            });

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
