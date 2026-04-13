const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

// All toggleable channel permissions
const PERMISSION_CHOICES = [
    { name: 'View Channel', value: 'ViewChannel' },
    { name: 'Manage Channel', value: 'ManageChannels' },
    { name: 'Manage Permissions', value: 'ManageRoles' },
    { name: 'Create Invite', value: 'CreateInstantInvite' },
    { name: 'Send Messages', value: 'SendMessages' },
    { name: 'Send Messages in Threads', value: 'SendMessagesInThreads' },
    { name: 'Create Public Threads', value: 'CreatePublicThreads' },
    { name: 'Create Private Threads', value: 'CreatePrivateThreads' },
    { name: 'Embed Links', value: 'EmbedLinks' },
    { name: 'Attach Files', value: 'AttachFiles' },
    { name: 'Add Reactions', value: 'AddReactions' },
    { name: 'Use External Emoji', value: 'UseExternalEmojis' },
    { name: 'Use External Stickers', value: 'UseExternalStickers' },
    { name: 'Mention Everyone', value: 'MentionEveryone' },
    { name: 'Manage Messages', value: 'ManageMessages' },
    { name: 'Manage Threads', value: 'ManageThreads' },
    { name: 'Read Message History', value: 'ReadMessageHistory' },
    { name: 'Send TTS Messages', value: 'SendTTSMessages' },
    { name: 'Use Application Commands', value: 'UseApplicationCommands' },
    { name: 'Connect (Voice)', value: 'Connect' },
    { name: 'Speak (Voice)', value: 'Speak' },
    { name: 'Video (Voice)', value: 'Stream' },
    { name: 'Use Activities (Voice)', value: 'UseEmbeddedActivities' },
    { name: 'Use Soundboard (Voice)', value: 'UseSoundboard' },
    { name: 'Use Voice Activity (Voice)', value: 'UseVAD' },
    { name: 'Priority Speaker (Voice)', value: 'PrioritySpeaker' },
    { name: 'Mute Members (Voice)', value: 'MuteMembers' },
    { name: 'Deafen Members (Voice)', value: 'DeafenMembers' },
    { name: 'Move Members (Voice)', value: 'MoveMembers' }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('categorypermission')
        .setDescription('Set a permission for a role/member across all channels in a category')
        .addChannelOption(option =>
            option.setName('category')
                .setDescription('The category to modify')
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(true))
        .addMentionableOption(option =>
            option.setName('target')
                .setDescription('The role or member to modify permissions for')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('permission')
                .setDescription('The permission to modify')
                .setRequired(true)
                .addChoices(...PERMISSION_CHOICES.slice(0, 25))) // Discord limits to 25 choices
        .addStringOption(option =>
            option.setName('state')
                .setDescription('The state to set the permission to')
                .setRequired(true)
                .addChoices(
                    { name: 'Allow (Green checkmark)', value: 'true' },
                    { name: 'Neutral (Gray slash - inherit)', value: 'null' },
                    { name: 'Deny (Red X)', value: 'false' }
                ))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const category = interaction.options.getChannel('category');
            const target = interaction.options.getMentionable('target');
            const permission = interaction.options.getString('permission');
            const stateStr = interaction.options.getString('state');

            // Convert state string to boolean or null
            let state;
            if (stateStr === 'true') state = true;
            else if (stateStr === 'false') state = false;
            else state = null;

            // Get all channels in the category
            const channels = category.children.cache;

            if (channels.size === 0) {
                return await interaction.editReply('This category has no channels.');
            }

            let successCount = 0;
            let failCount = 0;
            const errors = [];

            // Update permissions for each channel
            for (const [, channel] of channels) {
                try {
                    await channel.permissionOverwrites.edit(target.id, {
                        [permission]: state
                    });
                    successCount++;
                } catch (error) {
                    failCount++;
                    errors.push(`${channel.name}: ${error.message}`);
                }
            }

            // Also update the category itself
            try {
                await category.permissionOverwrites.edit(target.id, {
                    [permission]: state
                });
            } catch (error) {
                errors.push(`Category itself: ${error.message}`);
            }

            // Build response
            const stateText = state === true ? 'Allow' : state === false ? 'Deny' : 'Neutral';
            const targetName = target.displayName || target.name || target.user?.username || 'Unknown';
            const permName = PERMISSION_CHOICES.find(p => p.value === permission)?.name || permission;

            let response = `**Permission Update Complete**\n`;
            response += `Category: **${category.name}**\n`;
            response += `Target: **${targetName}**\n`;
            response += `Permission: **${permName}**\n`;
            response += `State: **${stateText}**\n\n`;
            response += `Successfully updated: **${successCount}** channels\n`;

            if (failCount > 0) {
                response += `Failed: **${failCount}** channels\n`;
                response += `\nErrors:\n${errors.slice(0, 5).join('\n')}`;
                if (errors.length > 5) {
                    response += `\n...and ${errors.length - 5} more errors`;
                }
            }

            await interaction.editReply(response);

        } catch (error) {
            console.error('Error in categorypermission command:', error);
            await interaction.editReply('There was an error updating permissions. Please check bot permissions.');
        }
    }
};
