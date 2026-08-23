const fs = require('fs');
const path = require('path');
const { OUTPUT_DIR, ROOT, ensureDir, readJson, writeJson } = require('../store');
const { appendLog } = require('./creation-log');

const INDEX_PATH = path.join(OUTPUT_DIR, 'music_index.json');
const AUDIO_EXTS = new Set(['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aiff', '.aif']);
const MIDI_EXTS = new Set(['.mid', '.midi']);
const MAX_FILES = 4000;

function defaultRoots() {
  const fromEnv = (process.env.MUSIC_ROOTS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return [
    ...fromEnv,
    path.join(ROOT, 'media'),
    path.join(OUTPUT_DIR, 'renders'),
    path.join(ROOT, 'output'),
    path.join(process.env.HOME ?? '', 'Documents', 'ShiBass Synth Samples'),
    'C:\\Users\\shibass\\Documents\\ShiBass Synth Samples',
    'H:\\shibass-ai',
  ].filter((dir, index, all) => dir && all.indexOf(dir) === index);
}

function existingRoots(roots = defaultRoots()) {
  return roots.filter((dir) => {
    try {
      return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
}

function makeId(filePath) {
  return Buffer.from(filePath).toString('base64url');
}

function decodeId(id) {
  try {
    return Buffer.from(id, 'base64url').toString('utf-8');
  } catch {
    return null;
  }
}

function walkFiles(rootDir, collected) {
  const stack = [rootDir];
  while (stack.length > 0 && collected.length < MAX_FILES) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (collected.length >= MAX_FILES) {
        break;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          stack.push(full);
        }
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!AUDIO_EXTS.has(ext) && !MIDI_EXTS.has(ext)) {
        continue;
      }
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      collected.push({
        id: makeId(full),
        name: entry.name,
        path: full,
        ext,
        type: AUDIO_EXTS.has(ext) ? 'audio' : 'midi',
        bytes: stat.size,
        mtime: stat.mtimeMs,
        playable: AUDIO_EXTS.has(ext),
      });
    }
  }
  return collected;
}

function scanLibrary(roots) {
  const scanRoots = existingRoots(roots);
  const tracks = [];
  for (const rootDir of scanRoots) {
    walkFiles(rootDir, tracks);
  }

  tracks.sort((a, b) => a.name.localeCompare(b.name));
  const index = {
    scannedAt: new Date().toISOString(),
    roots: scanRoots,
    missingRoots: defaultRoots().filter((dir) => !scanRoots.includes(dir)),
    count: tracks.length,
    audioCount: tracks.filter((track) => track.type === 'audio').length,
    midiCount: tracks.filter((track) => track.type === 'midi').length,
    tracks,
  };

  ensureDir(OUTPUT_DIR);
  writeJson(INDEX_PATH, index);
  appendLog({
    engine: 'player',
    event: 'scan',
    message: `Indexed ${index.count} files (${index.audioCount} audio, ${index.midiCount} MIDI)`,
    data: { roots: scanRoots, count: index.count },
  });
  return index;
}

function readIndex() {
  return readJson(INDEX_PATH, null);
}

function getIndexOrEmpty() {
  return (
    readIndex() ?? {
      scannedAt: null,
      roots: [],
      missingRoots: defaultRoots(),
      count: 0,
      audioCount: 0,
      midiCount: 0,
      tracks: [],
    }
  );
}

function getTrackById(id) {
  const index = getIndexOrEmpty();
  const fromIndex = index.tracks.find((track) => track.id === id);
  if (fromIndex && fs.existsSync(fromIndex.path)) {
    return fromIndex;
  }

  const decoded = decodeId(id);
  if (decoded && fs.existsSync(decoded)) {
    const ext = path.extname(decoded).toLowerCase();
    return {
      id,
      name: path.basename(decoded),
      path: decoded,
      ext,
      type: AUDIO_EXTS.has(ext) ? 'audio' : 'midi',
      playable: AUDIO_EXTS.has(ext),
    };
  }
  return null;
}

function streamHeaders(filePath, rangeHeader) {
  const stat = fs.statSync(filePath);
  const size = stat.size;
  if (!rangeHeader) {
    return {
      status: 200,
      start: 0,
      end: size - 1,
      headers: {
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
      },
    };
  }

  const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
  const start = match?.[1] ? Number(match[1]) : 0;
  const end = match?.[2] ? Number(match[2]) : size - 1;
  return {
    status: 206,
    start,
    end,
    headers: {
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  };
}

module.exports = {
  INDEX_PATH,
  AUDIO_EXTS,
  MIDI_EXTS,
  defaultRoots,
  existingRoots,
  makeId,
  scanLibrary,
  readIndex,
  getIndexOrEmpty,
  getTrackById,
  streamHeaders,
};
