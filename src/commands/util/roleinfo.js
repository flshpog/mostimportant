const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

function buildRoleEmbed(role) {
    const embed = new EmbedBuilder()
        .setTitle(role.name)
        .setColor(role.color || 0x99AAB5)
        .addFields(
            { name: 'ID', value: role.id, inline: true },
            { name: 'Position', value: `${role.position}`, inline: true },
            { name: 'Members', value: `${role.members.size}`, inline: true },
            { name: 'Hex Color', value: role.hexColor, inline: true },
            { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true },
            { name: 'Hoisted', value: role.hoist ? 'Yes' : 'No', inline: true },
        )
        .setTimestamp();

    if (role.iconURL()) {
        embed.setThumbnail(role.iconURL({ size: 128 }));
    }

    return embed;
}

function parseRoleFromArgs(guild, input) {
    const id = input.replace(/[<@&>]/g, '');
    return guild.roles.cache.get(id) || guild.roles.cache.find(r => r.name.toLowerCase() === input.toLowerCase());
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roleinfo')
        .setDescription('Display info about a role')
        .addRoleOption(opt =>
            opt.setName('role').setDescription('The role to look up').setRequired(true)),

    name: 'roleinfo',
    description: 'Display info about a role',
    usage: '?roleinfo <role id or mention>',

    async execute(interaction, args) {
        const isSlash = interaction.isChatInputCommand?.();

        if (isSlash) {
            const role = interaction.options.getRole('role');
            const embed = buildRoleEmbed(role);
            return interaction.reply({ embeds: [embed] });
        }

        const message = interaction;

        // Check if replying to a message with role mentions
        if (message.reference) {
            try {
                const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
                if (repliedMsg.mentions.roles.size > 0) {
                    const embeds = repliedMsg.mentions.roles.map(role => buildRoleEmbed(role));
                    return message.reply({ embeds });
                }
            } catch {}
        }

        if (!args || args.length === 0) {
            return message.reply('Please provide a role ID or mention. Usage: `?roleinfo <role>`');
        }

        const role = parseRoleFromArgs(message.guild, args[0]);
        if (!role) {
            return message.reply('Role not found.');
        }

        const embed = buildRoleEmbed(role);
        return message.reply({ embeds: [embed] });
    },
};
