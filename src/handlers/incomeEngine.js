const { getConfig } = require('../config/economy');
const eco = require('./economy');

// --- The only RNG in the bot -------------------------------------------------

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Weighted pick over the configured outcomes.
function rollOutcome(incomeCfg) {
    const roll = Math.random();
    let cumulative = 0;
    for (const outcome of incomeCfg.outcomes) {
        cumulative += outcome.chance;
        if (roll < cumulative) return outcome;
    }
    // Fallback guards floating-point drift where the chances sum just under 1.
    return incomeCfg.outcomes[incomeCfg.outcomes.length - 1];
}

// --- Core (pure of Discord) --------------------------------------------------

// Runs one income command for a player. Mutates + saves the store. Returns a
// result descriptor; the command layer formats and replies.
function runIncome(guildId, userId, commandKey) {
    const config = getConfig();
    const incomeCfg = config.income[commandKey];
    const player = eco.getPlayer(guildId, userId);

    if (eco.isEliminated(player)) {
        return { status: 'eliminated' };
    }

    const now = Date.now();
    const tester = eco.isTester(player);

    // Testers never get locked out.
    if (!tester) {
        const remainingMs = eco.cooldownRemainingMs(player, now);
        if (remainingMs > 0) {
            return {
                status: 'cooldown',
                remainingMs,
                source: player.cooldown.source,
                untilMs: player.cooldown.until,
            };
        }
    }

    // Reduction is read from CURRENT state (before the decrement below) so the run
    // that spends a Flimsy charge still benefits from it.
    const reduction = eco.totalReduction(player);

    const outcome = rollOutcome(incomeCfg);
    const payout = outcome.wasps ? 0 : randInt(outcome.min, outcome.max);

    // Cooldown math (SPEC §1): reduce the base first, THEN double for wasps.
    let effHours = incomeCfg.base_cooldown_hours * (1 - reduction);
    if (outcome.wasps) effHours *= config.income.wasp_multiplier;
    const untilMs = now + Math.round(effHours * 60 * 60 * 1000);

    // Flimsy counters tick once per income run, regardless of command.
    eco.decrementFlimsy(player);

    if (payout > 0) eco.addBalance(player, payout);
    if (tester) {
        eco.clearCooldown(player);
    } else {
        eco.setCooldown(player, commandKey, untilMs);
    }
    eco.savePlayer(guildId, userId, player);

    return {
        status: 'ok',
        wasps: !!outcome.wasps,
        payout,
        balance: player.balance,
        reduction,
        untilMs,
        noCooldown: tester,
    };
}

// --- Formatting helpers ------------------------------------------------------

// Rounded-up "3h 12m" style duration.
function formatDuration(ms) {
    const totalMin = Math.max(1, Math.ceil(ms / 60000));
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
}

module.exports = {
    runIncome,
    rollOutcome,
    randInt,
    formatDuration,
};
