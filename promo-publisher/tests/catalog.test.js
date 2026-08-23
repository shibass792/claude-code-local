const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

process.env.STUDIO_SQLITE_PATH = path.join(os.tmpdir(), `catalog-sql-${process.pid}.db`);

const {
  isFmPath,
  isEffectPath,
  classifyRecord,
  scanCatalog,
  buildCatalog,
} = require('../modules/catalog');
const { MEDIA_DIR, BACKGROUNDS_DIR, ensureDir } = require('../modules/store');

test('FM paths stay excluded from the default catalog', () => {
  assert.equal(isFmPath('H:/samples/FM/patch.wav'), true);
  assert.equal(isFmPath('H:/samples/fm8/bank.wav'), true);
  assert.equal(isFmPath('H:/samples/kick/808.wav'), false);
  const classified = classifyRecord({
    name: 'dx7-bell.wav',
    path: 'C:/Users/shibass/Documents/FM/dx7-bell.wav',
    folder: 'FM',
    kind: 'audio',
    ext: '.wav',
  });
  assert.equal(classified.role, 'fm');
  assert.equal(classified.excluded, true);
});

test('covers, effects, stems and full tracks classify separately', () => {
  assert.equal(isEffectPath('H:/library/FX/riser.wav'), true);
  assert.equal(classifyRecord({
    name: 'cover.png',
    path: 'H:/artwork/cover.png',
    ext: '.png',
    kind: 'cover',
  }).role, 'covers');
  assert.equal(classifyRecord({
    name: 'riser_up.wav',
    path: 'H:/library/effects/riser_up.wav',
    folder: 'effects',
    kind: 'audio',
    ext: '.wav',
  }).role, 'effects');
  assert.equal(classifyRecord({
    name: 'kick_01.wav',
    path: 'H:/library/Kick/kick_01.wav',
    folder: 'Kick',
    kind: 'audio',
    ext: '.wav',
  }).role, 'stems');
  assert.equal(classifyRecord({
    name: 'ShiBass_Master.wav',
    path: 'H:/10_OUTPUTS/tracks/ShiBass_Master.wav',
    folder: 'tracks',
    kind: 'audio',
    ext: '.wav',
  }).role, 'tracks');
});

test('catalog scan organizes fixture audio and artwork', async () => {
  ensureDir(path.join(MEDIA_DIR, 'FX'));
  ensureDir(path.join(MEDIA_DIR, 'Kick'));
  ensureDir(path.join(MEDIA_DIR, 'FM'));
  ensureDir(path.join(BACKGROUNDS_DIR, 'artwork'));
  const wav = path.join(MEDIA_DIR, 'test_kick_142bpm.wav');
  if (!fs.existsSync(wav)) {
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=140:sample_rate=44100:duration=2', wav,
    ], { stdio: 'ignore' });
  }
  const fx = path.join(MEDIA_DIR, 'FX', 'riser.wav');
  fs.copyFileSync(wav, fx);
  const kick = path.join(MEDIA_DIR, 'Kick', 'kick_01.wav');
  fs.copyFileSync(wav, kick);
  const fm = path.join(MEDIA_DIR, 'FM', 'hidden.wav');
  fs.copyFileSync(wav, fm);
  const cover = path.join(BACKGROUNDS_DIR, 'artwork', 'track-cover.png');
  execFileSync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', 'color=c=0x4c1d95:s=400x600:d=1', '-frames:v', '1', cover,
  ], { stdio: 'ignore' });

  const catalog = await scanCatalog({
    roots: [MEDIA_DIR, path.dirname(cover)],
  });
  assert.equal(catalog.mock, false);
  assert.ok(catalog.counts.tracks >= 1);
  assert.ok(catalog.counts.covers >= 1);
  assert.ok(catalog.counts.effects >= 1);
  assert.ok(catalog.counts.stems >= 1);
  assert.ok(catalog.counts.excludedFm >= 1);
  assert.ok(catalog.folders.length >= 2);
  assert.ok(catalog.items.every((item) => item.role !== 'fm' || item.excluded === true));
  const rebuilt = buildCatalog();
  assert.equal(rebuilt.counts.excludedFm, catalog.counts.excludedFm);
});
