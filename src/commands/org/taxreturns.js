const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const eco = require('../../handlers/economy');
const { getItem, formatBells } = require('../../config/economy');
const { ensureHost } = require('../../handlers/hostGate');

// ⚠️ NON-EPHEMERAL by request, and it dumps every ownership relationship in the
// game. The host-category gate is the ONLY thing between this and a player
// channel - if it ever fails open, the season is over. ensureHost first, always.
module.exports = {
    data: new SlashCommandBuilder()
        .setName('taxreturns')
        .setDescription('Every item owned by every player - host reference (host only, NON-EPHEMERAL).')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        // Gate BEFORE anything is shown. ensureHost rejects ephemerally off-category.
        if (!(await ensureHost(interaction))) return;

        const players = eco.allPlayers(interaction.guildId);
        const entries = Object.entries(players);

        const lines = ['# 📒 Nook Family Tax Returns', ''];
        let anyOwned = false;
        for (const [userId, player] of entries) {
            const owned = [];
            for (const inst of player.items) {
                const item = getItem(inst.id);
                owned.push(`${item ? item.name : `Unknown(${inst.id})`}${inst.is_fake ? ' (fake)' : ''}`);
            }
            if (player.reductions.golden_wc) owned.push('Golden Watering Can');
            if (player.reductions.watering_can) owned.push('Watering Can');
            const flimsy = (player.flimsy_wc || []).reduce((a, b) => a + b, 0);
            if (flimsy > 0) owned.push(`Flimsy WC (${flimsy})`);

            if (owned.length === 0) continue;
            anyOwned = true;
            lines.push(`**<@${userId}>** - ${formatBells(player.balance)}${player.eliminated ? ' ☠️' : ''}`);
            lines.push(owned.map(o => `• ${o}`).join('\n'));
            lines.push('');
        }
        if (!anyOwned) lines.push('*No items owned yet.*');

        // Chunk to Discord's 2000-char limit. First chunk is the (non-ephemeral) reply.
        const chunks = [];
        let buf = '';
        for (const line of lines) {
            if ((buf + line + '\n').length > 1900) { chunks.push(buf); buf = ''; }
            buf += line + '\n';
        }
        if (buf.trim()) chunks.push(buf);

        await interaction.reply({ content: chunks[0], allowedMentions: { parse: [] } });
        for (let i = 1; i < chunks.length; i++) {
            await interaction.followUp({ content: chunks[i], allowedMentions: { parse: [] } });
        }
    },
};
