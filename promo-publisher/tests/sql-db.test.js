const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), `shibass-sql-${process.pid}-${Date.now()}.db`);
process.env.STUDIO_SQLITE_PATH = tmpDb;

const sql = require('../modules/sql-db');
const { appendLog, readLog, clearLog } = require('../modules/creation-log');
const { scanFakeApis } = require('../modules/scan-fake');

test.after(() => {
  sql.closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${tmpDb}${suffix}`;
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
});

test('installStudioSql creates a real SQLite file and schema', () => {
  const installed = sql.installStudioSql({ importExisting: false });
  assert.equal(installed.success, true);
  assert.equal(installed.mock, false);
  assert.equal(installed.engine, 'node:sqlite');
  assert.equal(fs.existsSync(tmpDb), true);
  assert.ok(installed.bytes > 0);
  const db = sql.getDb(tmpDb);
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  ).all().map((row) => row.name);
  assert.ok(tables.includes('catalog_items'));
  assert.ok(tables.includes('creation_log'));
  assert.ok(tables.includes('campaigns'));
  assert.ok(tables.includes('mcp_servers'));
});

test('creation log writes to SQLite and reads back', () => {
  clearLog();
  appendLog({ source: 'sql-test', message: 'real sqlite row', extra: 1 });
  const rows = readLog(10);
  assert.ok(rows.some((row) => row.message === 'real sqlite row' && row.mock === false));
  const health = sql.health();
  assert.ok(health.counts.creation_log >= 1);
});

test('catalog and campaign rows persist in SQLite', () => {
  sql.replaceCatalog({
    scannedAt: new Date().toISOString(),
    counts: { tracks: 1, covers: 0, effects: 0, stems: 0, midi: 0, folders: 1, excludedFm: 0, total: 1 },
    items: [{
      id: 'track-1',
      role: 'tracks',
      excluded: false,
      channel: 'master',
      name: 'Dextamine.wav',
      path: 'H:/shibass-ai/media/Dextamine.wav',
      parent: 'H:/shibass-ai/media',
      folder: 'media',
      ext: '.wav',
      kind: 'audio',
      media: 'audio',
    }],
  });
  sql.replaceCampaigns([{
    id: 'cmp-1',
    title: 'Test reel',
    videoPath: 'output/reel.mp4',
    watched: false,
    needsApproval: true,
    createdAt: new Date().toISOString(),
  }]);
  const counts = sql.tableCounts();
  assert.equal(counts.catalog_items, 1);
  assert.equal(counts.campaigns, 1);
});

test('fake API scan records findings into SQLite', () => {
  const scanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shibass-scan-'));
  fs.writeFileSync(
    path.join(scanDir, 'legacy.html'),
    '⚠️ סימולטור בלבד: אין כאן קריאה אמיתית ל-API\n[SYSTEM] InstaPy Pyt\n',
    'utf-8',
  );
  process.env.SHIBASS_SCAN_ROOT = scanDir;
  process.env.CLAUDE_CONFIG_DIR = path.join(scanDir, 'missing-claude');
  const scan = scanFakeApis(scanDir);
  assert.equal(scan.mock, false);
  assert.ok(scan.fakeCount >= 1);
  assert.ok(scan.findings.some((item) => item.kind === 'simulator_banner'));
  assert.ok(scan.findings.some((item) => item.kind === 'mcp_home_missing'));
  const stored = sql.listScanFindings();
  assert.ok(stored.length >= 1);
  fs.rmSync(scanDir, { recursive: true, force: true });
});
