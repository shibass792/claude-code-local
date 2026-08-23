const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const engines = require('../modules/engines');
const approval = require('../modules/approval-publisher');
const { startApiServer } = require('../api-server');
const { OUTPUT_DIR, ROOT } = require('../modules/store');

const MEDIA_DIR = path.join(ROOT, 'media');

function makeTestWav(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const result = spawnSync(
    'ffmpeg',
    ['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=1', '-c:a', 'pcm_s16le', filePath],
    { encoding: 'utf-8' },
  );
  assert.equal(result.status, 0, result.stderr);
}

test('creation log records real JSON lines, not a template', () => {
  const record = engines.creationLog.appendLog({
    engine: 'test',
    event: 'unit',
    message: 'hello-log',
  });
  assert.equal(record.message, 'hello-log');
  const entries = engines.creationLog.readLog(20);
  assert.ok(entries.some((entry) => entry.message === 'hello-log'));
  assert.ok(!entries.some((entry) => String(entry.message).includes('InstaPy v0.6.16')));
});

test('instagram status without tokens is a real failure, not 200 OK template', async () => {
  delete process.env.META_ACCESS_TOKEN;
  delete process.env.META_IG_USER_ID;
  const status = await engines.instagram.getStatus();
  assert.equal(status.ok, false);
  assert.equal(status.configured, false);
  assert.equal(status.engine, 'instagram-graph');
  assert.equal(status.instapy.supported, false);
  assert.match(status.error, /META_ACCESS_TOKEN/);
});

test('reelhook local generator uses the supplied title and BPM', () => {
  const hooks = engines.reelhook.localHooks({
    title: 'Dextamine',
    bpm: 143,
    style: 'Forest Psy',
    key: 'G',
  });
  assert.equal(hooks.length, 3);
  assert.ok(hooks.some((hook) => hook.text.includes('143')));
  assert.ok(hooks.some((hook) => hook.text.includes('Dextamine')));
});

test('ffmpeg renders a real 9:16 mp4 and logs success', async () => {
  const render = await engines.renderer.renderVerticalReel({
    hook: 'ShiBass Test Hook',
    durationSeconds: 3,
  });
  assert.equal(render.ok, true, render.error);
  assert.ok(fs.existsSync(render.outputPath));
  assert.ok(render.bytes > 1000);
  assert.equal(render.width, 1080);
  assert.equal(render.height, 1920);
  const probe = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', render.outputPath],
    { encoding: 'utf-8' },
  );
  assert.match(probe.stdout, /1080,1920/);
  const log = engines.creationLog.readLog(40);
  assert.ok(log.some((entry) => entry.engine === 'render' && entry.event === 'success'));
});

test('player scan indexes a real wav and returns a streamable id', () => {
  const wavPath = path.join(MEDIA_DIR, 'test_tone.wav');
  makeTestWav(wavPath);
  const index = engines.player.scanLibrary([MEDIA_DIR]);
  assert.ok(index.count >= 1);
  const wav = index.tracks.find((track) => track.name === 'test_tone.wav');
  assert.ok(wav);
  assert.equal(wav.playable, true);
  assert.equal(engines.player.getTrackById(wav.id).path, wavPath);
});

test('publish without a video file fails instead of mock success', async () => {
  const result = await approval.publishCampaign({
    id: 'missing_video',
    watched: true,
    videoPath: 'output/does-not-exist.mp4',
    platforms: ['instagram'],
  });
  assert.equal(result.success, false);
  assert.equal(result.mock, false);
  assert.match(result.error, /Video file missing/);
});

test('HTTP engines API health, render, log, scan, and stream', async () => {
  const wavPath = path.join(MEDIA_DIR, 'api_tone.wav');
  makeTestWav(wavPath);
  const { server, address } = await startApiServer({ port: 0, host: '127.0.0.1' });

  try {
    const healthRes = await fetch(`${address}/api/health`);
    const health = await healthRes.json();
    assert.equal(healthRes.status, 200);
    assert.equal(health.ffmpeg.ok, true);
    assert.equal(health.instagram.ok, false);

    const renderRes = await fetch(`${address}/api/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hook: 'API Render', durationSeconds: 3, audioPath: wavPath }),
    });
    const render = await renderRes.json();
    assert.equal(render.ok, true, render.error);
    assert.ok(render.relativePath.endsWith('.mp4'));

    const logRes = await fetch(`${address}/api/log?limit=50`);
    const log = await logRes.json();
    assert.ok(log.entries.some((entry) => entry.engine === 'render' && entry.event === 'success'));
    assert.ok(!log.entries.some((entry) => String(entry.message).includes('InstaPy Python Engine & Short Video MCP Server Active')));

    const scanRes = await fetch(`${address}/api/player/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roots: [MEDIA_DIR] }),
    });
    const index = await scanRes.json();
    const wav = index.tracks.find((track) => track.name === 'api_tone.wav');
    assert.ok(wav);

    const streamRes = await fetch(`${address}/api/player/stream/${encodeURIComponent(wav.id)}`);
    assert.equal(streamRes.status, 200);
    const bytes = Buffer.from(await streamRes.arrayBuffer());
    assert.ok(bytes.length > 100);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
