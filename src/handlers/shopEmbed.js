const { EmbedBuilder } = require('discord.js');
const { getConfig, getItem } = require('../config/economy');
const { availableUnits } = require('./shop');

// One item line: "**Name** — 7,500 <:Bells:> · 2 left\ndescription"
function itemLine(guildId, item, showStock) {
    const cfg = getConfig();
    const price = `${item.price.toLocaleString('en-US')} ${cfg.emoji.bells}`;
    let head = `**${item.name}** — ${price}`;
    if (showStock && item.stock !== null) {
        const left = availableUnits(guildId, item.id);
        head += ` · ${left === Infinity ? '∞' : left} left`;
    }
    return `${head}\n${item.description}`;
}

// Build one section embed: header (## on its own line), flourish (normal line),
// then the item lines.
function sectionEmbed(guildId, headerKey, items, { showStock = true } = {}) {
    const cfg = getConfig();
    const header = cfg.shop.headers[headerKey];
    const body = items.length
        ? items.map(item => itemLine(guildId, item, showStock)).join('\n\n')
        : '*Nothing here right now.*';

    const embed = new EmbedBuilder()
        .setColor(cfg.shop.color)
        .setDescription(`${header}\n${cfg.shop.flourish}\n\n${body}`);

    if (cfg.shop.banner_url) embed.setImage(cfg.shop.banner_url);
    return embed;
}

// The static Loan Repayment embed (house payments — display only, SPEC §4).
function loanEmbed() {
    const cfg = getConfig();
    const h = cfg.house;
    const lines = [
        `**Pre-Swap** — ${h.pre_swap.toLocaleString('en-US')} ${cfg.emoji.bells}`,
        `**Swap** — ${h.swap.toLocaleString('en-US')} ${cfg.emoji.bells}`,
        `**Early Merge** — ${h.early_merge.toLocaleString('en-US')} ${cfg.emoji.bells}`,
        `**Late Merge (F7+)** — ${h.late_merge.toLocaleString('en-US')} ${cfg.emoji.bells}`,
    ];
    const embed = new EmbedBuilder()
        .setColor(cfg.shop.color)
        .setDescription(`${cfg.shop.headers.loan}\n${cfg.shop.flourish}\n\n${lines.join('\n')}\n\n*Ping a host to pay your loan.*`);
    if (cfg.shop.banner_url) embed.setImage(cfg.shop.banner_url);
    return embed;
}

// Build the five shop embeds for a rotation. `itemIds` are the 9 rotation items
// (2 special, 3 golden, 4 standard); Cabinet + Loan are static from config.
function buildShopEmbeds(guildId, itemIds) {
    const items = itemIds.map(id => getItem(id)).filter(Boolean);
    const byCat = cat => items.filter(item => item.category === cat);

    const cfg = getConfig();
    const cabinet = cfg.items.filter(item => item.category === 'cabinet');

    return [
        sectionEmbed(guildId, 'special', byCat('special')),
        sectionEmbed(guildId, 'golden', byCat('golden')),
        sectionEmbed(guildId, 'standard', byCat('standard')),
        sectionEmbed(guildId, 'cabinet', cabinet, { showStock: false }),
        loanEmbed(),
    ];
}

module.exports = { buildShopEmbeds };
