const { ChannelType, OverwriteType, PermissionFlagsBits } = require('discord.js');
const { getPlayerRoles } = require('./playerRoles');

// Mute or unmute every involved player role across all channels in a category.
// "Involved" = the player role already has a permission overwrite in that channel.
async function processCategory(interaction, mode) {
    const category = interaction.options.getChannel('category');

    if (!category || category.type !== ChannelType.GuildCategory) {
        return interaction.reply({
            content: 'Please select a valid category channel.',
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

    const channels = [...category.children.cache.values()];
    let channelsAffected = 0;
    let rolesChanged = 0;
    let failures = 0;

    for (const channel of channels) {
        // Player roles that already have an overwrite in this channel.
        const involved = [...channel.permissionOverwrites.cache.values()]
            .filter(ow => ow.type === OverwriteType.Role && playerRoleSet.has(ow.id))
            .map(ow => ow.id);

        if (!involved.length) continue;

        let changedHere = false;
        for (const roleId of involved) {
            try {
                if (mode === 'mute') {
                    await channel.permissionOverwrites.edit(roleId, {
                        [PermissionFlagsBits.ViewChannel]: false,
                        [PermissionFlagsBits.SendMessages]: false,
                    });
                } else {
                    await channel.permissionOverwrites.edit(roleId, {
                        [PermissionFlagsBits.ViewChannel]: true,
                        [PermissionFlagsBits.SendMessages]: true,
                    });
                }
                rolesChanged++;
                changedHere = true;
            } catch (err) {
                console.error(`Failed to ${mode} role ${roleId} in #${channel.name}:`, err);
                failures++;
            }
        }
        if (changedHere) channelsAffected++;
    }

    const verb = mode === 'mute' ? 'Muted' : 'Unmuted';
    let msg = `✅ ${verb} player roles across **${category.name}**.\n` +
        `• Channels affected: ${channelsAffected}\n` +
        `• Role overwrites changed: ${rolesChanged}`;
    if (failures) msg += `\n• ⚠️ Failures: ${failures}`;

    await interaction.editReply(msg);
}

module.exports = { processCategory };
