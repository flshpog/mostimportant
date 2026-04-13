module.exports = {
    name: 'snipe',
    description: 'Reposts the most recently deleted message in this channel',
    usage: '!snipe',

    async execute(message, args) {
        const client = message.client;

        // Get the sniped message for this channel
        const snipedMessage = client.snipedMessages?.get(message.channel.id);

        if (!snipedMessage) {
            return await message.reply('There are no recently deleted messages to snipe in this channel.');
        }

        const { EmbedBuilder } = require('discord.js');

        const embed = new EmbedBuilder()
            .setAuthor({
                name: snipedMessage.authorTag,
                iconURL: snipedMessage.authorAvatar
            })
            .setDescription(snipedMessage.content || '*No text content*')
            .setFooter({ text: `Deleted in #${snipedMessage.channelName}` })
            .setTimestamp(snipedMessage.deletedAt)
            .setColor(0x2b2d31);

        // Add attachments if any
        if (snipedMessage.attachments && snipedMessage.attachments.length > 0) {
            const attachmentList = snipedMessage.attachments.join('\n');
            embed.addFields({
                name: 'Attachments',
                value: attachmentList.length > 1024 ? attachmentList.substring(0, 1021) + '...' : attachmentList
            });

            // Try to set the first image attachment as the embed image
            const imageAttachment = snipedMessage.attachments.find(url =>
                /\.(png|jpg|jpeg|gif|webp)(\?|$)/i.test(url)
            );
            if (imageAttachment) {
                embed.setImage(imageAttachment);
            }
        }

        await message.reply({ embeds: [embed] });
    }
};
