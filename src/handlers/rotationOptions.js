const shop = require('./shop');
const { getItem } = require('../config/economy');

// The 9 rotation slots: 2 Specials, 3 Golden, 4 Standard. Each maps to a category
// the option's autocomplete draws from. Cabinet + Loan are appended automatically.
const SLOTS = [
    { name: 'special1', category: 'special', label: 'Store Special #1' },
    { name: 'special2', category: 'special', label: 'Store Special #2' },
    { name: 'golden1', category: 'golden', label: 'Golden Tool #1' },
    { name: 'golden2', category: 'golden', label: 'Golden Tool #2' },
    { name: 'golden3', category: 'golden', label: 'Golden Tool #3' },
    { name: 'standard1', category: 'standard', label: 'Standard Tool #1' },
    { name: 'standard2', category: 'standard', label: 'Standard Tool #2' },
    { name: 'standard3', category: 'standard', label: 'Standard Tool #3' },
    { name: 'standard4', category: 'standard', label: 'Standard Tool #4' },
];

// Adds the 9 required autocomplete string options to a SlashCommandBuilder.
function addRotationOptions(builder) {
    for (const slot of SLOTS) {
        builder.addStringOption(option =>
            option.setName(slot.name)
                .setDescription(slot.label)
                .setRequired(true)
                .setAutocomplete(true));
    }
    return builder;
}

// Autocomplete: offer only `available` items from the focused slot's category.
async function handleRotationAutocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const slot = SLOTS.find(s => s.name === focused.name);
    if (!slot) return interaction.respond([]);

    const query = String(focused.value).toLowerCase();
    const choices = shop.offerableItems(interaction.guildId, slot.category)
        .filter(item => item.name.toLowerCase().includes(query))
        .slice(0, 25)
        .map(item => ({ name: `${item.name} (${item.price.toLocaleString('en-US')})`, value: String(item.id) }));
    await interaction.respond(choices);
}

// Collects and validates the 9 chosen item IDs. Returns { ids } or { error }.
function collectRotationIds(interaction) {
    const ids = [];
    const seen = new Set();
    for (const slot of SLOTS) {
        const raw = interaction.options.getString(slot.name);
        const id = Number(raw);
        const item = Number.isInteger(id) ? getItem(id) : null;

        if (!item || item.category !== slot.category) {
            return { error: `**${slot.label}** must be a valid ${slot.category} item (pick from autocomplete).` };
        }
        if (seen.has(id)) {
            return { error: `Duplicate item selected: **${item.name}**. Each slot must be a different item.` };
        }
        if (!shop.isAvailable(interaction.guildId, id)) {
            return { error: `**${item.name}** is no longer available to offer.` };
        }
        seen.add(id);
        ids.push(id);
    }
    return { ids };
}

module.exports = { SLOTS, addRotationOptions, handleRotationAutocomplete, collectRotationIds };
