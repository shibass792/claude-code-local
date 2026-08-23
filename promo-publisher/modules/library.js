'use strict';

/**
 * Real music library scanner for the ShiBass player/picker.
 *
 * Walks the configured roots on disk and reads tags with ffprobe, so the index
 * reflects actual files instead of the old "no music index" placeholder.
 * Probe results are cached by path+size+mtime, making re-scans cheap.
 */

const fs = require('fs');
const path = require('path');
const { OUTPUT_DIR, ROOT, readJson, writeJson } = require('./store');
const { probeAudio, AUDIO_EXTENSIONS } = require('./renderer');

const MUSIC_INDEX = path.join(OUTPUT_DIR, 'music_index.json');
const MIDI_EXTENSIONS = new Set(['.mid', '.midi']);
const PROJECT_EXTENSIONS = new Set(['.cpr', '.als', '.flp', '.rpp', '.ptx']);

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '$recycle.bin', 'system volume information',
  'windows', 'appdata', '.electron-user-data', 'dist', 'build', '__pycache__',
]);

const DEFAULT_MAX_DEPTH = Number(process.env.MUSIC_SCAN_DEPTH ?? 6);
const DEFAULT_MAX_FILES = Number(process.env.MUSIC_SCAN_MAX_FILES ?? 20000);
const PROBE_CONCURRENCY = Number(process.env.MUSIC_PROBE_CONCURRENCY ?? 4);

function categoryFor(ext) {
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (MIDI_EXTENSIONS.has(ext)) return 'midi';
  if (PROJECT_EXTENSIONS.has(ext)) return 'project';
  return null;
}

/**
 * Roots come from MUSIC_ROOTS (path-separator or comma delimited). Only paths
 * that actually exist are returned, so a Windows-oriented config is harmless
 * on other machines.
 */
function getScanRoots() {
  const raw = process.env.MUSIC_ROOTS ?? '';
  const candidates = raw
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!candidates.length) {
    candidates.push(path.join(ROOT, 'media'));
  }

  return candidates.filter((dir) => {
    try {
      return fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
}

function walkDir(rootDir, { maxDepth = DEFAULT_MAX_DEPTH, maxFiles = DEFAULT_MAX_FILES } = {}) {
  const found = [];
  const stack = [{ dir: rootDir, depth: 0 }];

  while (stack.length && found.length < maxFiles) {
    const { dir, depth } = stack.pop();

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (found.length >= maxFiles) break;

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (depth >= maxDepth) continue;
        if (entry.name.startsWith('.')) continue;
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
        stack.push({ dir: full, depth: depth + 1 });
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      const category = categoryFor(ext);
      if (!category) continue;

      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }

      found.push({
        path: full,
        name: path.basename(entry.name, ext),
        fileName: entry.name,
        ext,
        category,
        dir,
        root: rootDir,
        sizeBytes: stat.size,
        mtimeMs: Math.round(stat.mtimeMs),
      });
    }
  }

  return found;
}

