const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { MEMBER_PLUS_ROLE_ID } = require('../../config/roles');

// Turn a display name into the base of a valid Discord channel name.
// Capped at 80 so the "-confessional" / "-submissions" suffix still fits in 100.
function toChannelName(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

// Parse the optional exclude option, e.g. "roles, submissions".
function parseExclusions(raw) {
    const value = (raw || '').toLowerCase();
    return {
        roles: value.includes('role'),
        confessionals: value.includes('confessional'),
        submissions: value.includes('submission'),
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playeritemssetup')
        .setDescription('Create a confessional, submissions channel, and role for each player')
        .addStringOption(option =>
            option.setName('names')
                .setDescription('Player names separated by slashes, e.g. erik/fang/raymond')
                .setRequired(true))
        .addChannelOption(option =>
            option.setName('confessional_category')
                .setDescription('Category to create the confessional channels in')
                .addChannelTypes(ChannelType.GuildCategory))
        .addChannelOption(option =>
            option.setName('submissions_category')
                .setDescription('Category to create the submissions channels in')
                .addChannelTypes(ChannelType.GuildCategory))
        .addStringOption(option =>
            option.setName('exclude')
                .setDescription('Skip any of: roles, confessionals, submissions'))
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageRoles
        ),

    async execute(interaction) {
        try {
            const exclude = parseExclusions(interaction.options.getString('exclude'));
            const confessionalCategory = interaction.options.getChannel('confessional_category');
            const submissionsCategory = interaction.options.getChannel('submissions_category');

            // De-duplicate names case-insensitively, preserving the order given.
            const names = [];
            const seen = new Set();
            for (const raw of interaction.options.getString('names').split('/')) {
                const name = raw.trim();
                if (!name) continue;
                const key = name.toLowerCase();
                if (!seen.has(key)) {
                    names.push(name);
                    seen.add(key);
                }
            }

            if (names.length === 0) {
                return await interaction.reply({
                    content: 'No valid names found. Separate names with slashes, e.g. `erik/fang/raymond`.',
                    ephemeral: true,
                });
            }

            // Only require a category for the parts we're actually creating.
            if (!exclude.confessionals && !confessionalCategory) {
                return await interaction.reply({
                    content: 'You need to provide `confessional_category` (or exclude `confessionals`).',
                    ephemeral: true,
                });
            }
            if (!exclude.submissions && !submissionsCategory) {
                return await interaction.reply({
                    content: 'You need to provide `submissions_category` (or exclude `submissions`).',
                    ephemeral: true,
                });
            }

            const memberPlus = interaction.guild.roles.cache.get(MEMBER_PLUS_ROLE_ID);
            if (!exclude.confessionals && !memberPlus) {
                return await interaction.reply({
                    content: `Member+ role (${MEMBER_PLUS_ROLE_ID}) not found in this server. Update \`src/config/roles.js\`.`,
                    ephemeral: true,
                });
            }

            await interaction.deferReply({ ephemeral: true });

            const created = { roles: 0, confessionals: 0, submissions: 0 };
            const skipped = [];
            const failed = [];

            for (const name of names) {
                const base = toChannelName(name);
                if (!base) {
                    failed.push(`${name} (name has no usable characters)`);
                    continue;
                }

                const confessionalName = `${base}-confessional`;
                const submissionsName = `${base}-submissions`;

                // Custom role — created but not assigned to anyone.
                if (!exclude.roles) {
                    const existingRole = interaction.guild.roles.cache.find(
                        r => r.name.toLowerCase() === name.toLowerCase()
                    );
                    if (existingRole) {
                        skipped.push(`role ${name}`);
                    } else {
                        try {
                            await interaction.guild.roles.create({
                                name,
                                reason: `playeritemssetup by ${interaction.user.tag}`,
                            });
                            created.roles++;
                        } catch (err) {
                            console.error(`Failed to create role ${name}:`, err);
                            failed.push(`role ${name}`);
                        }
                    }
                }

                // Confessional — @everyone denied, member+ can view.
                if (!exclude.confessionals) {
                    const existing = confessionalCategory.children.cache.find(c => c.name === confessionalName);
                    if (existing) {
                        skipped.push(confessionalName);
                    } else {
                        try {
                            await interaction.guild.channels.create({
                                name: confessionalName,
                                type: ChannelType.GuildText,
                                parent: confessionalCategory,
                                permissionOverwrites: [
                                    {
                                        id: interaction.guild.id,
                                        deny: [PermissionFlagsBits.ViewChannel],
                                    },
                                    {
                                        id: memberPlus.id,
                                        allow: [
                                            PermissionFlagsBits.ViewChannel,
                                            PermissionFlagsBits.SendMessages,
                                            PermissionFlagsBits.ReadMessageHistory,
                                        ],
                                    },
                                ],
                                reason: `playeritemssetup by ${interaction.user.tag}`,
                            });
                            created.confessionals++;
                        } catch (err) {
                            console.error(`Failed to create ${confessionalName}:`, err);
                            failed.push(confessionalName);
                        }
                    }
                }

                // Submissions — fully private. Only Administrators, who bypass overwrites.
                if (!exclude.submissions) {
                    const existing = submissionsCategory.children.cache.find(c => c.name === submissionsName);
                    if (existing) {
                        skipped.push(submissionsName);
                    } else {
                        try {
                            await interaction.guild.channels.create({
                                name: submissionsName,
                                type: ChannelType.GuildText,
                                parent: submissionsCategory,
                                permissionOverwrites: [
                                    {
                                        id: interaction.guild.id,
                                        deny: [PermissionFlagsBits.ViewChannel],
                                    },
                                ],
                                reason: `playeritemssetup by ${interaction.user.tag}`,
                            });
                            created.submissions++;
                        } catch (err) {
                            console.error(`Failed to create ${submissionsName}:`, err);
                            failed.push(submissionsName);
                        }
                    }
                }
            }

            let response = `✅ Done for **${names.length}** player(s).\n` +
                `> Roles: **${created.roles}**\n` +
                `> Confessionals: **${created.confessionals}**\n` +
                `> Submissions: **${created.submissions}**`;

            if (skipped.length > 0) response += `\n\n⚠️ Skipped (already existed): ${skipped.join(', ')}`;
            if (failed.length > 0) response += `\n\n❌ Failed: ${failed.join(', ')}`;

            if (response.length > 1900) response = response.slice(0, 1900) + '\n...(truncated)';

            await interaction.editReply(response);
        } catch (error) {
            console.error('Error in playeritemssetup:', error);
            const msg = 'There was an error setting up the player items.';
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(msg);
            } else {
                await interaction.reply({ content: msg, ephemeral: true });
            }
        }
    },
};
