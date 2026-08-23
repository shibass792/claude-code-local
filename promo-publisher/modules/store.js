const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'output');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

function resolveFromRoot(relativePath) {
  if (!relativePath || typeof relativePath !== 'string') {
    return null;
  }
  const resolved = path.resolve(ROOT, relativePath);
  const rootPrefix = ROOT.endsWith(path.sep) ? ROOT : `${ROOT}${path.sep}`;
  if (resolved !== ROOT && !resolved.startsWith(rootPrefix)) {
    return null;
  }
  return resolved;
}

module.exports = {
  ROOT,
  OUTPUT_DIR,
  MEDIA_DIR: path.join(ROOT, 'media'),
  PENDING_DB: path.join(OUTPUT_DIR, 'pending_campaigns.json'),
  RADAR_DB: path.join(OUTPUT_DIR, 'radar_feed.json'),
  PUBLISH_RESULTS: path.join(OUTPUT_DIR, 'publish_results.json'),
  MUSIC_INDEX: path.join(OUTPUT_DIR, 'music_index.json'),
  BG_INDEX: path.join(OUTPUT_DIR, 'backgrounds_index.json'),
  CATALOG_INDEX: path.join(OUTPUT_DIR, 'catalog.json'),
  SQLITE_DB: process.env.STUDIO_SQLITE_PATH || path.join(OUTPUT_DIR, 'studio.db'),
  BACKGROUNDS_DIR: path.join(ROOT, 'backgrounds'),
  CREATION_LOG: path.join(OUTPUT_DIR, 'creation_log.jsonl'),
  WATCHLIST: path.join(ROOT, 'config', 'watchlist.json'),
  ensureDir,
  readJson,
  writeJson,
  resolveFromRoot,
};
