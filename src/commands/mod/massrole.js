const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('massrole')
        .setDescription('Give everyone with one role another role')
        .addRoleOption(option =>
            option.setName('source')
                .setDescription('Everyone with this role will get the target role')
                .setRequired(true))
        .addRoleOption(option =>
            option.setName('target')
                .setDescription('The role to give them')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    async execute(interaction) {
        try {
            const source = interaction.options.getRole('source');
            const target = interaction.options.getRole('target');

            const me = interaction.guild.members.me;
            if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
                return await interaction.reply({
                    content: 'I need the Manage Roles permission.',
                    ephemeral: true,
                });
            }

            if (target.position >= me.roles.highest.position) {
                return await interaction.reply({
                    content: `I can't assign **${target.name}** because it's above my highest role.`,
                    ephemeral: true,
                });
            }

            await interaction.deferReply({ ephemeral: true });

            await interaction.guild.members.fetch();
            const members = source.members;

            let added = 0;
            let skipped = 0;
            let failed = 0;

            for (const [, member] of members) {
                if (member.roles.cache.has(target.id)) {
                    skipped++;
                    continue;
                }
                try {
                    await member.roles.add(target, `Massrole by ${interaction.user.tag}`);
                    added++;
                } catch (err) {
                    console.error(`Failed to add role to ${member.user.tag}:`, err);
                    failed++;
                }
            }

            await interaction.editReply(
                `Done. Gave **${target.name}** to ${added} member(s) who had **${source.name}**.\n` +
                `Skipped (already had it): ${skipped}\n` +
                `Failed: ${failed}`
            );
        } catch (error) {
            console.error('Error in massrole:', error);
            const msg = 'There was an error running massrole.';
            if (interaction.deferred) {
                await interaction.editReply(msg);
            } else {
                await interaction.reply({ content: msg, ephemeral: true });
            }
        }
    },
};
