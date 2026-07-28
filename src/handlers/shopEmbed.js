const { EmbedBuilder } = require('discord.js');
const { getConfig, getItem } = require('../config/economy');
const { availableUnits } = require('./shop');

// One item block:
//   **Name** - 7,500 <:Bells:> | **STOCK : 2 (Refreshes)**
//   > description line 1
//   > description line 2
function itemBlock(guildId, item, showStock) {
    const cfg = getConfig();
    const priceLabel = item.price_label || item.price.toLocaleString('en-US');
    let head = `**${item.name}** - ${priceLabel} ${cfg.emoji.bells}`;

    if (showStock && item.stock !== null) {
        const left = availableUnits(guildId, item.id);
        const n = left === Infinity ? '∞' : left;
        head += ` | **STOCK : ${n}${item.refreshes ? ' (Refreshes)' : ''}**`;
    }

    const desc = String(item.description || '')
        .split('\n')
        .map(line => `> ${line}`)
        .join('\n');
    return `${head}\n${desc}`;
}

// header \n flourish \n intro \n\n items \n\n [footer]
function sectionEmbed(guildId, key, items, { showStock = true } = {}) {
    const cfg = getConfig();
    const section = cfg.shop.sections[key];
    const blocks = items.length
        ? items.map(item => itemBlock(guildId, item, showStock)).join('\n\n')
        : '*Nothing here right now.*';

    let body = `${section.header}\n${section.flourish}\n${section.intro}\n\n${blocks}`;
    if (section.footer) body += `\n\n${section.footer}`;

    const embed = new EmbedBuilder().setColor(cfg.shop.color).setDescription(body);
    if (cfg.shop.banner_url) embed.setImage(cfg.shop.banner_url);
    return embed;
}

// The static Loan Repayment embed (house payments — display only, SPEC §4).
function loanEmbed() {
    const cfg = getConfig();
    const section = cfg.shop.sections.loan;
    const blocks = cfg.house
        .map(h => `**${h.name}** - ${h.amount.toLocaleString('en-US')} ${cfg.emoji.bells}\n> ${h.description}`)
        .join('\n\n');

    const embed = new EmbedBuilder()
        .setColor(cfg.shop.color)
        .setDescription(`${section.header}\n${section.flourish}\n${section.intro}\n\n${blocks}`);
    if (cfg.shop.banner_url) embed.setImage(cfg.shop.banner_url);
    return embed;
}

// The five shop embeds for a rotation. `itemIds` are the 9 rotation items
// (2 special, 3 golden, 4 standard); Cabinet + Loan are static from config.
function buildShopEmbeds(guildId, itemIds) {
    const items = itemIds.map(id => getItem(id)).filter(Boolean);
    const byCat = cat => items.filter(item => item.category === cat);
    const cabinet = getConfig().items.filter(item => item.category === 'cabinet');

    return [
        sectionEmbed(guildId, 'special', byCat('special')),
        sectionEmbed(guildId, 'golden', byCat('golden')),
        sectionEmbed(guildId, 'standard', byCat('standard')),
        sectionEmbed(guildId, 'cabinet', cabinet, { showStock: false }),
        loanEmbed(),
    ];
}

module.exports = { buildShopEmbeds };
