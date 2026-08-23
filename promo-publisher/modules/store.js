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
  return path.resolve(ROOT, relativePath);
}

module.exports = {
  ROOT,
  OUTPUT_DIR,
  PENDING_DB: path.join(OUTPUT_DIR, 'pending_campaigns.json'),
  RADAR_DB: path.join(OUTPUT_DIR, 'radar_feed.json'),
  PUBLISH_RESULTS: path.join(OUTPUT_DIR, 'publish_results.json'),
  WATCHLIST: path.join(ROOT, 'config', 'watchlist.json'),
  ensureDir,
  readJson,
  writeJson,
  resolveFromRoot,
};
