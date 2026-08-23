const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { OUTPUT_DIR, readJson, writeJson, ensureDir } = require('./store');

const execFileAsync = promisify(execFile);

const AUDIO_EXT = new Set(['.wav', '.mp3', '.flac', '.aiff', '.aif', '.ogg', '.m4a']);
const MIDI_EXT = new Set(['.mid', '.midi']);
const INDEX_DB = path.join(OUTPUT_DIR, 'music_index.json');
const MAX_FILES = 4000;

function defaultRoots() {
  const fromEnv = (process.env.SHIBASS_MUSIC_ROOTS ?? '')
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);

  const fallbacks = [
    path.join(__dirname, '..', 'samples'),
    path.join(__dirname, '..', 'output', 'inbox'),
    path.join(process.env.HOME || '', 'Documents', 'ShiBass Synth Samples'),
    'C:\\Users\\shibass\\Documents\\ShiBass Synth Samples',
  ];

  return [...fromEnv, ...fallbacks].filter((root) => root && fs.existsSync(root));
}

function fileId(absolutePath) {
  return crypto.createHash('sha1').update(absolutePath).digest('hex').slice(0, 16);
}

function walkFiles(root, collected) {
  if (collected.length >= MAX_FILES) {
    return;
  }

  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (collected.length >= MAX_FILES) {
      return;
    }
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue;
      }
      walkFiles(full, collected);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!AUDIO_EXT.has(ext) && !MIDI_EXT.has(ext)) {
      continue;
    }
    collected.push(full);
  }
}

async function probeDuration(filePath) {
  try {
    const { stdout } = await execFileAsync(
      process.env.FFPROBE_PATH || 'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
      { timeout: 8000 },
    );
    const duration = Number(stdout.toString().trim());
    return Number.isFinite(duration) ? duration : 0;
  } catch {
    return 0;
  }
}

function toTrack(absolutePath, durationSec) {
  const ext = path.extname(absolutePath).toLowerCase();
  return {
    id: fileId(absolutePath),
    name: path.basename(absolutePath),
    path: absolutePath,
    ext,
    kind: MIDI_EXT.has(ext) ? 'midi' : 'audio',
    durationSec,
    playable: AUDIO_EXT.has(ext),
  };
}

async function scanLibrary({ roots = defaultRoots(), probe = true } = {}) {
  const uniqueRoots = [...new Set(roots.map((root) => path.resolve(root)))].filter((root) =>
    fs.existsSync(root),
  );
  const files = [];
  uniqueRoots.forEach((root) => walkFiles(root, files));

  const tracks = [];
  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    const durationSec = probe && AUDIO_EXT.has(ext) ? await probeDuration(filePath) : 0;
    tracks.push(toTrack(filePath, durationSec));
  }

  tracks.sort((a, b) => a.name.localeCompare(b.name));
  const payload = {
    scannedAt: new Date().toISOString(),
    mock: false,
    roots: uniqueRoots,
    count: tracks.length,
    tracks,
  };

  writeJson(INDEX_DB, payload);
  return payload;
}

function getIndex() {
  return readJson(INDEX_DB, {
    scannedAt: null,
    mock: false,
    roots: [],
    count: 0,
    tracks: [],
  });
}

function getTrackById(id) {
  if (!id) {
    return null;
  }
  return getIndex().tracks.find((track) => track.id === id) ?? null;
}

function resolvePlayablePath(track) {
  if (!track) {
    return null;
  }
  if (track.playable && fs.existsSync(track.path)) {
    return track.path;
  }

  const siblingAudio = AUDIO_EXT.values();
  const base = track.path.replace(/\.[^.]+$/, '');
  for (const ext of siblingAudio) {
    const candidate = `${base}${ext}`;
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function getEngineHealth() {
  const index = getIndex();
  return {
    configured: true,
    live: index.count > 0,
    mock: false,
    label: 'ShiBass Universal Player / music index',
    count: index.count,
    scannedAt: index.scannedAt,
  };
}

function ensureInbox() {
  const inbox = path.join(OUTPUT_DIR, 'inbox');
  ensureDir(inbox);
  return inbox;
}

module.exports = {
  INDEX_DB,
  AUDIO_EXT,
  MIDI_EXT,
  defaultRoots,
  fileId,
  scanLibrary,
  getIndex,
  getTrackById,
  resolvePlayablePath,
  getEngineHealth,
  ensureInbox,
};
