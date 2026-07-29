const { runIncome, formatDuration } = require('./incomeEngine');
const { getConfig, formatBells } = require('../config/economy');
const { logUsage } = require('./economyLog');

// Shared executor for /rock /tree /bottle — the commands differ only by `key`.
async function executeIncome(interaction, key) {
    if (!interaction.inGuild()) {
        return interaction.reply({ content: 'This command can only be used in the server.', ephemeral: true });
    }

    const cfg = getConfig();
    const incomeCfg = cfg.income[key];
    const tag = interaction.user.tag;
    const result = runIncome(interaction.guildId, interaction.user.id, key);

    if (result.status === 'eliminated') {
        await interaction.reply({
            content: "You've been eliminated — you can no longer earn bells.",
            ephemeral: true,
        });
        await logUsage(interaction.client, `🚫 **${tag}** ran \`/${key}\` — blocked (eliminated).`);
        return;
    }

    if (result.status === 'cooldown') {
        const unlock = Math.floor(result.untilMs / 1000);
        await interaction.reply({
            content:
                `⏳ You're on cooldown (set by **/${result.source}**).\n` +
                `Available <t:${unlock}:R> — in **${formatDuration(result.remainingMs)}**.`,
            ephemeral: true,
        });
        await logUsage(
            interaction.client,
            `⏳ **${tag}** ran \`/${key}\` — blocked, on cooldown (${formatDuration(result.remainingMs)} left, set by /${result.source}).`
        );
        return;
    }

    const unlock = Math.floor(result.untilMs / 1000);
    const nextLine = result.noCooldown
        ? '_(tester: no cooldown)_'
        : `Next income available <t:${unlock}:R>.`;
    let content;
    if (result.wasps) {
        content =
            `🐝 ${incomeCfg.wasp_flavor || 'You got stung by wasps'}! ` +
            `You earned **${formatBells(0)}** and your cooldown is **doubled**.\n` +
            `Balance: **${formatBells(result.balance)}**\n` +
            nextLine;
    } else {
        content =
            `${incomeCfg.flavor} and earn **${formatBells(result.payout)}**!\n` +
            `Balance: **${formatBells(result.balance)}**\n` +
            nextLine;
    }

    await interaction.reply({ content, ephemeral: true });

    const detail = result.wasps ? 'WASPS (0 bells)' : `+${result.payout} bells`;
    await logUsage(
        interaction.client,
        `💰 **${tag}** ran \`/${key}\` — ${detail}. Balance: ${result.balance.toLocaleString('en-US')}.`
    );
}

module.exports = { executeIncome };
