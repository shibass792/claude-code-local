const fs = require('fs');
const { CREATION_LOG, ensureDir, readJson, writeJson } = require('./store');
const sql = require('./sql-db');

const MAX_ENTRIES = 400;

function appendLog(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('Log entry must be an object');
  }

  const record = {
    ts: new Date().toISOString(),
    level: entry.level ?? 'info',
    source: entry.source ?? 'studio',
    message: String(entry.message ?? ''),
    ...entry,
    mock: false,
  };

  ensureDir(require('path').dirname(CREATION_LOG));
  fs.appendFileSync(CREATION_LOG, `${JSON.stringify(record)}\n`, 'utf-8');
  sql.insertLog(record);
  return record;
}

function readLog(limit = 120) {
  const fromSql = sql.readLogRows(limit);
  if (fromSql.length) {
    return fromSql;
  }
  if (!fs.existsSync(CREATION_LOG)) {
    return [];
  }

  const lines = fs.readFileSync(CREATION_LOG, 'utf-8').split('\n').filter(Boolean);
  const parsed = [];
  for (const line of lines.slice(-MAX_ENTRIES)) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      // skip corrupt line
    }
  }
  return parsed.slice(-Math.max(1, Number(limit) || 120));
}

function clearLog() {
  ensureDir(require('path').dirname(CREATION_LOG));
  fs.writeFileSync(CREATION_LOG, '', 'utf-8');
  sql.clearLogRows();
  return { cleared: true };
}

function formatLogText(entries) {
  return entries
    .map((item) => {
      const stamp = item.ts ?? '';
      const tag = String(item.source ?? 'studio').toUpperCase();
      return `[${stamp}] [${tag}] ${item.message}`;
    })
    .join('\n');
}

function snapshotState(extra = {}) {
  const file = CREATION_LOG.replace(/creation_log\.jsonl$/, 'engine_state.json');
  const current = readJson(file, {});
  const next = { ...current, ...extra, updatedAt: new Date().toISOString() };
  writeJson(file, next);
  sql.setEngineState('snapshot', next);
  return next;
}

function readState() {
  const file = CREATION_LOG.replace(/creation_log\.jsonl$/, 'engine_state.json');
  return readJson(file, {});
}

module.exports = {
  appendLog,
  readLog,
  clearLog,
  formatLogText,
  snapshotState,
  readState,
};
