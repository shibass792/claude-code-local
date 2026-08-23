const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { writeMidiFile, isMidiFile } = require('../modules/midi-writer');
const { generatePack, getPackStatus, PACK_ZIP, PRESETS, SKELETONS } = require('../modules/psy-pack');
const { promoterEmailHe, promoterEmailEn, weekSprint } = require('../modules/epk-copy');
const { writeEpk, buildCareerBoard } = require('../modules/career-ladder');
const { OUTPUT_DIR } = require('../modules/store');

test('midi writer emits a valid SMF header', () => {
  const dest = path.join(OUTPUT_DIR, 'test_scratch.mid');
  writeMidiFile(dest, {
    bpm: 142,
    name: 'test',
    tracks: [{
      name: 'kick',
      notes: [{ startTick: 0, durationTicks: 120, note: 36, velocity: 100 }],
    }],
  });
  assert.equal(isMidiFile(dest), true);
  const buf = fs.readFileSync(dest);
  assert.equal(buf.subarray(0, 4).toString(), 'MThd');
});

test('psy_pack_v3 writes 3 skeletons, 40 leading MIDI, 10 presets, and a zip', () => {
  const result = generatePack();
  assert.equal(result.success, true);
  assert.equal(result.mock, false);
  assert.equal(result.engine, 'psy_pack_v3');
  assert.equal(result.skeletons, 3);
  assert.equal(result.presets, 10);
  assert.ok(result.midiCount >= 52);
  assert.equal(PRESETS.length, 10);
  assert.equal(SKELETONS.length, 3);
  assert.ok(fs.existsSync(PACK_ZIP));
  assert.ok(result.zipBytes > 1000);
  const status = getPackStatus();
  assert.equal(status.ready, true);
  assert.equal(status.midiCount, result.midiCount);
});

test('promoter EPK emails are short and use real numbers only', () => {
  const he = promoterEmailHe();
  const en = promoterEmailEn({
    setLink: 'https://youtube.com/watch?v=set',
    audixLink: 'https://audix.example/dextamine',
    packLink: 'https://gumroad.com/l/shibass-vol1',
  });
  assert.match(he.subject, /ShiBass/);
  assert.match(he.body, /20\.4K/);
  assert.match(he.body, /@shibassmusic/);
  assert.match(he.body, /\[LINK_SET\]/);
  assert.match(en.body, /https:\/\/youtube.com\/watch\?v=set/);
  assert.doesNotMatch(en.body, /\[LINK_SET\]/);
  assert.ok(he.body.split(/\s+/).length < 180);
  assert.ok(en.body.split(/\s+/).length < 180);
});

test('writeEpk stores Hebrew and English booking emails', () => {
  const result = writeEpk({ inventory: { tracks: 2 }, engines: {}, pending: 0 });
  assert.equal(result.success, true);
  assert.ok(result.wordCount <= 300);
  assert.ok(fs.existsSync(path.join(OUTPUT_DIR, 'epk.md')));
  assert.ok(fs.existsSync(path.join(OUTPUT_DIR, 'epk_promoter_he.txt')));
  assert.ok(fs.existsSync(path.join(OUTPUT_DIR, 'epk_promoter_en.txt')));
  assert.match(result.emails.he.body, /Audix/);
});

test('career board includes the two-week sprint and pack slots', () => {
  const board = buildCareerBoard({ engines: {}, inventory: { tracks: 0 }, pending: 0 });
  assert.equal(board.mock, false);
  assert.equal(board.sprint.title, weekSprint().title);
  assert.equal(board.sprint.weeks.length, 2);
  assert.equal(board.pack.presets.length, 10);
  assert.ok(board.organic.tools.some((tool) => tool.action === 'pack'));
});
