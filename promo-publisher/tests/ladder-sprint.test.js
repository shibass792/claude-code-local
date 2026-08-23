'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const family = require('../modules/phrygian-family');
const { generatePsyPack } = require('../modules/psy-pack');
const { getSprint, toggleCell, resetSprint, PROGRESS } = require('../modules/sprint');
const { getLadder } = require('../modules/ladder');
const { getWave1, parseAdsCsv, evaluateCsvFile } = require('../modules/ads-cpc');
const { probeOps, extraTargets } = require('../modules/ops-probe');
const { ingestFile } = require('../modules/transcriber');
const { buildEpk } = require('../modules/epk');
const { callTool, TOOLS } = require('../mcp-server');

const CSV = path.join(__dirname, 'fixtures', 'wave1-sample.csv');
const NOTES = path.join(__dirname, 'fixtures', 'notes.txt');

describe('phrygian family', () => {
  it('locks bass/kick to Phrygian and wanders leads', () => {
    const rngLow = () => 0.01;
    const rngHigh = () => 0.99;
    assert.equal(family.pickFamily('bass', rngHigh).id, 'phrygian');
    assert.equal(family.pickFamily('kick', rngHigh).id, 'phrygian');
    assert.equal(family.pickFamily('lead', rngLow).id, 'phrygian');
    assert.equal(family.pickFamily('lead', rngHigh).id, 'locrian');
    assert.equal(family.pickFamily('arp', () => 0.8).id, 'phrygian_dominant');
  });

  it('builds a 20/15/10/5 mix at 50 files', () => {
    const kinds = family.kindsForCount(50);
    const mix = family.countByKind(kinds);
    assert.equal(mix.bass, 20);
    assert.equal(mix.lead, 15);
    assert.equal(mix.arp, 10);
    assert.equal((mix.kick || 0) + (mix.hats || 0), 5);
  });

  it('picks BPM in 138–142 when not requested', () => {
    const bpm = family.pickBpm(() => 0.5);
    assert.ok(bpm >= 138 && bpm <= 142);
  });
});

describe('dated psy_pack', () => {
  it('writes into a dated folder and keeps E Phrygian in the scale label', () => {
    const result = generatePsyPack({ count: 50, seed: 99, root: 'E', bpm: 140, date: '2026-08-23' });
    assert.equal(result.success, true);
    assert.equal(result.count, 50);
    assert.equal(result.date, '2026-08-23');
    assert.match(result.scale, /E Phrygian/);
    assert.equal(result.mix.bass, 20);
    assert.ok(result.files[0].path.includes(`${path.sep}2026-08-23${path.sep}`));
    assert.ok(fs.existsSync(result.files[0].path));
    const bass = result.files.filter((f) => f.kind === 'bass');
    assert.ok(bass.every((f) => f.family === 'phrygian'));
  });
});

describe('sprint + ladder + wave1', () => {
  it('loads 42 sprint cells and toggles on disk', () => {
    resetSprint();
    const before = getSprint();
    assert.equal(before.cells.length, 42);
    assert.equal(before.completed, 0);
    const after = toggleCell('c01', true);
    assert.equal(after.completed, 1);
    assert.equal(after.cells.find((c) => c.id === 'c01').done, true);
    assert.ok(fs.existsSync(PROGRESS));
    resetSprint();
  });

  it('loads ShiBass ladder snapshot', () => {
    const ladder = getLadder();
    assert.equal(ladder.success, true);
    assert.equal(ladder.self.instagram.followers, 20400);
    assert.equal(ladder.self.spotifyMonthly.value, null);
    assert.ok(ladder.rungs.length >= 10);
    assert.ok(ladder.booking.some((b) => b.email === 'booking@fm-booking.com'));
  });

  it('keeps the 20 Wave 1 campaign IDs and scores a dropped CSV', () => {
    const wave = getWave1();
    assert.equal(wave.campaigns.length, 20);
    assert.equal(wave.account, 'act_447647440556829');
    assert.ok(wave.campaigns.every((c) => c.status === 'PAUSED'));
    assert.equal(wave.campaigns[0].id, '120249738379150378');
    assert.equal(wave.campaigns[19].id, '120249738387000378');

    const parsed = parseAdsCsv(fs.readFileSync(CSV, 'utf8'));
    assert.equal(parsed.length, 4);
    const report = evaluateCsvFile(CSV);
    assert.equal(report.keep.some((c) => c.id === '120249738379150378'), true);
    assert.equal(report.kill.some((c) => c.id === '120249738383750378'), true);
    assert.equal(report.kill.some((c) => c.id === '120249738384050378'), true);
    assert.equal(report.unknown.length >= 1, true);
    assert.match(report.note, /never enables/i);
  });
});

describe('ops honesty + ingest + epk + mcp', () => {
  it('does not invent a full ONLINE grid', async () => {
    const report = await probeOps();
    assert.equal(report.honest, true);
    assert.ok(report.checked >= extraTargets().length);
    assert.ok(report.online + report.offline === report.checked);
    assert.match(report.summary, /listening on this machine/);
    assert.ok(!/12\/12/.test(report.summary) || report.online === 12);
  });

  it('ingests a local notes file', () => {
    const guide = ingestFile({ filePath: NOTES, title: 'family notes' });
    assert.equal(guide.success, true);
    assert.match(guide.guide.file, /guide_he\.md$/);
    assert.match(fs.readFileSync(guide.guide.path, 'utf8'), /Phrygian bass/);
  });

  it('writes the ready-to-send EPK', () => {
    const epk = buildEpk();
    assert.match(epk.promoterEmail, /Dextamine/);
    assert.match(epk.promoterEmail, /Blue Tunes/);
    assert.match(epk.promoterEmail, /EwVxKdqwoOI/);
    assert.match(epk.onePager, /@shibassmusic/);
  });

  it('exposes MCP tools and can call sprint_status', async () => {
    assert.ok(TOOLS.some((t) => t.name === 'wave1_list'));
    const result = await callTool('sprint_status', {});
    assert.equal(result.success, true);
    assert.equal(result.total, 42);
  });
});
