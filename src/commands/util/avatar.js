const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('avatar')
        .setDescription('Show a user\'s avatar')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to get the avatar of')
                .setRequired(false)),

    name: 'avatar',
    description: 'Show a user\'s avatar',
    usage: '!avatar [user]',

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

            // Force fetch the user to get full data
            user = await user.fetch();

            const globalAvatar = user.displayAvatarURL({ size: 4096, dynamic: true });
            const serverAvatar = member?.avatarURL({ size: 4096, dynamic: true });

            const embed = new EmbedBuilder()
                .setColor(user.accentColor || 0x2b2d31)
                .setAuthor({ name: user.tag, iconURL: globalAvatar })
                .setTitle('Global Avatar')
                .setImage(globalAvatar);

            const embeds = [embed];

            if (serverAvatar && serverAvatar !== globalAvatar) {
                const serverEmbed = new EmbedBuilder()
                    .setColor(user.accentColor || 0x2b2d31)
                    .setTitle('Server Avatar')
                    .setImage(serverAvatar);
                embeds.push(serverEmbed);
            }

            await (isSlash
                ? interaction.reply({ embeds })
                : interaction.reply({ embeds }));

        } catch (error) {
            console.error('Error in avatar command:', error);
            const errorMsg = 'Failed to get the avatar.';
            await (isSlash
                ? interaction.reply({ content: errorMsg, ephemeral: true })
                : interaction.reply(errorMsg));
        }
    }
};
