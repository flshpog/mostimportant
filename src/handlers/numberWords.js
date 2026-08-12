// Reusable number-answer helper: resolves a spelled-out number word or a digit
// string to a single canonical digit string, so "4" and "four" compare equal.
// Extend WORDS if a future round needs numbers beyond ten.
const WORDS = {
    zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
    six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
};

// Returns the canonical digit string for a token, or the token unchanged if it
// isn't a recognised number.
function canonical(token) {
    const t = String(token).trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(WORDS, t)) return WORDS[t];
    if (/^\d+$/.test(t)) return String(Number(t)); // normalise e.g. "04" -> "4"
    return t;
}

module.exports = { canonical, WORDS };
