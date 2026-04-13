const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('Show information about the server'),

    name: 'serverinfo',
    description: 'Show information about the server',
    usage: '!serverinfo',

    async execute(interaction, args) {
        const isSlash = !args;

        try {
            const guild = interaction.guild;

            // Fetch full guild data for accurate counts
            await guild.members.fetch();

            const owner = await guild.fetchOwner();
            const createdTimestamp = Math.floor(guild.createdTimestamp / 1000);

            const textChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText).size;
            const voiceChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size;
            const totalChannels = guild.channels.cache.size;

            const embed = new EmbedBuilder()
                .setColor(0x2b2d31)
                .setAuthor({ name: guild.name, iconURL: guild.iconURL({ dynamic: true }) })
                .setThumbnail(guild.iconURL({ size: 4096, dynamic: true }))
                .addFields(
                    { name: 'Owner', value: `${owner.user.tag}`, inline: true },
                    { name: 'Members', value: `${guild.memberCount}`, inline: true },
                    { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
                    { name: 'Channels', value: `${totalChannels} total (${textChannels} text, ${voiceChannels} voice)`, inline: false },
                    { name: 'Created', value: `<t:${createdTimestamp}:F> (<t:${createdTimestamp}:R>)`, inline: false },
                    { name: 'Server ID', value: guild.id, inline: false },
                );

            if (guild.vanityURLCode) {
                embed.addFields({ name: 'Vanity URL', value: `discord.gg/${guild.vanityURLCode}`, inline: false });
            }

            if (guild.bannerURL()) {
                embed.setImage(guild.bannerURL({ size: 4096 }));
            }

            await (isSlash
                ? interaction.reply({ embeds: [embed] })
                : interaction.reply({ embeds: [embed] }));

        } catch (error) {
            console.error('Error in serverinfo command:', error);
            const errorMsg = 'Failed to get server info.';
            await (isSlash
                ? interaction.reply({ content: errorMsg, ephemeral: true })
                : interaction.reply(errorMsg));
        }
    }
};
