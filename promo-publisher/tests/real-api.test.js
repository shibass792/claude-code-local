const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { probeFfmpeg, getEngineStatus } = require('../modules/engines');
const { generateViralHooks, parseHookList, buildMetadataHooks } = require('../modules/hooks');
const { scanLibrary, getIndex, getTrack } = require('../modules/music-library');
const { renderVerticalReel } = require('../modules/render');
const { buildPermalink } = require('../modules/instagram-engine');
const { appendLog, readLog, clearLog } = require('../modules/creation-log');
const approval = require('../modules/approval-publisher');
const { MEDIA_DIR, ensureDir } = require('../modules/store');

function makeFixtureWav() {
  ensureDir(MEDIA_DIR);
  const dest = path.join(MEDIA_DIR, 'test_kick_142bpm.wav');
  if (!fs.existsSync(dest)) {
    execFileSync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=140:sample_rate=44100:duration=4',
      dest,
    ], { stdio: 'ignore' });
  }
  return dest;
}

test('ffmpeg engine is a real local binary', async () => {
  const ffmpeg = await probeFfmpeg();
  assert.equal(ffmpeg.available, true);
  assert.match(ffmpeg.version ?? '', /ffmpeg/i);
});

test('engine status never claims mock success', async () => {
  const status = await getEngineStatus();
  assert.equal(status.mock, false);
  assert.ok(status.engines.ffmpeg.available);
});

test('metadata hooks use the real track title', () => {
  const hooks = buildMetadataHooks({ title: 'Dextamine', bpm: 143, key: 'G' });
  assert.equal(hooks.length, 3);
  assert.ok(hooks.some((line) => line.includes('Dextamine')));
  assert.ok(hooks.some((line) => line.includes('143')));
});

test('parseHookList strips numbering', () => {
  const hooks = parseHookList('1. first hook here now\n2) second hook here now\n');
  assert.deepEqual(hooks, ['first hook here now', 'second hook here now']);
});

test('generateViralHooks returns real engine payload', async () => {
  const result = await generateViralHooks({ title: 'Vandeta Forest', bpm: 143 });
  assert.equal(result.success, true);
  assert.equal(result.mock, false);
  assert.ok(['ollama', 'openai_compat', 'metadata'].includes(result.engine));
  assert.ok(result.hooks.length >= 2);
});

test('music scan indexes fixture audio', async () => {
  const wav = makeFixtureWav();
  const index = await scanLibrary({ roots: [MEDIA_DIR] });
  assert.equal(index.mock, false);
  assert.ok(index.tracks.some((track) => track.path === wav));
  const found = getTrack(index.tracks[0].id);
  assert.ok(found);
  assert.equal(getIndex().tracks.length, index.tracks.length);
});

test('ffmpeg renders a real 9:16 mp4', async () => {
  const wav = makeFixtureWav();
  const result = await renderVerticalReel({
    audioPath: wav,
    title: 'ShiBass Test Reel',
    durationSec: 3,
    enqueue: true,
  });
  assert.equal(result.success, true);
  assert.equal(result.mock, false);
  assert.ok(fs.existsSync(result.outputPath));
  assert.ok(result.bytes > 1000);
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1920);
  const queue = approval.getPendingQueue();
  assert.ok(queue.some((item) => item.id === result.campaignId));
});

test('publish without video is a real failure, not a mock success', async () => {
  const result = await approval.publishCampaign({
    id: 'missing_video',
    watched: true,
    videoPath: 'output/does-not-exist.mp4',
    platforms: ['instagram'],
  });
  assert.equal(result.success, false);
  assert.equal(result.mock, false);
  assert.match(result.error, /missing/i);
});

test('instagram permalinks use real ids', () => {
  assert.equal(
    buildPermalink('instagram', 'abc123'),
    'https://www.instagram.com/reel/abc123/',
  );
});

test('creation log stores real entries', () => {
  clearLog();
  appendLog({ source: 'test', message: 'hello-real-api' });
  const entries = readLog(10);
  assert.ok(entries.some((entry) => entry.message === 'hello-real-api'));
  assert.ok(entries.every((entry) => entry.mock === false));
});

test('HTTP studio API serves engines and music index', async () => {
  const { start } = require('../studio-api');
  const server = await start(0);
  const port = server.address().port;
  const engines = await fetch(`http://127.0.0.1:${port}/api/engines`).then((res) => res.json());
  assert.equal(engines.mock, false);
  assert.equal(engines.engines.ffmpeg.available, true);
  const index = await fetch(`http://127.0.0.1:${port}/api/music/index`).then((res) => res.json());
  assert.ok(Array.isArray(index.tracks));
  const escapeAttempt = await fetch(`http://127.0.0.1:${port}/api/file?path=${encodeURIComponent('../../../../etc/passwd')}`);
  assert.equal(escapeAttempt.status, 404);
  await new Promise((resolve) => server.close(resolve));
});
