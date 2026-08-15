const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { spectatorRole, guildSettings } = require('../../config/org');
const { resolveRoles } = require('../../handlers/roles');
const { toChannelName } = require('../../handlers/channelNames');

// A tribe of n members needs n(n-1)/2 channels: 10 members = 45, 12 = 66, 17 = 136.
// Discord caps a category at 50, so anything past 10 members needs somewhere to
// overflow. Two spare categories cover 150 channels, i.e. a tribe of 17.
const CATEGORY_OPTIONS = [
    { name: 'category', label: 'The category to create the 1-1 channels in', required: true },
    { name: 'overflow1', label: 'Spillover category used when the first one fills up', required: false },
    { name: 'overflow2', label: 'Second spillover category, for very large tribes', required: false },
];

const DEFAULT_CATEGORY_LIMIT = 50;
const DEFAULT_MAX_CHANNELS_PER_RUN = 150;

module.exports = {
    data: (() => {
        const builder = new SlashCommandBuilder()
            .setName('tribe1on1s')
            .setDescription('Create a 1-1 channel for every pair within a group of roles')
            // One free-text field rather than a numbered option per role: slash
            // commands allow only 25 options total, and a tribe can be any size.
            .addStringOption(option =>
                option.setName('roles')
                    .setDescription('Mention every tribe member role, separated by spaces')
                    .setRequired(true));

        for (const opt of CATEGORY_OPTIONS) {
            builder.addChannelOption(option =>
                option.setName(opt.name)
                    .setDescription(opt.label)
                    .addChannelTypes(ChannelType.GuildCategory)
                    .setRequired(opt.required));
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

            const { valid: roles, invalid: invalidRoles } =
                resolveRoles(interaction.guild, interaction.options.getString('roles'));

            if (roles.length < 2) {
                return await interaction.reply({
                    content: 'You need at least 2 distinct roles. Mention them in the `roles` field, '
                        + 'separated by spaces — for example `@Player1 @Player2 @Player3`.'
                        + (invalidRoles.length
                            ? `\n\n⚠️ Not roles in this server: ${invalidRoles.join(', ')}`
                            : ''),
                    ephemeral: true,
                });
            }

            // A tribe of n needs n(n-1)/2 channels. Past a point the run can't
            // finish inside the interaction's 15-minute window, so stop before
            // making a half-built mess. Configurable; 0 disables the brake.
            const settings = guildSettings(interaction.guild.id);
            const pairsNeeded = (roles.length * (roles.length - 1)) / 2;
            const maxPerRun = settings.max_channels_per_run === undefined
                ? DEFAULT_MAX_CHANNELS_PER_RUN
                : settings.max_channels_per_run;
            if (maxPerRun > 0 && pairsNeeded > maxPerRun) {
                return await interaction.reply({
                    content: `❌ ${roles.length} roles means **${pairsNeeded}** channels, over the `
                        + `${maxPerRun}-per-run limit.\n\nSplit it into two runs with about half the `
                        + 'roles each, then a third run with all of them to fill in the cross pairs. '
                        + 'Existing channels are skipped, so nothing gets duplicated.\n\n'
                        + '*(Raise `max_channels_per_run` in `config/org.json` to override.)*',
                    ephemeral: true,
                });
            }

            await interaction.deferReply({ ephemeral: true });

            // Per server (config/org.json); null in servers with no spectator role,
            // in which case the overwrite is left off entirely.
            const spectator = spectatorRole(interaction.guild);

            const limit = settings.category_channel_limit || DEFAULT_CATEGORY_LIMIT;

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

            const pairCount = pairsNeeded;
            const totalRoom = room.reduce((sum, r) => sum + r.free, 0);

            const created = [];
            const skipped = [];
            const failed = [];
            const noRoom = [];
            const collisions = [];
            const generatedThisRun = new Set();

            for (let i = 0; i < roles.length; i++) {
                for (let j = i + 1; j < roles.length; j++) {
                    const pair = [roles[i], roles[j]].sort((a, b) =>
                        a.name.toLowerCase().localeCompare(b.name.toLowerCase())
                    );

                    const channelName = toChannelName(pair.map(r => r.name));

                    if (existingNames.has(channelName)) {
                        // Distinguish "was already there" from "two pairs shortened
                        // to the same name" — the second is a naming problem the
                        // host needs to know about, not a clean skip.
                        if (generatedThisRun.has(channelName)) {
                            collisions.push(`${pair.map(r => r.name).join(' + ')} → ${channelName}`);
                        } else {
                            skipped.push(channelName);
                        }
                        continue;
                    }
                    generatedThisRun.add(channelName);

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
                        // rawError.errors holds Discord's per-field detail; the
                        // default console.error prints it as [Object].
                        console.error(
                            `Failed to create ${channelName} (${channelName.length} chars):`,
                            err.message,
                            JSON.stringify(err.rawError?.errors || {}, null, 2)
                        );
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

            if (invalidRoles.length > 0) {
                response += `\n\n⚠️ Ignored ${invalidRoles.length} ID(s) that aren't roles in this `
                    + `server: ${nameList(invalidRoles)}`;
            }
            if (skipped.length > 0) {
                response += `\n\n⚠️ Skipped ${skipped.length} that already existed: ${nameList(skipped)}`;
            }
            if (failed.length > 0) {
                response += `\n\n❌ Failed ${failed.length}: ${nameList(failed)}`;
            }
            if (collisions.length > 0) {
                response += `\n\n🔤 ${collisions.length} pair(s) shortened to a name already in use, `
                    + `so they were skipped: ${nameList(collisions, 4)}\n`
                    + 'Shorten those role names to fix it — channel names are capped at 100 characters.';
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
