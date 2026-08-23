const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const {
  OUTPUT_DIR,
  CREATION_LOG,
  PENDING_DB,
  PUBLISH_RESULTS,
  CATALOG_INDEX,
  ensureDir,
  readJson,
} = require('./store');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS creation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  mock INTEGER NOT NULL DEFAULT 0,
  payload TEXT
);

CREATE TABLE IF NOT EXISTS catalog_items (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  excluded INTEGER NOT NULL DEFAULT 0,
  channel TEXT,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  parent TEXT,
  folder TEXT,
  root TEXT,
  ext TEXT,
  kind TEXT,
  media TEXT,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  title TEXT,
  video_path TEXT,
  watched INTEGER NOT NULL DEFAULT 0,
  needs_approval INTEGER NOT NULL DEFAULT 1,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS publish_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT,
  ts TEXT NOT NULL,
  mock INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS engine_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  name TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  file TEXT,
  detail TEXT NOT NULL,
  fixed INTEGER NOT NULL DEFAULT 0,
  scanned_at TEXT NOT NULL
);
`;

let singleton = null;
let singletonPath = null;

function defaultDbPath() {
  return process.env.STUDIO_SQLITE_PATH || path.join(OUTPUT_DIR, 'studio.db');
}

function nowIso() {
  return new Date().toISOString();
}

function getDb(dbPath = defaultDbPath()) {
  if (singleton && singletonPath === dbPath) {
    return singleton;
  }
  if (singleton) {
    try {
      singleton.close();
    } catch {
      // ignore close errors when switching test databases
    }
    singleton = null;
    singletonPath = null;
  }
  ensureDir(path.dirname(dbPath));
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 8000;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  singleton = db;
  singletonPath = dbPath;
  return db;
}

function closeDb() {
  if (singleton) {
    try {
      singleton.close();
    } catch {
      // ignore
    }
    singleton = null;
    singletonPath = null;
  }
}

function setMeta(db, key, value) {
  db.prepare(
    'INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, String(value ?? ''));
}

function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row?.value ?? null;
}

function runWrite(label, fn) {
  try {
    return fn(getDb());
  } catch (error) {
    if (error && error.code === 'ERR_SQLITE_ERROR') {
      console.warn(`sqlite ${label} skipped: ${error.message}`);
      return null;
    }
    throw error;
  }
}

function insertLog(record) {
  return runWrite('insertLog', (db) => {
    db.prepare(
      `INSERT INTO creation_log(ts, level, source, message, mock, payload)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      record.ts ?? nowIso(),
      record.level ?? 'info',
      record.source ?? 'studio',
      String(record.message ?? ''),
      record.mock ? 1 : 0,
      JSON.stringify(record),
    );
  });
}

