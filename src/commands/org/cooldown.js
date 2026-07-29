const { SlashCommandBuilder } = require('discord.js');
const eco = require('../../handlers/economy');
const { formatDuration } = require('../../handlers/incomeEngine');
const { logUsage } = require('../../handlers/economyLog');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('cooldown')
        .setDescription('Check your income cooldown and active perks (private).'),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({ content: 'This command can only be used in the server.', ephemeral: true });
        }

        const player = eco.getPlayer(interaction.guildId, interaction.user.id);
        const remaining = eco.cooldownRemainingMs(player);
        const reductionPct = Math.round(eco.totalReduction(player) * 100);
        const flimsyUses = (player.flimsy_wc || []).reduce((a, b) => a + b, 0);

        const lines = [];
        if (remaining > 0) {
            const unlock = Math.floor(player.cooldown.until / 1000);
            lines.push(`⏳ **Cooldown active** — set by \`/${player.cooldown.source}\`.`);
            lines.push(`Available <t:${unlock}:R> — in **${formatDuration(remaining)}**.`);
        } else {
            lines.push('✅ **No active cooldown** — you can earn bells now!');
        }
        lines.push(`Cooldown reduction: **${reductionPct}%**`);
        if (flimsyUses > 0) {
            lines.push(`Flimsy Watering Can uses remaining: **${flimsyUses}**`);
        }

        await interaction.reply({ content: lines.join('\n'), ephemeral: true });

        const state = remaining > 0
            ? `${formatDuration(remaining)} left (/${player.cooldown.source})`
            : 'no cooldown';
        await logUsage(
            interaction.client,
            `⏱️ **${interaction.user.tag}** checked \`/cooldown\` — ${state}, reduction ${reductionPct}%.`
        );
    },
};
