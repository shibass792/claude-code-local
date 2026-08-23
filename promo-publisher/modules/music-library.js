const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MUSIC_INDEX, MEDIA_DIR, ensureDir, readJson, writeJson } = require('./store');
const { appendLog, snapshotState } = require('./creation-log');
const { resolveMediaRoots, runCommand } = require('./engines');

const AUDIO_EXT = new Set(['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aiff', '.aif', '.aac']);
const MIDI_EXT = new Set(['.mid', '.midi']);
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.cache',
  '__pycache__',
  'dist',
  'build',
  '.electron-user-data',
]);
const MAX_FILES = 12000;

function fileId(filePath) {
  return crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 16);
}

function walkDir(root, acc, scanRoot = root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return acc;
  }

  for (const entry of entries) {
    if (acc.length >= MAX_FILES) {
      break;
    }
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name.toLowerCase())) {
        continue;
      }
      walkDir(full, acc, scanRoot);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!AUDIO_EXT.has(ext) && !MIDI_EXT.has(ext)) {
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
      kind: MIDI_EXT.has(ext) ? 'midi' : 'audio',
      folder: path.basename(path.dirname(full)),
      parent: path.dirname(full),
      root: scanRoot,
      bytes: stat.size,
      mtime: stat.mtime.toISOString(),
    });
  }
  return acc;
}

async function enrichDuration(track) {
  if (track.kind !== 'audio') {
    return track;
  }
  const result = await runCommand('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    track.path,
  ]);
  if (!result.ok) {
    return track;
  }
  const duration = Number(result.stdout);
  if (Number.isFinite(duration)) {
    return { ...track, duration };
  }
  return track;
}

async function scanLibrary({ roots, enrich = false } = {}) {
  const scanRoots = (roots?.length ? roots : resolveMediaRoots()).filter((dir) =>
    fs.existsSync(dir),
  );

  if (!scanRoots.length) {
    ensureDir(MEDIA_DIR);
    scanRoots.push(MEDIA_DIR);
  }

  const tracks = [];
  for (const root of scanRoots) {
    walkDir(root, tracks);
  }

  let enriched = tracks;
  if (enrich) {
    enriched = [];
    for (const track of tracks) {
      enriched.push(await enrichDuration(track));
    }
  }

  const index = {
    scannedAt: new Date().toISOString(),
    mock: false,
    roots: scanRoots,
    tracks: enriched.sort((a, b) => a.name.localeCompare(b.name)),
  };
  writeJson(MUSIC_INDEX, index);
  appendLog({
    source: 'player',
    message: `Music scan complete — ${index.tracks.length} files from ${scanRoots.length} roots`,
    roots: scanRoots,
    tracks: index.tracks.length,
  });
  snapshotState({ musicIndex: { tracks: index.tracks.length, scannedAt: index.scannedAt } });
  return index;
}

function getIndex() {
  return readJson(MUSIC_INDEX, {
    scannedAt: null,
    mock: false,
    roots: [],
    tracks: [],
  });
}

function getTrack(id) {
  if (!id) {
    return null;
  }
  return getIndex().tracks.find((track) => track.id === id) ?? null;
}

function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = String(Math.floor(total / 60)).padStart(2, '0');
  const secs = String(total % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

module.exports = {
  AUDIO_EXT,
  MIDI_EXT,
  scanLibrary,
  getIndex,
  getTrack,
  formatClock,
  fileId,
};
