const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const eco = require('../../handlers/economy');
const { getItem, formatBells } = require('../../config/economy');
const { ensureHost } = require('../../handlers/hostGate');

const AC_GREEN = 0x7CBB3F;

// Full host view - unlike /inventory, this DOES reveal is_fake, permanents, the
// Flimsy counter, elimination and tester status.
module.exports = {
    data: new SlashCommandBuilder()
        .setName('viewinventory')
        .setDescription("View a player's full inventory, host-side (host only).")
        .addUserOption(o => o.setName('user').setDescription('The player').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!(await ensureHost(interaction))) return;

        const user = interaction.options.getUser('user');
        const player = eco.getPlayer(interaction.guildId, user.id);

        const itemLines = player.items.length
            ? player.items.map(inst => {
                const item = getItem(inst.id);
                const name = item ? item.name : `Unknown (${inst.id})`;
                return `• ${name} (ID ${inst.id})${inst.is_fake ? ' - ⚠️ FAKE' : ''}`;
            }).join('\n')
            : '*Empty*';

        const perks = [];
        if (player.reductions.golden_wc) perks.push('Golden Watering Can (−50%)');
        if (player.reductions.watering_can) perks.push('Watering Can (−25%)');
        const flimsyUses = (player.flimsy_wc || []).reduce((a, b) => a + b, 0);
        perks.push(`Flimsy WC counters: [${(player.flimsy_wc || []).join(', ')}] (${flimsyUses} total uses)`);

        const status = [];
        if (player.eliminated) status.push('☠️ Eliminated');
        if (player.tester) status.push('🧪 Tester');
        status.push(`Slots used: ${eco.countSlotsUsed(player)}`);
        status.push(`Total reduction: ${Math.round(eco.totalReduction(player) * 100)}%`);
        if (player.cooldown) {
            status.push(`Cooldown: /${player.cooldown.source} until <t:${Math.floor(player.cooldown.until / 1000)}:f>`);
        }

        const embed = new EmbedBuilder()
            .setColor(AC_GREEN)
            .setTitle(`🔎 Inventory - ${user.tag}`)
            .setDescription(`**Balance:** ${formatBells(player.balance)}`)
            .addFields(
                { name: 'Items', value: itemLines },
                { name: 'Upgrades', value: perks.join('\n') },
                { name: 'Status', value: status.join('\n') }
            );

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
