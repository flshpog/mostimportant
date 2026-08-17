const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const eco = require('../../handlers/economy');
const { formatBells } = require('../../config/economy');
const { ensureHost } = require('../../handlers/hostGate');

// Host overview of every player's balance, sorted high to low. Private + host-gated
// because balances are secret (only players who've used the economy appear).
module.exports = {
    data: new SlashCommandBuilder()
        .setName('balances')
        .setDescription("View every player's bell balance (host only).")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        if (!(await ensureHost(interaction))) return;

        const rows = Object.entries(eco.allPlayers(interaction.guildId))
            .map(([id, p]) => ({ id, balance: p.balance, eliminated: p.eliminated }))
            .sort((a, b) => b.balance - a.balance);

        if (rows.length === 0) {
            return interaction.reply({ content: 'No players have a balance yet.', ephemeral: true });
        }

        const total = rows.reduce((sum, r) => sum + r.balance, 0);
        const header = `💰 **Player Balances** (${rows.length} players · total ${formatBells(total)})\n`;
        const lines = rows.map(
            (r, i) => `**${i + 1}.** <@${r.id}> - ${formatBells(r.balance)}${r.eliminated ? ' ☠️' : ''}`
        );

        // Chunk to Discord's message limit; all messages are private to the host.
        const chunks = [];
        let buf = header;
        for (const line of lines) {
            if ((buf + line + '\n').length > 1900) { chunks.push(buf); buf = ''; }
            buf += line + '\n';
        }
        if (buf.trim()) chunks.push(buf);

        await interaction.reply({ content: chunks[0], ephemeral: true, allowedMentions: { parse: [] } });
        for (let i = 1; i < chunks.length; i++) {
            await interaction.followUp({ content: chunks[i], ephemeral: true, allowedMentions: { parse: [] } });
        }
    },
};
