const { SlashCommandBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const Jimp = require('jimp');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('grayscale')
        .setDescription('Convert an image to grayscale')
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('The image to convert to grayscale')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('url')
                .setDescription('URL of the image to convert')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    name: 'grayscale',
    description: 'Convert an image to grayscale',
    usage: '!grayscale [attach image or provide URL]',

    async execute(interaction, args) {
        const isSlash = !args; // If args is undefined, it's a slash command
        
        try {
            let imageUrl = null;

            if (isSlash) {
                // Slash command
                const attachment = interaction.options.getAttachment('image');
                const url = interaction.options.getString('url');

                if (attachment) {
                    if (!attachment.contentType?.startsWith('image/')) {
                        return await interaction.reply({
                            content: 'Please provide a valid image file.',
                            ephemeral: true
                        });
                    }
                    imageUrl = attachment.url;
                } else if (url) {
                    if (!this.isValidImageUrl(url)) {
                        return await interaction.reply({
                            content: 'Please provide a valid image URL.',
                            ephemeral: true
                        });
                    }
                    imageUrl = url;
                } else {
                    return await interaction.reply({
                        content: 'Please provide an image attachment or URL.',
                        ephemeral: true
                    });
                }

                await interaction.deferReply();
            } else {
                // Prefix command
                const message = interaction; // interaction is actually message for prefix commands

                if (message.attachments.size > 0) {
                    const attachment = message.attachments.first();
                    if (!attachment.contentType?.startsWith('image/')) {
                        return await message.reply('Please provide a valid image file.');
                    }
                    imageUrl = attachment.url;
                } else if (args.length > 0) {
                    const url = args[0];
                    if (!this.isValidImageUrl(url)) {
                        return await message.reply('Please provide a valid image URL.');
                    }
                    imageUrl = url;
                } else {
                    return await message.reply('Please provide an image attachment or URL.\nUsage: `!grayscale [image_url]` or attach an image.');
                }

                const loadingMsg = await message.reply('🎨 Processing image...');
                
                try {
                    const result = await this.processImage(imageUrl);
                    await loadingMsg.edit({
                        content: '✅ Here\'s your grayscale image:',
                        files: [result]
                    });
                } catch (error) {
                    await loadingMsg.edit('❌ Failed to process the image. Please make sure it\'s a valid image URL or file.');
                }
                return;
            }

            // Process image for slash command
            const result = await this.processImage(imageUrl);
            await interaction.editReply({
                content: '✅ Here\'s your grayscale image:',
                files: [result]
            });

        } catch (error) {
            console.error('Error in grayscale command:', error);
            const errorMsg = 'There was an error processing the image. Please make sure it\'s a valid image.';
            
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
    },

    async processImage(imageUrl) {
        // Load image with Jimp
        const image = await Jimp.read(imageUrl);
        
        // Apply grayscale filter
        image.grayscale();

        // Convert to buffer
        const buffer = await image.getBufferAsync(Jimp.MIME_PNG);

        // Create attachment
        return new AttachmentBuilder(buffer, { name: 'grayscale_image.png' });
    },

    isValidImageUrl(url) {
        try {
            new URL(url);
            return /\.(jpg|jpeg|png|gif|bmp|webp)(\?.*)?$/i.test(url);
        } catch {
            return false;
        }
    }
};