function cacheKey(entry) {
  return `${entry.path}::${entry.sizeBytes}::${entry.mtimeMs}`;
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

function guessBpm(entry) {
  const match = entry.fileName.match(/(\d{2,3})\s*bpm/i);
  if (!match) return null;
  const bpm = Number(match[1]);
  return bpm >= 60 && bpm <= 220 ? bpm : null;
}

/**
 * Scan every configured root and write a real index to disk.
 */
async function scanLibrary({ roots, probe = true, onProgress } = {}) {
  const scanRoots = roots?.length ? roots : getScanRoots();
  const startedAt = Date.now();

  if (!scanRoots.length) {
    const payload = {
      scannedAt: new Date().toISOString(),
      roots: [],
      totals: { all: 0, audio: 0, midi: 0, project: 0 },
      probed: 0,
      scanMs: Date.now() - startedAt,
      tracks: [],
      warning:
        'No scan roots found. Set MUSIC_ROOTS in config/.env to your samples/tracks folders.',
    };
    writeJson(MUSIC_INDEX, payload);
    return payload;
  }

  const discovered = scanRoots.flatMap((root) => walkDir(root));
  onProgress?.({ phase: 'walk', found: discovered.length });

  const previous = readJson(MUSIC_INDEX, null);
  const cache = new Map(
    (previous?.tracks ?? [])
      .filter((track) => track.probe)
      .map((track) => [cacheKey(track), track.probe]),
  );

  let probedCount = 0;
  const audioEntries = discovered.filter((entry) => entry.category === 'audio');

  if (probe && audioEntries.length) {
    await mapWithConcurrency(audioEntries, PROBE_CONCURRENCY, async (entry, index) => {
      const key = cacheKey(entry);
      const cached = cache.get(key);

      if (cached) {
        entry.probe = cached;
      } else {
        try {
          const meta = await probeAudio(entry.path);
          entry.probe = {
            duration: meta.duration,
            codec: meta.codec,
            sampleRate: meta.sampleRate,
            channels: meta.channels,
            title: meta.title,
            artist: meta.artist,
            bpm: meta.bpm,
            key: meta.key,
          };
          probedCount += 1;
        } catch (error) {
          entry.probeError = error.message;
        }
      }

      if (onProgress && index % 25 === 0) {
        onProgress({ phase: 'probe', done: index + 1, total: audioEntries.length });
      }
    });
  }

  const tracks = discovered
    .map((entry) => ({
      ...entry,
      displayName: entry.probe?.title || entry.name,
      artist: entry.probe?.artist || null,
      durationSec: entry.probe?.duration ?? null,
      bpm: entry.probe?.bpm ?? guessBpm(entry),
    }))
    .sort((a, b) => a.fileName.localeCompare(b.fileName, 'he'));

  const payload = {
    scannedAt: new Date().toISOString(),
    roots: scanRoots,
    totals: {
      all: tracks.length,
      audio: tracks.filter((t) => t.category === 'audio').length,
      midi: tracks.filter((t) => t.category === 'midi').length,
      project: tracks.filter((t) => t.category === 'project').length,
    },
    probed: probedCount,
    scanMs: Date.now() - startedAt,
    truncated: tracks.length >= DEFAULT_MAX_FILES,
    tracks,
  };

  writeJson(MUSIC_INDEX, payload);
  return payload;
}

function getIndex() {
  return readJson(MUSIC_INDEX, null);
}

/**
 * The player asks for the index; tell it honestly when a scan is still needed
 * rather than pretending an empty library is indexed.
 */
function getIndexStatus() {
  const index = getIndex();
  if (!index) {
    return {
      indexed: false,
      message: 'אין אינדקס מוזיקה — הרץ סריקה',
      roots: getScanRoots(),
      totals: { all: 0, audio: 0, midi: 0, project: 0 },
    };
  }

  return {
    indexed: index.totals.all > 0,
    message:
      index.totals.all > 0
        ? `${index.totals.all} קבצים באינדקס (${index.totals.audio} אודיו)`
        : index.warning ?? 'האינדקס ריק — בדוק את MUSIC_ROOTS',
    scannedAt: index.scannedAt,
    roots: index.roots,
    totals: index.totals,
    warning: index.warning ?? null,
  };
}

function searchTracks(query, { limit = 50, category } = {}) {
  const index = getIndex();
  if (!index?.tracks?.length) {
    return [];
  }

  const needle = String(query ?? '').trim().toLowerCase();
  let results = index.tracks;

  if (category) {
    results = results.filter((track) => track.category === category);
  }

  if (needle) {
    results = results.filter((track) =>
      [track.fileName, track.displayName, track.artist, track.dir]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle)),
    );
  }

  return results.slice(0, limit);
}

module.exports = {
  MUSIC_INDEX,
  MIDI_EXTENSIONS,
  PROJECT_EXTENSIONS,
  SKIP_DIRS,
  categoryFor,
  getScanRoots,
  walkDir,
  guessBpm,
  mapWithConcurrency,
  scanLibrary,
  getIndex,
  getIndexStatus,
  searchTracks,
};
