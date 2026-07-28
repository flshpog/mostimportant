const { runIncome, formatDuration } = require('./incomeEngine');
const { getConfig, formatBells } = require('../config/economy');
const { logToHost } = require('./economyLog');

// Shared executor for /rock /tree /bottle — the commands differ only by `key`.
async function executeIncome(interaction, key) {
    if (!interaction.inGuild()) {
        return interaction.reply({ content: 'This command can only be used in the server.', ephemeral: true });
    }

    const cfg = getConfig();
    const incomeCfg = cfg.income[key];
    const result = runIncome(interaction.guildId, interaction.user.id, key);

    if (result.status === 'eliminated') {
        return interaction.reply({
            content: "You've been eliminated — you can no longer earn bells.",
            ephemeral: true,
        });
    }

    if (result.status === 'cooldown') {
        const unlock = Math.floor(result.untilMs / 1000);
        return interaction.reply({
            content:
                `⏳ You're on cooldown (set by **/${result.source}**).\n` +
                `Available <t:${unlock}:R> — in **${formatDuration(result.remainingMs)}**.`,
            ephemeral: true,
        });
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

    if (cfg.flags.log_income_commands) {
        const detail = result.wasps ? 'WASPS (0 bells)' : `+${result.payout} bells`;
        await logToHost(
            interaction.client,
            `💰 **${interaction.user.tag}** ran \`/${key}\` — ${detail}. Balance: ${result.balance.toLocaleString('en-US')}.`
        );
    }
}

module.exports = { executeIncome };
