const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { spectatorRole, guildSettings } = require('../../config/org');

const MAX_ROLES = 15;

// A tribe of n members needs n(n-1)/2 channels: 10 members = 45, 11 = 55, 12 = 66.
// Discord caps a category at 50, so anything past 10 members needs somewhere to
// overflow. Two spare categories cover the full 15-role range (105 channels).
const CATEGORY_OPTIONS = [
    { name: 'category', label: 'The category to create the 1-1 channels in', required: true },
    { name: 'overflow1', label: 'Spillover category used when the first one fills up', required: false },
    { name: 'overflow2', label: 'Second spillover category, for very large tribes', required: false },
];

const DEFAULT_CATEGORY_LIMIT = 50;

module.exports = {
    data: (() => {
        const builder = new SlashCommandBuilder()
            .setName('tribe1on1s')
            .setDescription('Create a 1-1 channel for every pair within a group of roles');

        for (const opt of CATEGORY_OPTIONS) {
            builder.addChannelOption(option =>
                option.setName(opt.name)
                    .setDescription(opt.label)
                    .addChannelTypes(ChannelType.GuildCategory)
                    .setRequired(opt.required));
        }

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
            // Categories in fill order, deduped in case the same one is passed twice.
            const categories = [];
            const seenCategories = new Set();
            for (const opt of CATEGORY_OPTIONS) {
                const channel = interaction.options.getChannel(opt.name);
                if (channel && !seenCategories.has(channel.id)) {
                    categories.push(channel);
                    seenCategories.add(channel.id);
                }
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

            if (roles.length < 2) {
                return await interaction.reply({
                    content: 'You need at least 2 distinct roles.',
                    ephemeral: true,
                });
            }

            await interaction.deferReply({ ephemeral: true });

            // Per server (config/org.json); null in servers with no spectator role,
            // in which case the overwrite is left off entirely.
            const spectator = spectatorRole(interaction.guild);

            const limit = guildSettings(interaction.guild.id).category_channel_limit
                || DEFAULT_CATEGORY_LIMIT;

            // Remaining room per category, tracked locally: the cache won't reflect
            // the channels we create during this run.
            const room = categories.map(c => ({
                category: c,
                free: Math.max(0, limit - c.children.cache.size),
                placed: 0,
            }));

            // Existing names across ALL the given categories, so a re-run skips a
            // channel that previously landed in an overflow rather than duplicating it.
            const existingNames = new Set();
            for (const c of categories) {
                for (const child of c.children.cache.values()) existingNames.add(child.name);
            }

            const pairCount = (roles.length * (roles.length - 1)) / 2;
            const totalRoom = room.reduce((sum, r) => sum + r.free, 0);

            const created = [];
            const skipped = [];
            const failed = [];
            const noRoom = [];

            for (let i = 0; i < roles.length; i++) {
                for (let j = i + 1; j < roles.length; j++) {
                    const pair = [roles[i], roles[j]].sort((a, b) =>
                        a.name.toLowerCase().localeCompare(b.name.toLowerCase())
                    );

                    const channelName = pair
                        .map(r => r.name.toLowerCase().replace(/[^a-z0-9]/g, '-'))
                        .join('-');

                    if (existingNames.has(channelName)) {
                        skipped.push(channelName);
                        continue;
                    }

                    // First category with space wins; overflow only once it's full.
                    const slot = room.find(r => r.free > 0);
                    if (!slot) {
                        noRoom.push(channelName);
                        continue;
                    }
                    const category = slot.category;

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
                    ];

                    // 1-on-1s are never visible to spectators.
                    if (spectator) {
                        permissionOverwrites.push({
                            id: spectator.id,
                            deny: [PermissionFlagsBits.ViewChannel],
                        });
                    }

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
                        existingNames.add(channelName);
                        slot.free -= 1;
                        slot.placed += 1;
                    } catch (err) {
                        console.error(`Failed to create ${channelName}:`, err);
                        failed.push(channelName);
                    }
                }
            }

            // A full tribe is up to 105 channels, so summarise rather than listing
            // every mention — the old output blew past Discord's limit and truncated.
            const nameList = (names, max = 8) => names.length <= max
                ? names.join(', ')
                : `${names.slice(0, max).join(', ')} +${names.length - max} more`;

            let response = `✅ Created **${created.length}** of ${pairCount} 1-on-1 channel(s) `
                + `for ${roles.length} roles.`;

            const used = room.filter(r => r.placed > 0);
            if (used.length > 0) {
                response += '\n\n**Where they went**\n' + used
                    .map(r => `• ${r.category} — ${r.placed} created, ${r.free} slot(s) left`)
                    .join('\n');
            }

            if (skipped.length > 0) {
                response += `\n\n⚠️ Skipped ${skipped.length} that already existed: ${nameList(skipped)}`;
            }
            if (failed.length > 0) {
                response += `\n\n❌ Failed ${failed.length}: ${nameList(failed)}`;
            }
            if (noRoom.length > 0) {
                response += `\n\n📦 **Out of space** — ${noRoom.length} channel(s) had nowhere to go.\n`
                    + `${categories.length === CATEGORY_OPTIONS.length
                        ? `All ${categories.length} categories are full (${limit} channels each).`
                        : `Re-run with the \`overflow${categories.length}\` option pointing at another empty category.`}\n`
                    + 'Already-created channels are skipped on a re-run, so it\'s safe to run again.';
            }
            if (noRoom.length === 0 && totalRoom < pairCount && created.length > 0) {
                response += '\n\n💡 Tight fit — you\'re close to filling these categories.';
            }

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