function readLogRows(limit = 120) {
  try {
    const rows = getDb().prepare(
      'SELECT payload FROM creation_log ORDER BY id DESC LIMIT ?',
    ).all(Math.max(1, Number(limit) || 120));
    return rows
      .map((row) => {
        try {
          return JSON.parse(row.payload);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  } catch {
    return [];
  }
}

function clearLogRows() {
  return runWrite('clearLog', (db) => {
    db.exec('DELETE FROM creation_log');
  });
}

function replaceCatalog(catalog) {
  return runWrite('replaceCatalog', (db) => {
    db.exec('DELETE FROM catalog_items');
    const stmt = db.prepare(
      `INSERT INTO catalog_items(
        id, role, excluded, channel, name, path, parent, folder, root, ext, kind, media, payload, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updatedAt = catalog.scannedAt ?? nowIso();
    for (const item of catalog.items ?? []) {
      const id = String(item.id || item.path);
      stmt.run(
        id,
        item.role ?? 'tracks',
        item.excluded ? 1 : 0,
        item.channel ?? null,
        item.name ?? path.basename(item.path ?? id),
        item.path ?? id,
        item.parent ?? null,
        item.folder ?? null,
        item.root ?? null,
        item.ext ?? null,
        item.kind ?? null,
        item.media ?? null,
        JSON.stringify(item),
        updatedAt,
      );
    }
    setMeta(db, 'catalog_scanned_at', updatedAt);
    setMeta(db, 'catalog_counts', JSON.stringify(catalog.counts ?? {}));
  });
}

function replaceCampaigns(queue) {
  return runWrite('replaceCampaigns', (db) => {
    db.exec('DELETE FROM campaigns');
    const stmt = db.prepare(
      `INSERT INTO campaigns(
        id, status, title, video_path, watched, needs_approval, payload, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updatedAt = nowIso();
    for (const campaign of queue ?? []) {
      const createdAt = campaign.createdAt ?? updatedAt;
      const watched = Boolean(campaign.watched);
      const status = watched ? 'watched' : 'pending';
      stmt.run(
        String(campaign.id),
        status,
        campaign.title ?? null,
        campaign.videoPath ?? null,
        watched ? 1 : 0,
        campaign.needsApproval === false ? 0 : 1,
        JSON.stringify(campaign),
        createdAt,
        updatedAt,
      );
    }
  });
}

function insertPublish(entry) {
  return runWrite('insertPublish', (db) => {
    db.prepare(
      `INSERT INTO publish_history(campaign_id, ts, mock, success, payload)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      entry.campaignId ?? null,
      entry.publishedAt ?? nowIso(),
      entry.mock ? 1 : 0,
      entry.success === false ? 0 : 1,
      JSON.stringify(entry),
    );
  });
}

function setEngineState(key, value) {
  return runWrite('setEngineState', (db) => {
    db.prepare(
      `INSERT INTO engine_state(key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(key, JSON.stringify(value), nowIso());
  });
}

function upsertMcpServer(server) {
  return runWrite('upsertMcpServer', (db) => {
    db.prepare(
      `INSERT INTO mcp_servers(name, kind, status, detail, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         kind = excluded.kind,
         status = excluded.status,
         detail = excluded.detail,
         updated_at = excluded.updated_at`,
    ).run(
      server.name,
      server.kind ?? 'unknown',
      server.status,
      server.detail ?? null,
      nowIso(),
    );
  });
}

function replaceScanFindings(findings) {
  return runWrite('replaceScanFindings', (db) => {
    db.exec('DELETE FROM scan_findings');
    const stmt = db.prepare(
      `INSERT INTO scan_findings(kind, severity, file, detail, fixed, scanned_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const scannedAt = nowIso();
    for (const finding of findings ?? []) {
      stmt.run(
        finding.kind,
        finding.severity ?? 'info',
        finding.file ?? null,
        finding.detail,
        finding.fixed ? 1 : 0,
        scannedAt,
      );
    }
    setMeta(db, 'last_scan_at', scannedAt);
  });
}

function listScanFindings() {
  try {
    return getDb().prepare(
      'SELECT kind, severity, file, detail, fixed, scanned_at FROM scan_findings ORDER BY id',
    ).all();
  } catch {
    return [];
  }
}

function listMcpServers() {
  try {
    return getDb().prepare(
      'SELECT name, kind, status, detail, updated_at FROM mcp_servers ORDER BY name',
    ).all();
  } catch {
    return [];
  }
}

function importJsonStores() {
  const imported = {
    log: 0,
    campaigns: 0,
    publish: 0,
    catalog: 0,
  };

  if (fs.existsSync(CREATION_LOG)) {
    const lines = fs.readFileSync(CREATION_LOG, 'utf-8').split('\n').filter(Boolean);
    const existing = getDb().prepare('SELECT COUNT(*) AS n FROM creation_log').get();
    if (!existing?.n) {
      for (const line of lines.slice(-400)) {
        try {
          insertLog(JSON.parse(line));
          imported.log += 1;
        } catch {
          // skip corrupt jsonl
        }
      }
    }
  }

  const pending = readJson(PENDING_DB, []);
  if (Array.isArray(pending) && pending.length) {
    replaceCampaigns(pending);
    imported.campaigns = pending.length;
  }

  const history = readJson(PUBLISH_RESULTS, []);
  const historyCount = getDb().prepare('SELECT COUNT(*) AS n FROM publish_history').get();
  if (Array.isArray(history) && history.length && !historyCount?.n) {
    for (const entry of history.slice(0, 200)) {
      insertPublish(entry);
      imported.publish += 1;
    }
  }

  const catalog = readJson(CATALOG_INDEX, null);
  if (catalog?.items?.length) {
    replaceCatalog(catalog);
    imported.catalog = catalog.items.length;
  }

  return imported;
}

function tableCounts() {
  const db = getDb();
  const names = [
    'creation_log',
    'catalog_items',
    'campaigns',
    'publish_history',
    'engine_state',
    'mcp_servers',
    'scan_findings',
  ];
  const counts = {};
  for (const name of names) {
    counts[name] = db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get()?.n ?? 0;
  }
  return counts;
}

function health() {
  const dbPath = defaultDbPath();
  const db = getDb(dbPath);
  const counts = tableCounts();
  return {
    ok: true,
    mock: false,
    engine: 'node:sqlite',
    path: dbPath,
    exists: fs.existsSync(dbPath),
    bytes: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0,
    installedAt: getMeta(db, 'installed_at'),
    lastScanAt: getMeta(db, 'last_scan_at'),
    catalogScannedAt: getMeta(db, 'catalog_scanned_at'),
    counts,
  };
}

function installStudioSql({ importExisting = true } = {}) {
  const dbPath = defaultDbPath();
  const db = getDb(dbPath);
  if (!getMeta(db, 'installed_at')) {
    setMeta(db, 'installed_at', nowIso());
  }
  setMeta(db, 'engine', 'node:sqlite');
  const imported = importExisting ? importJsonStores() : {
    log: 0,
    campaigns: 0,
    publish: 0,
    catalog: 0,
  };
  return {
    success: true,
    mock: false,
    ...health(),
    imported,
  };
}

module.exports = {
  SCHEMA,
  defaultDbPath,
  getDb,
  closeDb,
  insertLog,
  readLogRows,
  clearLogRows,
  replaceCatalog,
  replaceCampaigns,
  insertPublish,
  setEngineState,
  upsertMcpServer,
  replaceScanFindings,
  listScanFindings,
  listMcpServers,
  importJsonStores,
  tableCounts,
  health,
  installStudioSql,
};
