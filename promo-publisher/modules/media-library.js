'use strict';

const fs = require('fs');
const path = require('path');
const { OUTPUT_DIR, ensureDir, readJson, writeJson, ROOT } = require('./store');

const INDEX_FILE = path.join(OUTPUT_DIR, 'media_index.json');
const AUDIO_EXT = new Set(['.mp3', '.wav', '.flac', '.aiff', '.aif', '.ogg', '.m4a', '.aac']);
const MIDI_EXT = new Set(['.mid', '.midi']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.mkv']);
const DAW_EXT = new Set(['.cpr', '.npr', '.als', '.alp', '.flp', '.rpp', '.ptx', '.logicx', '.band']);

function defaultRoots() {
  const envRoots = (process.env.SHIBASS_MEDIA_ROOTS || '')
    .split(path.delimiter)
    .map((p) => p.trim())
    .filter(Boolean);

  const candidates = [
    ...envRoots,
    path.join(ROOT, 'fixtures', 'media'),
    path.join(ROOT, 'output', 'media'),
    path.join(ROOT, 'output', 'psy_pack_v3'),
    path.join(ROOT, 'output', 'campaigns'),
    path.join(ROOT, 'output', 'products'),
    process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, 'Documents', 'ShiBass Synth Samples')
      : null,
    process.env.HOME ? path.join(process.env.HOME, 'Music') : null,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Desktop') : null,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Downloads') : null,
    process.env.HOME ? path.join(process.env.HOME, 'Desktop') : null,
    path.join(ROOT, '..'),
    process.env.SHIBASS_ROOT || null,
    'H:\\shibass-ai',
    'H:\\ShiBass_Media',
    'H:\\shibass-ai\\10_OUTPUTS',
    'H:\\ShiBass_Cubase_Projects',
    'H:\\ShiBass_Cubase_Projects\\Audix_Templates',
  ].filter(Boolean);

  return [...new Set(candidates.filter((p) => fs.existsSync(p)))];
}

function classify(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (MIDI_EXT.has(ext)) return 'midi';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (DAW_EXT.has(ext)) return 'daw';
  return null;
}

function parseBpmKey(fileName) {
  const name = String(fileName);
  const bpmMatch = name.match(/(\d{2,3})\s*bpm/i);
  const phr = name.match(/([A-G](?:#|b)?)[_-\s]*phrygian/i);
  const keyOnly = name.match(/(?:^|[_-\s.])([A-G](?:#|b)?)(?:[_-\s](min|maj|minor|major))?(?=[_-\s.]|$)/i);
  let key = null;
  if (phr) {
    key = `${phr[1].toUpperCase()} phrygian`;
  } else if (keyOnly) {
    key = keyOnly[2] ? `${keyOnly[1].toUpperCase()} ${keyOnly[2]}` : keyOnly[1].toUpperCase();
  }
  return {
    bpm: bpmMatch ? Number(bpmMatch[1]) : null,
    key,
  };
}

function walkDir(dir, results, { maxFiles, depth, maxDepth }) {
  if (results.length >= maxFiles || depth > maxDepth) {
    return;
  }

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= maxFiles) {
      return;
    }
    if (entry.name.startsWith('.')) {
      continue;
    }

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, results, { maxFiles, depth: depth + 1, maxDepth });
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const kind = classify(full);
    if (!kind) {
      continue;
    }

    let size = 0;
    let mtime = null;
    try {
      const st = fs.statSync(full);
      size = st.size;
      mtime = st.mtime.toISOString();
    } catch {
      // skip unreadable
      continue;
    }

    const meta = parseBpmKey(entry.name);
    results.push({
      id: Buffer.from(full).toString('base64url'),
      path: full,
      name: entry.name,
      kind,
      ext: path.extname(full).toLowerCase(),
      size,
      mtime,
      root: dir,
      bpm: meta.bpm,
      key: meta.key,
    });
  }
}

function loadIndex() {
  return readJson(INDEX_FILE, {
    scannedAt: null,
    roots: [],
    items: [],
    counts: { audio: 0, midi: 0, video: 0, daw: 0, total: 0 },
  });
}

function saveIndex(payload) {
  ensureDir(OUTPUT_DIR);
  writeJson(INDEX_FILE, payload);
  return payload;
}

function countByKind(items) {
  const counts = { audio: 0, midi: 0, video: 0, daw: 0, total: items.length };
  for (const item of items) {
    if (counts[item.kind] != null) {
      counts[item.kind] += 1;
    }
  }
  return counts;
}

function scanMediaLibrary(options = {}) {
  const roots = (options.roots && options.roots.length ? options.roots : defaultRoots()).filter(
    (p) => fs.existsSync(p),
  );
  const maxFiles = Number(options.maxFiles || process.env.SHIBASS_MEDIA_MAX || 5000);
  const maxDepth = Number(options.maxDepth || 8);
  const items = [];

  for (const root of roots) {
    walkDir(root, items, { maxFiles, depth: 0, maxDepth });
  }

  items.sort((a, b) => a.name.localeCompare(b.name, 'en'));

  const payload = {
    scannedAt: new Date().toISOString(),
    roots,
    items,
    counts: countByKind(items),
    source: 'live-scan',
  };

  return saveIndex(payload);
}

function getLibrary({ kind, limit = 300, q = '' } = {}) {
  const index = loadIndex();
  let items = index.items || [];
  if (kind && kind !== 'all') {
    items = items.filter((item) => item.kind === kind);
  }
  if (q) {
    const needle = String(q).toLowerCase();
    items = items.filter((item) => item.name.toLowerCase().includes(needle));
  }
  return {
    scannedAt: index.scannedAt,
    roots: index.roots || [],
    counts: index.counts || countByKind(index.items || []),
    items: items.slice(0, Number(limit) || 300),
    hasIndex: Boolean(index.scannedAt),
  };
}

function resolveMediaById(id) {
  const index = loadIndex();
  const item = (index.items || []).find((entry) => entry.id === id);
  if (!item) {
    return null;
  }
  if (!fs.existsSync(item.path)) {
    return null;
  }
  return item;
}

function extraAllowedRoots() {
  return [
    process.env.SHIBASS_ROOT,
    path.join(ROOT, '..'),
    process.env.USERPROFILE,
    process.env.HOME,
    'H:\\',
  ].filter(Boolean);
}

function resolveSafePath(candidate) {
  if (!candidate || typeof candidate !== 'string') {
    return null;
  }
  const absolute = path.resolve(candidate);
  const index = loadIndex();
  const allowedRoots = [
    ...(index.roots || []),
    ...defaultRoots(),
    ...extraAllowedRoots(),
    OUTPUT_DIR,
    path.join(ROOT, 'fixtures'),
  ].map((p) => path.resolve(p));

  const ok = allowedRoots.some(
    (root) => absolute === root || absolute.startsWith(root + path.sep),
  );
  if (!ok) {
    return null;
  }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    return null;
  }
  return absolute;
}

module.exports = {
  INDEX_FILE,
  defaultRoots,
  classify,
  parseBpmKey,
  loadIndex,
  scanMediaLibrary,
  getLibrary,
  resolveMediaById,
  resolveSafePath,
};
