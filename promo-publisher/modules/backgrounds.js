const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  BG_INDEX,
  BACKGROUNDS_DIR,
  MEDIA_DIR,
  ensureDir,
  readJson,
  writeJson,
} = require('./store');
const { appendLog, snapshotState } = require('./creation-log');
const { resolveMediaRoots } = require('./engines');

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.cache',
  '__pycache__',
  'dist',
  'build',
  '.electron-user-data',
]);
const NAMED_FOLDERS = new Set([
  'backgrounds',
  'background',
  'covers',
  'artwork',
  'artworks',
  'visuals',
  'reels',
  'stock',
  'images',
  'image',
  'downloaded',
  'downloads',
  'wallpapers',
  'thumbs',
  'thumbnails',
  'trackart',
  'track-art',
  'track_art',
  'art',
  'bg',
  'bgs',
  'stills',
]);
const MAX_FILES = 4000;
const MAX_WALK = 14000;
const MAX_BYTES = 40 * 1024 * 1024;
const MIN_BYTES = 32;

function fileId(filePath) {
  return crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 16);
}

function sanitizeName(value) {
  return String(value ?? `bg_${Date.now()}.png`)
    .replace(/[^\w.\- ()\[\]]+/g, '_')
    .slice(0, 80) || `bg_${Date.now()}.png`;
}

function splitRoots(raw) {
  return String(raw ?? '')
    .split(/[;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isExistingDir(dir) {
  try {
    return Boolean(dir) && fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function findNamedImageFolders(root, maxDepth) {
  const found = [];
  const seen = new Set();

  function walk(dir, depth) {
    if (depth > maxDepth || found.length >= 200) {
      return;
    }
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) {
      return;
    }
    seen.add(resolved);
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const name = entry.name.toLowerCase();
      if (name.startsWith('.') || SKIP_DIRS.has(name)) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (NAMED_FOLDERS.has(name)) {
        found.push(full);
      }
      walk(full, depth + 1);
    }
  }

  walk(root, 0);
  return found;
}

function resolveBackgroundRoots() {
  const extra = splitRoots(process.env.SHIBASS_BG_ROOTS);
  const dedicated = [
    BACKGROUNDS_DIR,
    MEDIA_DIR,
    path.join(__dirname, '..', 'media', 'backgrounds'),
    'C:\\Users\\shibass\\Downloads',
    'C:\\Users\\shibass\\Pictures',
    'C:\\Users\\shibass\\Music',
    'C:\\Users\\shibass\\Documents\\ShiBass Synth Samples',
    'H:\\shibass-ai\\00_INBOX',
    'H:\\shibass-ai\\01_SAMPLES',
    'H:\\shibass-ai\\10_OUTPUTS',
    'H:\\shibass-ai\\backgrounds',
    'H:\\ShiBass_Cubase_Projects',
  ];
  const existing = [...new Set([...extra, ...dedicated])].filter(isExistingDir);
  const discovered = [];
  for (const root of resolveMediaRoots()) {
    discovered.push(...findNamedImageFolders(root, 3));
  }
  return [...new Set([...existing, ...discovered])].filter(isExistingDir);
}

function walkImages(root, acc, walkState) {
  if (acc.length >= MAX_FILES || walkState.visited >= MAX_WALK) {
    return acc;
  }
  const resolved = path.resolve(root);
  if (walkState.seen.has(resolved)) {
    return acc;
  }
  walkState.seen.add(resolved);

  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return acc;
  }

  for (const entry of entries) {
    if (acc.length >= MAX_FILES || walkState.visited >= MAX_WALK) {
      break;
    }
    walkState.visited += 1;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const name = entry.name.toLowerCase();
      if (name.startsWith('.') || SKIP_DIRS.has(name)) {
        continue;
      }
      walkImages(full, acc, walkState);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!IMAGE_EXT.has(ext)) {
      continue;
    }
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.size < MIN_BYTES || stat.size > MAX_BYTES) {
      continue;
    }
    acc.push({
      id: fileId(full),
      name: entry.name,
      path: full,
      ext,
      bytes: stat.size,
      mtime: stat.mtime.toISOString(),
    });
  }
  return acc;
}

function emptyIndex() {
  return {
    scannedAt: null,
    mock: false,
    roots: [],
    images: [],
  };
}

async function scanBackgrounds({ roots } = {}) {
  const scanRoots = (roots?.length ? roots : resolveBackgroundRoots()).filter(isExistingDir);
  if (!scanRoots.length) {
    ensureDir(BACKGROUNDS_DIR);
    scanRoots.push(BACKGROUNDS_DIR);
  }

  const collected = [];
  const walkState = { seen: new Set(), visited: 0 };
  for (const root of scanRoots) {
    walkImages(root, collected, walkState);
  }

  const unique = [];
  const seenIds = new Set();
  for (const image of collected) {
    if (seenIds.has(image.id)) {
      continue;
    }
    seenIds.add(image.id);
    unique.push(image);
  }
  unique.sort((a, b) => a.name.localeCompare(b.name));

  const index = {
    scannedAt: new Date().toISOString(),
    mock: false,
    roots: scanRoots,
    images: unique,
  };
  writeJson(BG_INDEX, index);
  appendLog({
    source: 'backgrounds',
    message: `Background scan complete — ${index.images.length} images from ${scanRoots.length} roots`,
    roots: scanRoots,
    images: index.images.length,
  });
  snapshotState({
    backgroundIndex: { images: index.images.length, scannedAt: index.scannedAt },
  });
  return index;
}

function getIndex() {
  return readJson(BG_INDEX, emptyIndex());
}

function getBackground(id) {
  if (!id) {
    return null;
  }
  return getIndex().images.find((image) => image.id === id) ?? null;
}

function writeUploadedBackground(buffer, fileName) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Empty upload');
  }
  ensureDir(BACKGROUNDS_DIR);
  const ext = path.extname(fileName || '').toLowerCase();
  if (!IMAGE_EXT.has(ext)) {
    throw new Error('Only JPG, PNG, WEBP, or BMP backgrounds are allowed');
  }
  const dest = path.join(BACKGROUNDS_DIR, sanitizeName(fileName));
  fs.writeFileSync(dest, buffer);
  return dest;
}

module.exports = {
  IMAGE_EXT,
  NAMED_FOLDERS,
  fileId,
  sanitizeName,
  resolveBackgroundRoots,
  scanBackgrounds,
  getIndex,
  getBackground,
  writeUploadedBackground,
};
