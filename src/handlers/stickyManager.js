const fs = require('fs');
const path = require('path');

const STICKY_PATH = path.join(__dirname, '../../data/stickies.json');
const processing = new Set();

function loadStickies() {
    try {
        return JSON.parse(fs.readFileSync(STICKY_PATH, 'utf8'));
    } catch {
        const data = {};
        saveStickies(data);
        return data;
    }
}

function saveStickies(data) {
    if (!fs.existsSync(path.dirname(STICKY_PATH))) {
        fs.mkdirSync(path.dirname(STICKY_PATH), { recursive: true });
    }
    fs.writeFileSync(STICKY_PATH, JSON.stringify(data, null, 2));
}

function getSticky(channelId) {
    return loadStickies()[channelId] || null;
}

function setSticky(channelId, content, messageId) {
    const data = loadStickies();
    data[channelId] = { content, messageId };
    saveStickies(data);
}

function removeSticky(channelId) {
    const data = loadStickies();
    delete data[channelId];
    saveStickies(data);
}

async function resendSticky(channel) {
    if (processing.has(channel.id)) return;
    processing.add(channel.id);

    try {
        const sticky = getSticky(channel.id);
        if (!sticky) return;

        // Check if the current sticky is already the most recent message
        try {
            const messages = await channel.messages.fetch({ limit: 1 });
            const latest = messages.first();
            if (latest && latest.id === sticky.messageId) return;
        } catch {}

        // Delete the old sticky
        if (sticky.messageId) {
            try {
                const oldMsg = await channel.messages.fetch(sticky.messageId).catch(() => null);
                if (oldMsg) await oldMsg.delete().catch(() => {});
            } catch {}
        }

        // Send new sticky
        const newMsg = await channel.send(sticky.content).catch(() => null);
        if (newMsg) {
            setSticky(channel.id, sticky.content, newMsg.id);
        }
    } finally {
        processing.delete(channel.id);
    }
}

function startPeriodicCheck(client) {
    setInterval(async () => {
        const data = loadStickies();
        for (const channelId of Object.keys(data)) {
            try {
                const channel = await client.channels.fetch(channelId).catch(() => null);
                if (channel) await resendSticky(channel);
            } catch (error) {
                console.error(`Error checking sticky in ${channelId}:`, error);
            }
        }
    }, 60 * 1000);
}

module.exports = {
    loadStickies,
    saveStickies,
    getSticky,
    setSticky,
    removeSticky,
    resendSticky,
    startPeriodicCheck,
};
