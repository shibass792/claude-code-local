'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { writeMidi } = require('../modules/midi-writer');
const { generatePsyPack } = require('../modules/psy-pack');
const { buildProducerPack } = require('../modules/producer-pack');
const { createGuide, listGuides } = require('../modules/transcriber');
const { buildEpk } = require('../modules/epk');
const { parseBpmKey, classify } = require('../modules/media-library');
const { zipDirectory } = require('../modules/zip-store');

describe('midi-writer', () => {
  it('writes a valid SMF header', () => {
    const buf = writeMidi({
      bpm: 142,
      tracks: [{ name: 't', events: [] }],
    });
    assert.equal(buf.subarray(0, 4).toString('ascii'), 'MThd');
    assert.ok(buf.length > 30);
  });
});

describe('psy_pack_v3', () => {
  it('generates Phrygian MIDI files', () => {
    const result = generatePsyPack({ count: 6, seed: 11, root: 'E', bpm: 142 });
    assert.equal(result.success, true);
    assert.equal(result.count, 6);
    assert.match(result.scale, /E Phrygian/);
    assert.ok(fs.existsSync(result.files[0].path));
    const header = fs.readFileSync(result.files[0].path).subarray(0, 4).toString('ascii');
    assert.equal(header, 'MThd');
  });
});

describe('producer-pack', () => {
  it('zips a MIDI bank', () => {
    const result = buildProducerPack({ count: 8, seed: 22 });
    assert.equal(result.success, true);
    assert.equal(result.midiCount, 8);
    assert.ok(fs.existsSync(result.zipPath));
    assert.ok(result.bytes > 200);
    const zipHead = fs.readFileSync(result.zipPath).subarray(0, 2).toString('ascii');
    assert.equal(zipHead, 'PK');
  });
});

describe('transcriber + epk', () => {
  it('writes guide_he.md', () => {
    const guide = createGuide({
      title: 'Backbone punch',
      notes: '- noise layer\n- short decay',
      source: 'test',
    });
    assert.equal(guide.success, true);
    assert.match(guide.guide.file, /guide_he\.md$/);
    assert.ok(fs.existsSync(guide.guide.path));
    assert.ok(listGuides().count >= 1);
  });

  it('writes promoter email', () => {
    const epk = buildEpk({ latestSet: 'Shiva Mangala remix / edits' });
    assert.equal(epk.success, true);
    assert.match(epk.promoterEmail, /Shiva Mangala/);
    assert.ok(fs.existsSync(epk.emailPath));
  });
});

describe('media meta', () => {
  it('parses bpm/key and daw kind', () => {
    const meta = parseBpmKey('01_lead_E_phrygian_142bpm_s3.mid');
    assert.equal(meta.bpm, 142);
    assert.match(meta.key, /E/i);
    assert.equal(classify('song.cpr'), 'daw');
    assert.equal(classify('loop.mid'), 'midi');
  });
});

describe('zip-store', () => {
  it('zips a temp folder', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbzip-'));
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
    const zipPath = path.join(os.tmpdir(), `sbzip-${Date.now()}.zip`);
    const result = zipDirectory(dir, zipPath);
    assert.ok(result.bytes > 30);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
  });
});
