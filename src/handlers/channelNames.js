// Discord rejects a channel name longer than 100 characters with a 50035
// "Invalid Form Body" and refuses to create the channel at all. Since these
// commands build names by joining role names together, a couple of long ones
// blows the limit easily — and an alliance of four does it reliably.

const MAX_CHANNEL_NAME = 100;

// Role name -> channel-name-safe fragment. Runs of invalid characters collapse
// to one dash rather than one dash each, so "Big Bird 🐦" is "big-bird", not
// "big-bird----".
function slugify(part) {
    return String(part)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// Joins parts into a channel name that Discord will accept. Over the limit, each
// part is shortened evenly instead of truncating the whole string — a 1-on-1
// channel named after only the first player would be useless for telling them
// apart. Returns 'channel' if the parts contain nothing usable at all.
function toChannelName(parts, max = MAX_CHANNEL_NAME) {
    const clean = (Array.isArray(parts) ? parts : [parts]).map(slugify).filter(Boolean);
    if (clean.length === 0) return 'channel';

    const joined = clean.join('-');
    if (joined.length <= max) return joined;

    // Leave room for the dashes between parts, then split what's left evenly.
    const separators = clean.length - 1;
    const budget = Math.max(1, Math.floor((max - separators) / clean.length));
    const shortened = clean
        .map(part => part.slice(0, budget).replace(/-+$/, ''))
        .filter(Boolean)
        .join('-');

    return shortened.slice(0, max).replace(/-+$/, '') || 'channel';
}

module.exports = { toChannelName, slugify, MAX_CHANNEL_NAME };
