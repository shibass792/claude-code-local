const fs = require('fs');
const path = require('path');
const { OUTPUT_DIR, ensureDir } = require('../store');

const LOG_PATH = path.join(OUTPUT_DIR, 'creation_log.jsonl');
const MAX_ENTRIES = 400;

function nowIso() {
  return new Date().toISOString();
}

function appendLog(entry) {
  const record = {
    ts: nowIso(),
    level: entry.level ?? 'info',
    engine: entry.engine ?? 'system',
    event: entry.event ?? 'note',
    message: entry.message ?? '',
    data: entry.data ?? {},
  };

  ensureDir(OUTPUT_DIR);
  fs.appendFileSync(LOG_PATH, `${JSON.stringify(record)}\n`, 'utf-8');
  return record;
}

function readLog(limit = 80) {
  if (!fs.existsSync(LOG_PATH)) {
    return [];
  }

  const lines = fs.readFileSync(LOG_PATH, 'utf-8').split('\n').filter(Boolean);
  const parsed = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      parsed.push({
        ts: nowIso(),
        level: 'error',
        engine: 'log',
        event: 'parse_error',
        message: 'Skipped unreadable log line',
        data: { line: line.slice(0, 120) },
      });
    }
  }

  return parsed.slice(-Math.max(1, Number(limit) || 80));
}

function formatLogLine(entry) {
  const stamp = entry.ts ?? nowIso();
  const tag = `[${String(entry.engine ?? 'sys').toUpperCase()}]`;
  return `${stamp} ${tag} ${entry.event}: ${entry.message}`;
}

function clearLog() {
  ensureDir(OUTPUT_DIR);
  fs.writeFileSync(LOG_PATH, '', 'utf-8');
  return appendLog({
    engine: 'log',
    event: 'cleared',
    message: 'Creation log reset by user',
  });
}

function trimLog() {
  const entries = readLog(MAX_ENTRIES);
  ensureDir(OUTPUT_DIR);
  fs.writeFileSync(
    LOG_PATH,
    `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    'utf-8',
  );
}

module.exports = {
  LOG_PATH,
  appendLog,
  readLog,
  formatLogLine,
  clearLog,
  trimLog,
};
