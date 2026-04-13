const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('Show information about a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to get info about')
                .setRequired(false)),

    name: 'userinfo',
    description: 'Show information about a user',
    usage: '!userinfo [user]',

    async execute(interaction, args) {
        const isSlash = !args;

        try {
            let user, member;

            if (isSlash) {
                user = interaction.options.getUser('user') || interaction.user;
                member = interaction.options.getMember('user') || interaction.member;
            } else {
                const msg = interaction;
                if (msg.mentions.users.size > 0) {
                    user = msg.mentions.users.first();
                    member = msg.guild.members.cache.get(user.id) || await msg.guild.members.fetch(user.id).catch(() => null);
                } else if (args.length > 0) {
                    const id = args[0].replace(/\D/g, '');
                    try {
                        member = await msg.guild.members.fetch(id);
                        user = member.user;
                    } catch {
                        user = msg.author;
                        member = msg.member;
                    }
                } else {
                    user = msg.author;
                    member = msg.member;
                }
            }

            // Force fetch user for full profile data (banner, accent color)
            user = await user.fetch();

            const globalAvatar = user.displayAvatarURL({ size: 4096, dynamic: true });
            const bannerURL = user.bannerURL({ size: 4096, dynamic: true });
            const createdTimestamp = Math.floor(user.createdTimestamp / 1000);
            const joinedTimestamp = member ? Math.floor(member.joinedTimestamp / 1000) : null;

            const embed = new EmbedBuilder()
                .setColor(user.accentColor || 0x2b2d31)
                .setAuthor({ name: user.tag, iconURL: globalAvatar })
                .setThumbnail(globalAvatar)
                .addFields(
                    { name: 'Username', value: user.username, inline: true },
                    { name: 'Display Name', value: user.globalName || user.username, inline: true },
                    { name: 'ID', value: user.id, inline: false },
                    { name: 'Created', value: `<t:${createdTimestamp}:F> (<t:${createdTimestamp}:R>)`, inline: false },
                );

            if (joinedTimestamp) {
                embed.addFields({ name: 'Joined Server', value: `<t:${joinedTimestamp}:F> (<t:${joinedTimestamp}:R>)`, inline: false });
            }

            if (bannerURL) {
                embed.setImage(bannerURL);
            }

            await (isSlash
                ? interaction.reply({ embeds: [embed] })
                : interaction.reply({ embeds: [embed] }));

        } catch (error) {
            console.error('Error in userinfo command:', error);
            const errorMsg = 'Failed to get user info.';
            await (isSlash
                ? interaction.reply({ content: errorMsg, ephemeral: true })
                : interaction.reply(errorMsg));
        }
    }
};
