const { SlashCommandBuilder, PermissionFlagsBits, parseEmoji } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('emojirob')
        .setDescription('Steal an emoji from another server and add it to this one')
        .addStringOption(option =>
            option.setName('emoji')
                .setDescription('The emoji to steal (paste the emoji)')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions),

    name: 'emojirob',
    description: 'Steal an emoji from another server and add it to this one',
    usage: '!emojirob <emoji>',

    async execute(interaction, args) {
        const isSlash = !args;

        try {
            let emojiInput;

            if (isSlash) {
                emojiInput = interaction.options.getString('emoji');
            } else {
                const msg = interaction;
                if (!args || args.length === 0) {
                    return await msg.reply('Please provide an emoji to steal.\nUsage: `!emojirob <emoji>`');
                }
                emojiInput = args[0];
            }

            // Parse the emoji - supports both <:name:id> and <a:name:id> formats
            const parsed = parseEmoji(emojiInput);

            if (!parsed || !parsed.id) {
                const errorMsg = 'That doesn\'t look like a custom emoji. Default emojis can\'t be stolen — they\'re already everywhere!';
                return await (isSlash
                    ? interaction.reply({ content: errorMsg, ephemeral: true })
                    : interaction.reply(errorMsg));
            }

            const ext = parsed.animated ? 'gif' : 'png';
            const emojiUrl = `https://cdn.discordapp.com/emojis/${parsed.id}.${ext}`;
            const emojiName = parsed.name;

            if (isSlash) await interaction.deferReply();

            const guild = isSlash ? interaction.guild : interaction.guild;

            const created = await guild.emojis.create({
                attachment: emojiUrl,
                name: emojiName,
            });

            const successMsg = `Successfully stolen ${created} as \`:${created.name}:\`!`;

            if (isSlash) {
                await interaction.editReply(successMsg);
            } else {
                await interaction.reply(successMsg);
            }

        } catch (error) {
            console.error('Error in emojirob command:', error);

            let errorMsg = 'Failed to steal that emoji.';
            if (error.code === 30008) {
                errorMsg = 'This server has reached the maximum number of emojis!';
            } else if (error.code === 50013) {
                errorMsg = 'I don\'t have permission to manage emojis in this server.';
            }

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
