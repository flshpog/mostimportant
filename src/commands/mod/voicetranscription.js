const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { isVoiceTranscriptionEnabled, setVoiceTranscription } = require('../../handlers/botSettings');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('voicetranscription')
        .setDescription('Toggle automatic voice message transcription')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(opt =>
            opt.setName('toggle')
                .setDescription('Turn transcription on or off')
                .setRequired(true)
                .addChoices(
                    { name: 'on', value: 'on' },
                    { name: 'off', value: 'off' },
                )),

    async execute(interaction) {
        const toggle = interaction.options.getString('toggle');
        const enabled = toggle === 'on';

        if (enabled === isVoiceTranscriptionEnabled()) {
            return interaction.reply({
                content: `Voice transcription is already **${enabled ? 'on' : 'off'}**.`,
                ephemeral: true,
            });
        }

        setVoiceTranscription(enabled);
        await interaction.reply({
            content: `Voice transcription is now **${enabled ? 'on' : 'off'}**.`,
            ephemeral: true,
        });
    },
};
