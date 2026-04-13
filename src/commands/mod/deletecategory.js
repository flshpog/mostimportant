const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('deletecategory')
        .setDescription('Delete a category and all channels inside it')
        .addChannelOption(option =>
            option.setName('category')
                .setDescription('The category to delete')
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    name: 'deletecategory',
    description: 'Delete a category and all channels inside it',
    usage: '!deletecategory <category-id>',

    async execute(interaction, args) {
        const isSlash = !args;

        try {
            let category;

            if (isSlash) {
                category = interaction.options.getChannel('category');
            } else {
                const msg = interaction;

                if (!msg.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
                    return await msg.reply('You need the Manage Channels permission to use this command.');
                }

                if (!args || args.length === 0) {
                    return await msg.reply('Please provide a category ID.\nUsage: `!deletecategory <category-id>`');
                }

                const id = args[0].replace(/\D/g, '');
                category = msg.guild.channels.cache.get(id);

                if (!category || category.type !== ChannelType.GuildCategory) {
                    return await msg.reply('That doesn\'t look like a valid category.');
                }
            }

            const children = category.children.cache;
            const channelCount = children.size;
            const categoryName = category.name;

            if (isSlash) await interaction.deferReply({ ephemeral: true });

            // Delete all channels inside the category
            for (const [, channel] of children) {
                await channel.delete().catch(err =>
                    console.error(`Failed to delete channel ${channel.name}:`, err.message)
                );
            }

            // Delete the category itself
            await category.delete();

            const successMsg = `Deleted **${categoryName}** and ${channelCount} channel${channelCount !== 1 ? 's' : ''} inside it.`;

            if (isSlash) {
                await interaction.editReply(successMsg);
            } else {
                await interaction.reply(successMsg);
            }

        } catch (error) {
            console.error('Error in deletecategory command:', error);
            const errorMsg = 'Failed to delete the category. Make sure I have the right permissions.';
            if (isSlash) {
                if (interaction.deferred) {
                    await interaction.editReply(errorMsg);
                } else {
                    await interaction.reply({ content: errorMsg, ephemeral: true });
                }
            } else {
                await interaction.reply(errorMsg);
            }
        }
    }
};
