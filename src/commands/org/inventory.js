const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const eco = require('../../handlers/economy');
const { getConfig, getItem, formatBells } = require('../../config/economy');
const { getPlayerRoles } = require('../../handlers/playerRoles');
const { logUsage } = require('../../handlers/economyLog');

const AC_GREEN = 0x7CBB3F;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('inventory')
        .setDescription('View your bells, items, and perks (private).'),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'This command can only be used in the server.', ephemeral: true });
        }

        // Gate on the player role list from /initializeplayerroles.
        const playerRoleIds = getPlayerRoles(interaction.guildId);
        const isPlayer = playerRoleIds.some(id => interaction.member.roles.cache.has(id));
        if (!isPlayer) {
            return interaction.reply({ content: 'Only players can use this command.', ephemeral: true });
        }

        const cfg = getConfig();
        const player = eco.getPlayer(interaction.guildId, interaction.user.id);

        // List one line per non-stackable instance (so duplicates — incl. hidden
        // counterfeits — each show, with NO fake marker); aggregate stackables.
        const singleLines = [];
        const stackCounts = new Map();
        for (const inst of player.items) {
            const item = getItem(inst.id);
            if (!item) continue;
            if (item.stackable) {
                stackCounts.set(item.id, (stackCounts.get(item.id) || 0) + 1);
            } else {
                singleLines.push(item.name);
            }
        }
        const itemLines = [...singleLines];
        for (const [id, count] of stackCounts) {
            const item = getItem(id);
            itemLines.push(count > 1 ? `${item.name} ×${count}` : item.name);
        }

        const perks = [];
        if (player.reductions.golden_wc) perks.push('Golden Watering Can (−50%)');
        if (player.reductions.watering_can) perks.push('Watering Can (−25%)');
        const flimsyUses = (player.flimsy_wc || []).reduce((a, b) => a + b, 0);
        if (flimsyUses > 0) {
            perks.push(`Flimsy Watering Can (−10%, ${flimsyUses} use${flimsyUses === 1 ? '' : 's'} left)`);
        }

        const slotsUsed = eco.countSlotsUsed(player);
        const embed = new EmbedBuilder()
            .setColor(AC_GREEN)
            .setTitle('🌴 Your Inventory')
            .setDescription(`**Balance:** ${formatBells(player.balance)}`)
            .addFields(
                {
                    name: `Items (${slotsUsed}/${cfg.inventory.slot_cap} slots)`,
                    value: itemLines.length ? itemLines.join('\n') : '*Empty*',
                },
                {
                    name: 'Active Perks',
                    value: perks.length ? perks.join('\n') : '*None*',
                }
            );
        if (player.eliminated) embed.setFooter({ text: 'You have been eliminated.' });

        await interaction.reply({ embeds: [embed], ephemeral: true });

        await logUsage(
            interaction.client,
            `📖 **${interaction.user.tag}** checked \`/inventory\` — ` +
            `balance ${player.balance.toLocaleString('en-US')}, ${slotsUsed}/${cfg.inventory.slot_cap} slots.`
        );
    },
};
