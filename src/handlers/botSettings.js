const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, '../../data/botSettings.json');

function load() {
    try {
        return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    } catch {
        const data = { voiceTranscriptionEnabled: true };
        save(data);
        return data;
    }
}

function save(data) {
    if (!fs.existsSync(path.dirname(SETTINGS_PATH))) {
        fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    }
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2));
}

function isVoiceTranscriptionEnabled() {
    return load().voiceTranscriptionEnabled !== false;
}

function setVoiceTranscription(enabled) {
    const data = load();
    data.voiceTranscriptionEnabled = enabled;
    save(data);
}

module.exports = {
    isVoiceTranscriptionEnabled,
    setVoiceTranscription,
};
