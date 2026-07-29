const { ChannelType, OverwriteType, PermissionFlagsBits } = require('discord.js');
const { getPlayerRoles } = require('./playerRoles');

// Mute or unmute every involved player role across all channels in one or more
// categories. "Involved" = the player role already has a permission overwrite in
// that channel. Reads options `category`, `category2` … `category10` (a command
// only needs to define as many as it offers).
async function processCategory(interaction, mode) {
    const categories = [];
    const seen = new Set();
    for (let i = 1; i <= 10; i++) {
        const cat = interaction.options.getChannel(i === 1 ? 'category' : `category${i}`);
        if (cat && cat.type === ChannelType.GuildCategory && !seen.has(cat.id)) {
            categories.push(cat);
            seen.add(cat.id);
        }
    }

    if (!categories.length) {
        return interaction.reply({
            content: 'Please select at least one valid category channel.',
            ephemeral: true,
        });
    }

    const playerRoles = getPlayerRoles(interaction.guild.id);
    if (!playerRoles.length) {
        return interaction.reply({
            content: 'No player roles are initialized. Run `/initializeplayerroles` first.',
            ephemeral: true,
        });
    }

    const playerRoleSet = new Set(playerRoles);

    await interaction.deferReply({ ephemeral: true });

    let totalChannels = 0;
    let totalRoles = 0;
    let totalFailures = 0;
    const perCategory = [];

    for (const category of categories) {
        let channelsAffected = 0;
        let rolesChanged = 0;
        let failures = 0;

        for (const channel of category.children.cache.values()) {
            // Player roles that already have an overwrite in this channel.
            const involved = [...channel.permissionOverwrites.cache.values()]
                .filter(ow => ow.type === OverwriteType.Role && playerRoleSet.has(ow.id))
                .map(ow => ow.id);

            if (!involved.length) continue;

            let changedHere = false;
            for (const roleId of involved) {
                try {
                    await channel.permissionOverwrites.edit(roleId, mode === 'mute'
                        ? { [PermissionFlagsBits.ViewChannel]: false, [PermissionFlagsBits.SendMessages]: false }
                        : { [PermissionFlagsBits.ViewChannel]: true, [PermissionFlagsBits.SendMessages]: true });
                    rolesChanged++;
                    changedHere = true;
                } catch (err) {
                    console.error(`Failed to ${mode} role ${roleId} in #${channel.name}:`, err);
                    failures++;
                }
            }
            if (changedHere) channelsAffected++;
        }

        totalChannels += channelsAffected;
        totalRoles += rolesChanged;
        totalFailures += failures;
        perCategory.push(
            `• **${category.name}** — ${channelsAffected} channel(s), ${rolesChanged} overwrite(s)` +
            (failures ? `, ⚠️ ${failures} failed` : '')
        );
    }

    const verb = mode === 'mute' ? 'Muted' : 'Unmuted';
    let msg = `✅ ${verb} player roles across **${categories.length}** categor${categories.length === 1 ? 'y' : 'ies'}.\n` +
        `${perCategory.join('\n')}\n\n` +
        `**Totals:** ${totalChannels} channel(s), ${totalRoles} overwrite(s)` +
        (totalFailures ? `, ⚠️ ${totalFailures} failure(s)` : '');

    if (msg.length > 1900) msg = msg.slice(0, 1900) + '\n…(truncated)';

    await interaction.editReply(msg);
}

module.exports = { processCategory };
