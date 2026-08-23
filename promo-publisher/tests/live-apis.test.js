'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const mediaLibrary = require('../modules/media-library');
const renderEngine = require('../modules/render-engine');
const hookGenerator = require('../modules/hook-generator');
const engines = require('../modules/engines');
const { createCampaignFromRender } = require('../modules/campaign-factory');

const FIXTURE_WAV = path.join(
  __dirname,
  '..',
  'fixtures',
  'media',
  'ShiBass_Test_Bass_143BPM.wav',
);

describe('media-library', () => {
  it('scans fixtures and indexes audio + midi', () => {
    const result = mediaLibrary.scanMediaLibrary({
      roots: [path.join(__dirname, '..', 'fixtures', 'media')],
      maxFiles: 100,
    });
    assert.equal(result.source, 'live-scan');
    assert.ok(result.counts.total >= 2);
    assert.ok(result.counts.audio >= 1);
    assert.ok(result.counts.midi >= 1);
    const lib = mediaLibrary.getLibrary({ kind: 'audio' });
    assert.ok(lib.hasIndex);
    assert.ok(lib.items.length >= 1);
  });
});

describe('render-engine', () => {
  it('probes ffmpeg', async () => {
    const probe = await renderEngine.probeFfmpeg();
    assert.equal(probe.ok, true);
  });

  it('renders a real 9:16 mp4 from fixture wav', async () => {
    assert.ok(fs.existsSync(FIXTURE_WAV), 'fixture wav missing');
    mediaLibrary.scanMediaLibrary({
      roots: [path.dirname(FIXTURE_WAV)],
    });
    const result = await renderEngine.renderReel({
      audioPath: FIXTURE_WAV,
      hook: 'ShiBass Test Hook',
      durationSec: 5,
      fps: 24,
    });
    assert.equal(result.success, true, result.error || result.detail);
    assert.equal(result.source, 'ffmpeg-live');
    assert.ok(fs.existsSync(result.outputPath));
    assert.ok(result.size > 1000);
  });
});

describe('hook-generator', () => {
  it('returns hooks with explicit source label', async () => {
    const result = await hookGenerator.generateHooks({
      track: 'ShiBass',
      bpm: 143,
      genre: 'Psytrance',
    });
    assert.equal(result.success, true);
    assert.ok(['ollama-live', 'local-templates'].includes(result.source));
    assert.equal(result.hooks.length, 3);
  });
});

describe('engines status', () => {
  it('returns live probe payload and disables InstaPy', async () => {
    const status = await engines.getEnginesStatus();
    assert.equal(status.source, 'live-probe');
    assert.equal(status.policy.instapy, 'disabled');
    assert.equal(status.policy.instagram, 'meta-graph-api');
    assert.ok(status.engines.ffmpeg);
    const log = engines.formatStatusLog(status);
    assert.match(log, /not a simulator/i);
    assert.match(log, /InstaPy\/Selenium = disabled/);
  });
});

describe('campaign-factory', () => {
  it('creates campaign from live render', async () => {
    mediaLibrary.scanMediaLibrary({ roots: [path.dirname(FIXTURE_WAV)] });
    const result = await createCampaignFromRender({
      track: 'ShiBass Test',
      audioPath: FIXTURE_WAV,
      hook: 'Live API Test',
      durationSec: 5,
      fps: 24,
    });
    assert.equal(result.success, true, result.error);
    assert.ok(result.campaign.id);
    assert.ok(result.campaign.videoPath.includes('reels_render_'));
  });
});
