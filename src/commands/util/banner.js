const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('banner')
        .setDescription('Show a user\'s banner')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to get the banner of')
                .setRequired(false)),

    name: 'banner',
    description: 'Show a user\'s banner',
    usage: '!banner [user]',

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

            // Force fetch the user to get banner data
            user = await user.fetch();

            const globalBanner = user.bannerURL({ size: 4096, dynamic: true });
            const serverBanner = member?.bannerURL?.({ size: 4096, dynamic: true }) || null;

            if (!globalBanner && !serverBanner) {
                const noMsg = `**${user.tag}** doesn't have a banner set.`;
                return await (isSlash
                    ? interaction.reply({ content: noMsg, ephemeral: true })
                    : interaction.reply(noMsg));
            }

            const embeds = [];

            if (globalBanner) {
                const embed = new EmbedBuilder()
                    .setColor(user.accentColor || 0x2b2d31)
                    .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL({ dynamic: true }) })
                    .setTitle('Global Banner')
                    .setImage(globalBanner);
                embeds.push(embed);
            }

            if (serverBanner && serverBanner !== globalBanner) {
                const serverEmbed = new EmbedBuilder()
                    .setColor(user.accentColor || 0x2b2d31)
                    .setTitle('Server Banner')
                    .setImage(serverBanner);
                embeds.push(serverEmbed);
            }

            await (isSlash
                ? interaction.reply({ embeds })
                : interaction.reply({ embeds }));

        } catch (error) {
            console.error('Error in banner command:', error);
            const errorMsg = 'Failed to get the banner.';
            await (isSlash
                ? interaction.reply({ content: errorMsg, ephemeral: true })
                : interaction.reply(errorMsg));
        }
    }
};
