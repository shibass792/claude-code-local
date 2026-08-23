const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { scanBackgrounds, getBackground, getIndex } = require('../modules/backgrounds');
const { renderVerticalReel } = require('../modules/render');
const approval = require('../modules/approval-publisher');
const { MEDIA_DIR, BACKGROUNDS_DIR, ensureDir } = require('../modules/store');

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

function makeFixtureArtwork() {
  const dir = path.join(BACKGROUNDS_DIR, 'artwork');
  ensureDir(dir);
  const dest = path.join(dir, 'track-cover.png');
  execFileSync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x4c1d95:s=800x1200:d=1',
    '-frames:v',
    '1',
    dest,
  ], { stdio: 'ignore' });
  return dest;
}

test('background scan indexes fixture artwork', async () => {
  const png = makeFixtureArtwork();
  const index = await scanBackgrounds({ roots: [path.dirname(png)] });
  assert.equal(index.mock, false);
  assert.ok(index.images.some((image) => image.path === png));
  const found = getBackground(index.images[0].id);
  assert.ok(found);
  assert.equal(getIndex().images.length, index.images.length);
});

test('ffmpeg renders a 9:16 reel from artwork + track into approval', async () => {
  const wav = makeFixtureWav();
  const png = makeFixtureArtwork();
  const scanned = await scanBackgrounds({ roots: [path.dirname(png)] });
  const background = scanned.images.find((image) => image.path === png);
  assert.ok(background);

  const result = await renderVerticalReel({
    audioPath: wav,
    backgroundId: background.id,
    title: 'ShiBass Artwork Reel',
    durationSec: 3,
    enqueue: true,
  });

  assert.equal(result.success, true);
  assert.equal(result.mock, false);
  assert.equal(result.needsApproval, true);
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1920);
  assert.ok(fs.existsSync(result.outputPath));
  assert.ok(result.bytes > 1000);
  assert.equal(result.background, png);

  const queue = approval.getPendingQueue();
  const campaign = queue.find((item) => item.id === result.campaignId);
  assert.ok(campaign);
  assert.equal(campaign.watched, false);
  assert.equal(campaign.needsApproval, true);
  assert.equal(campaign.source, 'background-reel');

  const blocked = await approval.publishCampaign({
    id: campaign.id,
    watched: false,
    videoPath: campaign.videoPath,
    platforms: ['instagram'],
  });
  assert.equal(blocked.success, false);
  assert.match(blocked.error, /לצפות/);
});

test('HTTP backgrounds scan and file serve stay inside the index', async () => {
  const png = makeFixtureArtwork();
  const { start } = require('../studio-api');
  const server = await start(0);
  const port = server.address().port;
  const scanned = await fetch(`http://127.0.0.1:${port}/api/backgrounds/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roots: [path.dirname(png)] }),
  }).then((res) => res.json());
  assert.equal(scanned.mock, false);
  const image = scanned.images.find((item) => item.path === png);
  assert.ok(image);
  const fileRes = await fetch(`http://127.0.0.1:${port}/api/backgrounds/file/${image.id}`);
  assert.equal(fileRes.status, 200);
  assert.match(fileRes.headers.get('content-type') ?? '', /image\/png/);
  const missing = await fetch(`http://127.0.0.1:${port}/api/backgrounds/file/not-a-real-id`);
  assert.equal(missing.status, 404);
  await new Promise((resolve) => server.close(resolve));
});
