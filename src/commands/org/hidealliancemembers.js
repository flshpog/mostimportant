const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, OverwriteType } = require('discord.js');

const MAX_ROLES = 10;

// Hides SPECIFIC member roles from the alliance channels in a category (deny view +
// speak), leaving every other member's access untouched. Unlike /mute1on1s (which
// hides all involved player roles), this only touches the roles you name - ideal
// for removing one person from a 2+ member alliance. Only channels where the role
// already has an overwrite (i.e. they're a member) are changed.
module.exports = {
    data: (() => {
        const builder = new SlashCommandBuilder()
            .setName('hidealliancemembers')
            .setDescription('Hide specific member roles from the alliance channels in a category');

        builder.addChannelOption(option =>
            option.setName('category')
                .setDescription('The category whose alliance channels to edit')
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(true));

        for (let i = 1; i <= MAX_ROLES; i++) {
            builder.addRoleOption(option =>
                option.setName(`role${i}`)
                    .setDescription(i === 1 ? 'Member role to hide' : `Additional member role ${i} (optional)`)
                    .setRequired(i === 1));
        }

        return builder.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);
    })(),

    async execute(interaction) {
        try {
            const category = interaction.options.getChannel('category');
            if (!category || category.type !== ChannelType.GuildCategory) {
                return interaction.reply({ content: 'Please select a valid category channel.', ephemeral: true });
            }

            const roles = [];
            const seen = new Set();
            for (let i = 1; i <= MAX_ROLES; i++) {
                const role = interaction.options.getRole(`role${i}`);
                if (role && !seen.has(role.id)) {
                    roles.push(role);
                    seen.add(role.id);
                }
            }
            if (!roles.length) {
                return interaction.reply({ content: 'Provide at least one member role to hide.', ephemeral: true });
            }

            const roleSet = new Set(roles.map(r => r.id));
            await interaction.deferReply({ ephemeral: true });

            let channelsAffected = 0;
            let rolesHidden = 0;
            let failures = 0;
            const perRole = {};

            for (const channel of category.children.cache.values()) {
                // Only the named roles that currently have an overwrite in this channel.
                const involved = [...channel.permissionOverwrites.cache.values()]
                    .filter(ow => ow.type === OverwriteType.Role && roleSet.has(ow.id))
                    .map(ow => ow.id);

                if (!involved.length) continue;

                let changedHere = false;
                for (const roleId of involved) {
                    try {
                        await channel.permissionOverwrites.edit(roleId, {
                            [PermissionFlagsBits.ViewChannel]: false,
                            [PermissionFlagsBits.SendMessages]: false,
                        });
                        rolesHidden++;
                        perRole[roleId] = (perRole[roleId] || 0) + 1;
                        changedHere = true;
                    } catch (err) {
                        console.error(`Failed to hide role ${roleId} in #${channel.name}:`, err);
                        failures++;
                    }
                }
                if (changedHere) channelsAffected++;
            }

            const lines = roles.map(r => `• ${r.name} - hidden from ${perRole[r.id] || 0} channel(s)`);
            let msg = `✅ Hid **${roles.length}** member role(s) across **${category.name}**.\n` +
                `${lines.join('\n')}\n\n` +
                `**Totals:** ${channelsAffected} channel(s), ${rolesHidden} overwrite(s)` +
                (failures ? `, ⚠️ ${failures} failure(s)` : '');
            if (msg.length > 1900) msg = msg.slice(0, 1900) + '\n…(truncated)';

            await interaction.editReply(msg);
        } catch (error) {
            console.error('Error in hidealliancemembers:', error);
            const msg = 'There was an error hiding the members.';
            if (interaction.deferred) await interaction.editReply(msg);
            else await interaction.reply({ content: msg, ephemeral: true });
        }
    },
};
