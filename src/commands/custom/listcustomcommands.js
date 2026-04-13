const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('listcustomcommands')
        .setDescription('List all custom commands')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        try {
            const customCommands = Array.from(interaction.client.customCommands.keys());

            if (customCommands.length === 0) {
                return await interaction.reply({
                    content: 'No custom commands have been created yet.',
                    ephemeral: true
                });
            }

            const embed = new EmbedBuilder()
                .setTitle('📝 Custom Commands')
                .setColor(0x5865F2)
                .setDescription(`Here are all the custom commands available on this server:\n\n${customCommands.map(cmd => `\`!${cmd}\``).join('\n')}`)
                .setFooter({ 
                    text: `Total: ${customCommands.length} custom command${customCommands.length !== 1 ? 's' : ''}` 
                })
                .setTimestamp();

            // If there are too many commands, split them into multiple fields
            if (customCommands.length > 20) {
                embed.setDescription('Here are all the custom commands available on this server:');
                
                const commandsPerField = 15;
                for (let i = 0; i < customCommands.length; i += commandsPerField) {
                    const commandChunk = customCommands.slice(i, i + commandsPerField);
                    embed.addFields({
                        name: i === 0 ? 'Commands' : '\u200b',
                        value: commandChunk.map(cmd => `\`!${cmd}\``).join('\n'),
                        inline: true
                    });
                }
            }

            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in listcustomcommands:', error);
            await interaction.reply({
                content: 'There was an error retrieving the custom commands list.',
                ephemeral: true
            });
        }
    },
};