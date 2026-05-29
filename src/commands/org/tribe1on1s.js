const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

const MAX_ROLES = 15;
const SPECTATOR_ROLE_ID = '1414321682360832182';

module.exports = {
    data: (() => {
        const builder = new SlashCommandBuilder()
            .setName('tribe1on1s')
            .setDescription('Create a 1-1 channel for every pair within a group of roles')
            .addChannelOption(option =>
                option.setName('category')
                    .setDescription('The category to create the 1-1 channels in')
                    .addChannelTypes(ChannelType.GuildCategory)
                    .setRequired(true));

        for (let i = 1; i <= MAX_ROLES; i++) {
            builder.addRoleOption(option =>
                option.setName(`role${i}`)
                    .setDescription(`Tribe member role ${i}`)
                    .setRequired(i <= 2));
        }

        return builder.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);
    })(),

    async execute(interaction) {
        try {
            const category = interaction.options.getChannel('category');

            const roles = [];
            const seen = new Set();
            for (let i = 1; i <= MAX_ROLES; i++) {
                const role = interaction.options.getRole(`role${i}`);
                if (role && !seen.has(role.id)) {
                    roles.push(role);
                    seen.add(role.id);
                }
            }

            if (roles.length < 2) {
                return await interaction.reply({
                    content: 'You need at least 2 distinct roles.',
                    ephemeral: true,
                });
            }

            await interaction.deferReply({ ephemeral: true });

            const created = [];
            const skipped = [];
            const failed = [];

            for (let i = 0; i < roles.length; i++) {
                for (let j = i + 1; j < roles.length; j++) {
                    const pair = [roles[i], roles[j]].sort((a, b) =>
                        a.name.toLowerCase().localeCompare(b.name.toLowerCase())
                    );

                    const channelName = pair
                        .map(r => r.name.toLowerCase().replace(/[^a-z0-9]/g, '-'))
                        .join('-');

                    const existing = category.children.cache.find(c => c.name === channelName);
                    if (existing) {
                        skipped.push(channelName);
                        continue;
                    }

                    const permissionOverwrites = [
                        {
                            id: interaction.guild.id,
                            deny: [PermissionFlagsBits.ViewChannel],
                        },
                        ...pair.map(role => ({
                            id: role.id,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ReadMessageHistory,
                                PermissionFlagsBits.UseExternalEmojis,
                                PermissionFlagsBits.AddReactions,
                            ],
                        })),
                        {
                            id: SPECTATOR_ROLE_ID,
                            deny: [PermissionFlagsBits.ViewChannel],
                        },
                    ];

                    try {
                        const channel = await interaction.guild.channels.create({
                            name: channelName,
                            type: ChannelType.GuildText,
                            parent: category,
                            permissionOverwrites,
                            topic: pair.map(r => r.name).join(', '),
                        });

                        await channel.send(
                            `🤝 **Welcome!**\n\nThis is a private 1-on-1 for:\n${pair.map(r => `• ${r}`).join('\n')}`
                        );

                        created.push(channel.toString());
                    } catch (err) {
                        console.error(`Failed to create ${channelName}:`, err);
                        failed.push(channelName);
                    }
                }
            }

            let response = `✅ Created ${created.length} 1-on-1 channel(s).`;
            if (created.length > 0) response += `\n\n${created.join('\n')}`;
            if (skipped.length > 0) response += `\n\n⚠️ Skipped (already existed): ${skipped.join(', ')}`;
            if (failed.length > 0) response += `\n\n❌ Failed: ${failed.join(', ')}`;

            if (response.length > 1900) response = response.slice(0, 1900) + '\n...(truncated)';

            await interaction.editReply(response);
        } catch (error) {
            console.error('Error in tribe1on1s:', error);
            const msg = 'There was an error creating the 1-1 channels.';
            if (interaction.deferred) {
                await interaction.editReply(msg);
            } else {
                await interaction.reply({ content: msg, ephemeral: true });
            }
        }
    },
};
