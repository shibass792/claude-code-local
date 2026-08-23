const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const videoEngine = require('../modules/video-engine');
const reelhook = require('../modules/reelhook');
const musicLibrary = require('../modules/music-library');
const instagramEngine = require('../modules/instagram-engine');
const approval = require('../modules/approval-publisher');
const { route } = require('../modules/api-router');
const { startServer } = require('../api-server');
const { PENDING_DB } = require('../modules/store');

function makeTone(dir, name = 'tone.wav') {
  const filePath = path.join(dir, name);
  execFileSync(
    'ffmpeg',
    ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'pcm_s16le', filePath],
    { stdio: 'ignore' },
  );
  return filePath;
}

test('extractBpm reads tempo from a filename', () => {
  assert.equal(reelhook.extractBpm('Forest Psy 143BPM G.wav'), 143);
});

test('local hooks are generated from track metadata', () => {
  const hooks = reelhook.localHooks({ trackName: 'Dextamine', bpm: 143 });
  assert.equal(hooks.length, 3);
  assert.match(hooks[0], /Dextamine/);
  assert.match(hooks[0], /143/);
});

test('Instagram probe does not fake a 200 without a token', async () => {
  delete process.env.META_ACCESS_TOKEN;
  const health = await instagramEngine.probeGraphApi();
  assert.equal(health.mock, false);
  assert.equal(health.live, false);
  assert.equal(health.status, null);
  assert.match(health.error, /META_ACCESS_TOKEN/);
});

test('FFmpeg renders a real 9:16 mp4 from audio', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shibass-render-'));
  const audio = makeTone(tmp);
  const result = await videoEngine.renderVerticalReel({
    audioPath: audio,
    outputDir: tmp,
    filePrefix: 'test_reel',
    fps: 24,
  });
  assert.equal(result.mock, false);
  assert.equal(result.success, true);
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1920);
  assert.ok(fs.existsSync(result.outputPath));
  assert.ok(result.sizeBytes > 1000);

  const probe = execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', result.outputPath],
    { encoding: 'utf8' },
  );
  const video = JSON.parse(probe).streams[0];
  assert.equal(video.width, 1080);
  assert.equal(video.height, 1920);
});

test('music library indexes audio files from a real folder', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shibass-lib-'));
  makeTone(tmp, 'kick.wav');
  fs.writeFileSync(path.join(tmp, 'pack.mid'), 'MThd');
  const index = await musicLibrary.scanLibrary({ roots: [tmp], probe: true });
  assert.equal(index.mock, false);
  assert.equal(index.count, 2);
  const wav = index.tracks.find((track) => track.ext === '.wav');
  const midi = index.tracks.find((track) => track.ext === '.mid');
  assert.equal(wav.playable, true);
  assert.ok(wav.durationSec > 0.5);
  assert.equal(midi.playable, false);
  assert.equal(musicLibrary.getTrackById(wav.id).name, 'kick.wav');
});

test('publishCampaign fails honestly when the video is missing', async () => {
  const result = await approval.publishCampaign({
    id: 'missing_video',
    title: 'None',
    watched: true,
    videoPath: 'output/does-not-exist.mp4',
    platforms: ['instagram'],
  });
  assert.equal(result.success, false);
  assert.equal(result.mock, false);
  assert.match(result.error, /חסר/);
});

test('enqueueRenderedCampaign writes a real queue item', () => {
  fs.rmSync(PENDING_DB, { force: true });
  const campaign = approval.enqueueRenderedCampaign({
    title: 'Live Cut',
    videoPath: 'output/renders/demo.mp4',
    durationSec: 15,
    hooks: ['hook a', 'hook b'],
  });
  const queue = approval.getPendingQueue();
  assert.equal(queue[0].id, campaign.id);
  assert.equal(queue[0].duration, '00:15');
});

test('API router health and hook endpoints are live, not templates', async () => {
  const health = await route({ method: 'GET', url: '/api/health' });
  assert.equal(health.status, 200);
  const payload = JSON.parse(health.body);
  assert.equal(payload.mock, false);
  assert.equal(payload.ffmpeg.live, true);
  assert.equal(payload.instagram.live, false);

  const hooks = await route({
    method: 'POST',
    url: '/api/hooks',
    body: { trackName: 'Vandeta 143BPM' },
  });
  const hookPayload = JSON.parse(hooks.body);
  assert.equal(hookPayload.mock, false);
  assert.equal(hookPayload.hooks.length, 3);
  assert.ok(hookPayload.source === 'ollama' || hookPayload.source === 'local-fallback');
});

test('HTTP API serves health and streams a scanned audio file', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shibass-http-'));
  makeTone(tmp, 'play.wav');
  const { server, url } = await startServer(0);
  try {
    const healthRes = await fetch(`${url}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.ffmpeg.live, true);

    const scanRes = await fetch(`${url}/api/player/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roots: [tmp] }),
    });
    const index = await scanRes.json();
    const wav = index.tracks.find((track) => track.playable);
    assert.ok(wav);

    const fileRes = await fetch(`${url}/api/player/file?id=${wav.id}`);
    assert.equal(fileRes.status, 200);
    const bytes = Buffer.from(await fileRes.arrayBuffer());
    assert.ok(bytes.length > 100);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
