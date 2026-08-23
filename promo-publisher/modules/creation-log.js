const { CREATION_LOG, readJson, writeJson } = require('./store');

const MAX_ENTRIES = 400;

function nowIso() {
  return new Date().toISOString();
}

function readLog() {
  const stored = readJson(CREATION_LOG, { entries: [] });
  return Array.isArray(stored.entries) ? stored.entries : [];
}

function writeLog(entries) {
  writeJson(CREATION_LOG, {
    updatedAt: nowIso(),
    entries: entries.slice(-MAX_ENTRIES),
  });
}

function appendLog(level, source, message, extra) {
  if (typeof message !== 'string' || message.trim() === '') {
    throw new Error('Log message is required');
  }

  const entry = {
    ts: nowIso(),
    level: level ?? 'info',
    source: source ?? 'studio',
    message: message.trim(),
    extra: extra && typeof extra === 'object' ? extra : undefined,
  };

  const entries = readLog();
  entries.push(entry);
  writeLog(entries);
  return entry;
}

function formatLine(entry) {
  const stamp = entry.ts ? entry.ts.replace('T', ' ').replace('Z', '') : '';
  const extra = entry.extra ? ` ${JSON.stringify(entry.extra)}` : '';
  return `[${stamp}] [${String(entry.level).toUpperCase()}] [${entry.source}] ${entry.message}${extra}`;
}

function getFormattedLog() {
  return readLog().map(formatLine).join('\n');
}

function clearLog() {
  writeLog([]);
  return { cleared: true };
}

module.exports = {
  readLog,
  appendLog,
  getFormattedLog,
  clearLog,
  formatLine,
};
