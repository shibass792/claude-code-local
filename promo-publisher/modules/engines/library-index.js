const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { LIBRARY_DB, ROOT, readJson, writeJson } = require('../store');
const { appendLog } = require('../creation-log');

const AUDIO_EXT = new Set(['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aiff', '.aif']);
const MIDI_EXT = new Set(['.mid', '.midi']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm']);

function defaultRoots() {
  const fromEnv = (process.env.SHIBASS_LIBRARY_ROOTS ?? '')
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);

  const extras = [
    path.join(ROOT, 'library'),
    path.join(ROOT, 'output', 'renders'),
    'C:\\Users\\shibass\\Documents\\ShiBass Synth Samples',
    'H:\\shibass-ai\\10_OUTPUTS',
    'H:\\shibass-ai\\library',
  ];

  return [...new Set([...fromEnv, ...extras])];
}

function fileId(filePath) {
  return crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 16);
}

function classify(ext) {
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (MIDI_EXT.has(ext)) return 'midi';
  if (VIDEO_EXT.has(ext)) return 'video';
  return null;
}

function walkDir(dirPath, acc, depth = 0) {
  if (depth > 8 || acc.length >= 4000) {
    return;
  }

  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, acc, depth + 1);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    const kind = classify(ext);
    if (!kind) {
      continue;
    }
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    acc.push({
      id: fileId(full),
      name: entry.name,
      path: full,
      ext,
      kind,
      bytes: stat.size,
      mtime: stat.mtime.toISOString(),
    });
  }
}

function scanLibrary(roots = defaultRoots()) {
  const existingRoots = roots.filter((root) => fs.existsSync(root));
  const items = [];

  for (const root of existingRoots) {
    walkDir(root, items);
  }

  items.sort((a, b) => a.name.localeCompare(b.name));

  const payload = {
    scannedAt: new Date().toISOString(),
    live: true,
    roots: existingRoots,
    missingRoots: roots.filter((root) => !existingRoots.includes(root)),
    count: items.length,
    items,
  };

  writeJson(LIBRARY_DB, payload);
  appendLog(
    items.length ? 'success' : 'warn',
    'player',
    items.length
      ? `Indexed ${items.length} files from ${existingRoots.length} roots`
      : 'No music index — add files under library/ or set SHIBASS_LIBRARY_ROOTS',
  );
  return payload;
}

function getLibrary() {
  const cached = readJson(LIBRARY_DB, null);
  if (cached?.items) {
    return cached;
  }
  return scanLibrary();
}

function getLibraryItem(id) {
  if (!id) {
    return null;
  }
  const lib = getLibrary();
  return (lib.items ?? []).find((item) => item.id === id) ?? null;
}

module.exports = {
  AUDIO_EXT,
  MIDI_EXT,
  defaultRoots,
  fileId,
  classify,
  scanLibrary,
  getLibrary,
  getLibraryItem,
};
