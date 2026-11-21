const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, PermissionsBitField } = require('discord.js');

// Discord's hard cap on a bot message. Nitro users can post up to 4000, so longer
// source messages get split rather than truncated.
const MAX_CONTENT = 2000;
const TEXT_CHANNELS = [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread,
];

function splitContent(text) {
    if (text.length <= MAX_CONTENT) return [text];
    const parts = [];
    let rest = text;
    while (rest.length > MAX_CONTENT) {
        // Prefer breaking on a newline so formatting survives the split.
        let cut = rest.lastIndexOf('\n', MAX_CONTENT);
        if (cut <= 0) cut = MAX_CONTENT;
        parts.push(rest.slice(0, cut));
        rest = rest.slice(cut);
    }
    if (rest.length) parts.push(rest);
    return parts;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('recite')
        .setDescription('Copy every message from a start message to an end message into another channel.')
        .addStringOption(o => o.setName('start')
            .setDescription('ID of the first message to copy')
            .setRequired(true))
        .addStringOption(o => o.setName('end')
            .setDescription('ID of the last message to copy')
            .setRequired(true))
        .addChannelOption(o => o.setName('to')
            .setDescription('Channel to post the copies in')
            .addChannelTypes(...TEXT_CHANNELS)
            .setRequired(true))
        .addChannelOption(o => o.setName('from')
            .setDescription('Channel the messages are in (defaults to this channel)')
            .addChannelTypes(...TEXT_CHANNELS)
            .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        const startId = interaction.options.getString('start').trim();
        const endId = interaction.options.getString('end').trim();
        const target = interaction.options.getChannel('to');
        const source = interaction.options.getChannel('from') || interaction.channel;

        if (!/^\d{15,22}$/.test(startId) || !/^\d{15,22}$/.test(endId)) {
            return interaction.reply({ content: 'Those don\'t look like message IDs. Right-click a message and choose Copy Message ID.', ephemeral: true });
        }
        if (source.id === target.id) {
            return interaction.reply({ content: 'The destination has to be a different channel.', ephemeral: true });
        }

        // The caller must be able to read the source themselves, otherwise this
        // would let a mod copy out a channel they can't see (confessionals etc).
        const userSrc = source.permissionsFor(interaction.member);
        if (!userSrc?.has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory])) {
            return interaction.reply({ content: `You can't read the history in ${source}.`, ephemeral: true });
        }
        const userDst = target.permissionsFor(interaction.member);
        if (!userDst?.has(PermissionsBitField.Flags.SendMessages)) {
            return interaction.reply({ content: `You can't send messages in ${target}.`, ephemeral: true });
        }
        const me = interaction.guild.members.me;
        if (!source.permissionsFor(me)?.has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory])) {
            return interaction.reply({ content: `I can't read the history in ${source}.`, ephemeral: true });
        }
        if (!target.permissionsFor(me)?.has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles])) {
            return interaction.reply({ content: `I need View Channel, Send Messages and Attach Files in ${target}.`, ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        // Allow the IDs in either order.
        let [firstId, lastId] = BigInt(startId) <= BigInt(endId) ? [startId, endId] : [endId, startId];

        let first;
        try {
            first = await source.messages.fetch(firstId);
            await source.messages.fetch(lastId);
        } catch {
            return interaction.editReply(`I couldn't find both messages in ${source}. Check the IDs and the from channel.`);
        }

        // Collect the range oldest-first: the first message, then page forward with `after`.
        const messages = [first];
        let cursor = firstId;
        const last = BigInt(lastId);
        outer: while (true) {
            const page = await source.messages.fetch({ after: cursor, limit: 100 });
            if (page.size === 0) break;
            const sorted = [...page.values()].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
            for (const msg of sorted) {
                if (BigInt(msg.id) > last) break outer;
                messages.push(msg);
            }
            cursor = sorted[sorted.length - 1].id;
            if (BigInt(cursor) >= last) break;
        }

        await interaction.editReply(`Copying ${messages.length} message${messages.length === 1 ? '' : 's'} from ${source} to ${target}...`);

        let sent = 0;
        let skipped = 0;
        for (const msg of messages) {
            const files = [...msg.attachments.values()].map(a => ({ attachment: a.url, name: a.name }));
            // Bot-authored embeds (e.g. shop posts) are copied too; link previews
            // regenerate on their own from the content.
            const embeds = msg.author.bot ? msg.embeds.map(e => e.toJSON()) : [];
            const parts = msg.content ? splitContent(msg.content) : [];

            if (parts.length === 0 && files.length === 0 && embeds.length === 0) {
                skipped++; // system messages, sticker-only messages, polls
                continue;
            }
            if (parts.length === 0) parts.push(undefined);

            try {
                for (let i = 0; i < parts.length; i++) {
                    const isLast = i === parts.length - 1;
                    await target.send({
                        content: parts[i],
                        files: isLast ? files : [],
                        embeds: isLast ? embeds : [],
                        // Never ping anyone: the copy is character for character, mentions included.
                        allowedMentions: { parse: [] },
                    });
                }
                sent++;
            } catch (err) {
                console.error(`recite: failed to copy message ${msg.id}:`, err);
                skipped++;
            }
        }

        const note = skipped ? ` ${skipped} skipped (empty, sticker-only, or failed to send).` : '';
        await interaction.editReply(`Done. Copied ${sent} message${sent === 1 ? '' : 's'} from ${source} to ${target}.${note}`)
            .catch(() => {}); // interaction token expires after 15 minutes on very long runs
    },
};
