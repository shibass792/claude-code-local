'use strict';

// Redirect all generated files to a scratch dir BEFORE the modules are loaded,
// so running the suite never touches a real approval queue, radar feed or index.
process.env.SHIBASS_OUTPUT_DIR = require('fs').mkdtempSync(
  require('path').join(require('os').tmpdir(), 'shibass-out-'),
);

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const library = require('../modules/library');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shibass-lib-'));

function ffmpegAvailable() {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAS_FFPROBE = ffmpegAvailable();

test('categoryFor classifies studio file types', () => {
  assert.equal(library.categoryFor('.wav'), 'audio');
  assert.equal(library.categoryFor('.mid'), 'midi');
  assert.equal(library.categoryFor('.cpr'), 'project');
  assert.equal(library.categoryFor('.txt'), null);
});

test('guessBpm reads BPM out of studio filenames', () => {
  assert.equal(library.guessBpm({ fileName: 'Forest Psy 143BPM G.wav' }), 143);
  assert.equal(library.guessBpm({ fileName: 'Pack_142bpm.mid' }), 142);
  assert.equal(library.guessBpm({ fileName: 'no numbers.wav' }), null);
  assert.equal(library.guessBpm({ fileName: '9999bpm.wav' }), null, 'out-of-range is rejected');
});

test('walkDir finds media and skips noise directories', () => {
  const root = path.join(TMP, 'walk');
  fs.mkdirSync(path.join(root, 'Psy'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(root, '.hidden'), { recursive: true });

  fs.writeFileSync(path.join(root, 'Psy', 'a 128BPM.wav'), 'x');
  fs.writeFileSync(path.join(root, 'Psy', 'pack.mid'), 'x');
  fs.writeFileSync(path.join(root, 'Psy', 'notes.txt'), 'x');
  fs.writeFileSync(path.join(root, 'node_modules', 'ignored.wav'), 'x');
  fs.writeFileSync(path.join(root, '.hidden', 'ignored.wav'), 'x');

  const found = library.walkDir(root);
  const names = found.map((f) => f.fileName).sort();

  assert.deepEqual(names, ['a 128BPM.wav', 'pack.mid']);
  assert.ok(found.every((f) => f.sizeBytes >= 0 && f.mtimeMs > 0));
});

test('walkDir honours the depth limit', () => {
  const root = path.join(TMP, 'deep');
  const deep = path.join(root, 'a', 'b', 'c');
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(deep, 'deep.wav'), 'x');

  assert.equal(library.walkDir(root, { maxDepth: 1 }).length, 0);
  assert.equal(library.walkDir(root, { maxDepth: 5 }).length, 1);
});

test('mapWithConcurrency preserves order', async () => {
  const input = [5, 1, 4, 2, 3];
  const output = await library.mapWithConcurrency(input, 2, async (value) => {
    await new Promise((resolve) => setTimeout(resolve, value));
    return value * 2;
  });
  assert.deepEqual(output, [10, 2, 8, 4, 6]);
});

test('getScanRoots drops paths that do not exist', () => {
  const previous = process.env.MUSIC_ROOTS;
  process.env.MUSIC_ROOTS = `${TMP},/definitely/not/here`;
  try {
    assert.deepEqual(library.getScanRoots(), [TMP]);
  } finally {
    if (previous === undefined) delete process.env.MUSIC_ROOTS;
    else process.env.MUSIC_ROOTS = previous;
  }
});

test('scanLibrary indexes real files and reads tags, then reuses the cache', async (t) => {
  if (!HAS_FFPROBE) return t.skip('ffprobe not installed');

  const root = path.join(TMP, 'scan');
  fs.mkdirSync(root, { recursive: true });

  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=200:duration=2',
    '-metadata', 'title=Shiva Mangala',
    '-metadata', 'artist=ShiBass',
    path.join(root, 'track.mp3'),
  ]);
  fs.writeFileSync(path.join(root, 'Pack 142BPM.mid'), 'x');

  const first = await library.scanLibrary({ roots: [root] });

  assert.equal(first.totals.all, 2);
  assert.equal(first.totals.audio, 1);
  assert.equal(first.totals.midi, 1);
  assert.equal(first.probed, 1);

  const audio = first.tracks.find((entry) => entry.category === 'audio');
  assert.equal(audio.displayName, 'Shiva Mangala', 'title comes from the real tag');
  assert.equal(audio.artist, 'ShiBass');
  assert.ok(audio.durationSec > 1.5);

  const midi = first.tracks.find((entry) => entry.category === 'midi');
  assert.equal(midi.bpm, 142, 'BPM parsed from the filename');

  const second = await library.scanLibrary({ roots: [root] });
  assert.equal(second.probed, 0, 'unchanged files are not re-probed');
  assert.equal(second.totals.all, 2);

  const status = library.getIndexStatus();
  assert.equal(status.indexed, true);
  assert.match(status.message, /2/);

  assert.equal(library.searchTracks('142').length, 1);
  assert.equal(library.searchTracks('shiva').length, 1);
  assert.equal(library.searchTracks('nothing-here').length, 0);
  assert.equal(library.searchTracks('', { category: 'midi' }).length, 1);
});

test('scanLibrary reports honestly when no roots are configured', async () => {
  const previous = process.env.MUSIC_ROOTS;
  process.env.MUSIC_ROOTS = '/definitely/not/here';
  try {
    const result = await library.scanLibrary();
    assert.equal(result.totals.all, 0);
    assert.match(result.warning, /MUSIC_ROOTS/);

    const status = library.getIndexStatus();
    assert.equal(status.indexed, false);
  } finally {
    if (previous === undefined) delete process.env.MUSIC_ROOTS;
    else process.env.MUSIC_ROOTS = previous;
  }
});

test('findTrack looks up an indexed file by name or index', () => {
  const track = {
    path: path.join(TMP, 'drop.wav'),
    name: 'drop',
    fileName: 'drop.wav',
    displayName: 'Drop',
    category: 'audio',
  };
  fs.writeFileSync(library.MUSIC_INDEX, JSON.stringify({
    totals: { all: 1, audio: 1, midi: 0, project: 0 },
    tracks: [track],
  }));
  assert.equal(library.findTrack('drop.wav').path, track.path);
  assert.equal(library.findTrack('0').fileName, 'drop.wav');
  assert.equal(library.findTrack('missing'), null);
});

test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});
