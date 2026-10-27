const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { ensureHost } = require('../../handlers/hostGate');
const totemGrab = require('../../handlers/totemGrab');

// Host-only. Start runs the full schedule in the given channel and posts the live
// leaderboard in the channel the command is run from (always inside the host
// category). Stop locks scores early. Neither posts anything in the totem channel.
module.exports = {
    data: new SlashCommandBuilder()
        .setName('totemgrab')
        .setDescription('Run the Totem Grab redemption challenge (host only).')
        .addSubcommand(s => s
            .setName('start')
            .setDescription('Start Totem Grab. The leaderboard posts in this channel.')
            .addChannelOption(o => o
                .setName('channel')
                .setDescription('The #totem-grab channel')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)))
        .addSubcommand(s => s
            .setName('stop')
            .setDescription('Stop Totem Grab now and lock the scores.')),

    async execute(interaction) {
        if (!(await ensureHost(interaction))) return;

        const client = interaction.client;
        const guildId = interaction.guildId;
        const sub = interaction.options.getSubcommand();

        if (sub === 'start') {
            if (totemGrab.getState(guildId)?.active) {
                return interaction.reply({ content: 'Totem Grab is already running. Use `/totemgrab stop` first.', ephemeral: true });
            }
            const channel = interaction.options.getChannel('channel');
            await interaction.deferReply({ ephemeral: true });
            const state = await totemGrab.startGame(client, guildId, channel.id, interaction.channelId);
            const real = state.events.filter(e => e.type === 'real').length;
            const fake = state.events.length - real;
            const first = state.events[0];
            return interaction.editReply(
                `Totem Grab started in ${channel}: **${real}** real totems and **${fake}** fakes over the next ` +
                `**${totemGrab.getConfig().duration_hours}h**, ending <t:${Math.floor(state.endTime / 1000)}:f>. ` +
                `First warning <t:${Math.floor(first.warnAt / 1000)}:R>. The leaderboard above updates live.`
            );
        }

        if (sub === 'stop') {
            if (!totemGrab.getState(guildId)?.active) {
                return interaction.reply({ content: 'Totem Grab is not running.', ephemeral: true });
            }
            await interaction.deferReply({ ephemeral: true });
            await totemGrab.endGame(client, guildId, 'stop');
            return interaction.editReply('Totem Grab stopped. Scores are locked and the leaderboard is marked final.');
        }
    },
};
