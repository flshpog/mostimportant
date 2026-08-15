const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const eco = require('../../handlers/economy');
const { getConfig } = require('../../config/economy');
const shop = require('../../handlers/shop');
const { updatePostedShop } = require('../../handlers/shopService');
const { ensureHost } = require('../../handlers/hostGate');
const { logToHost } = require('../../handlers/economyLog');

const AC_GREEN = 0x7CBB3F;

// Recomputes every finite-stock item from the truth on the ground:
//
//     available = configured stock - copies actually held by players
//
// This is the same rule /editinventory now maintains as edits happen, applied
// retroactively. Use it once to clear drift from before removals returned stock,
// or any time hand-edited data has pulled the shop out of alignment.
//
// Counterfeits are excluded — they never consumed a unit, so counting them would
// invent scarcity. Eliminated players DO count: they still hold the item.
module.exports = {
    data: new SlashCommandBuilder()
        .setName('syncstock')
        .setDescription('Match shop stock to what players actually hold (host only).')
        .addBooleanOption(o => o.setName('preview')
            .setDescription('Show what would change without changing it'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!(await ensureHost(interaction))) return;

        const guildId = interaction.guildId;
        const preview = interaction.options.getBoolean('preview') || false;
        const held = eco.heldItemCounts(guildId);

        const changed = [];
        const unchanged = [];
        for (const item of getConfig().items) {
            if (item.stock === null) continue; // unlimited — nothing to reconcile

            const inCirculation = held.real[item.id] || 0;
            const target = Math.max(0, Math.min(item.stock, item.stock - inCirculation));
            const current = shop.availableUnits(guildId, item.id);
            const row = { item, current, target, inCirculation };

            if (current === target) {
                unchanged.push(row);
                continue;
            }
            if (!preview) shop.setUnits(guildId, item.id, target);
            changed.push(row);
        }

        const fmt = r =>
            `• **${r.item.name}** (ID ${r.item.id}) — ${r.current} → **${r.target}**` +
            ` of ${r.item.stock}  ·  ${r.inCirculation} held`;

        const embed = new EmbedBuilder()
            .setColor(AC_GREEN)
            .setTitle(preview ? '🔍 Stock Sync — Preview' : '🔄 Stock Synced')
            .setDescription(
                changed.length
                    ? (preview
                        ? `**${changed.length}** item(s) would change. Run without \`preview\` to apply.`
                        : `**${changed.length}** item(s) corrected.`)
                    : '✅ Shop stock already matches what players hold. Nothing to change.'
            );

        if (changed.length) {
            // One field, chunked — the registry is small but a full drift could be long.
            const lines = changed.map(fmt);
            let buf = '';
            const chunks = [];
            for (const line of lines) {
                if ((buf + line + '\n').length > 1000) { chunks.push(buf); buf = ''; }
                buf += line + '\n';
            }
            if (buf.trim()) chunks.push(buf);
            chunks.forEach((chunk, i) => {
                embed.addFields({ name: i === 0 ? 'Corrected' : 'Corrected (cont.)', value: chunk });
            });
        }
        embed.setFooter({
            text: `${unchanged.length} item(s) already correct. Counterfeits are ignored; `
                + 'items held by eliminated players still count as in circulation.',
        });

        await interaction.reply({ embeds: [embed], ephemeral: true });

        if (changed.length && !preview) {
            await updatePostedShop(interaction.client, guildId).catch(() => {});
            await logToHost(
                interaction.client,
                `🔄 **${interaction.user.tag}** ran \`/syncstock\` — ${changed.length} item(s) corrected:\n` +
                changed.map(r => `• ${r.item.name} (ID ${r.item.id}): ${r.current} → ${r.target}`).join('\n')
            );
        }
    },
};
