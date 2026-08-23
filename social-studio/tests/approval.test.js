'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Isolate approval DB under a temp output dir by monkey-patching module paths via cwd copy.
// The modules write under ../output relative to modules/, so we use a disposable fixture
// by working against the real module but restoring files after.

const approval = require('../modules/approval-publisher');
const factory = require('../modules/campaign-factory');

const OUTPUT = approval.OUTPUT_DIR;
const PENDING = approval.PENDING_DB;
const RESULTS = approval.RESULTS_DB;
const HISTORY = approval.HISTORY_DB || path.join(OUTPUT, 'publish_history.json');

let backup = null;

function snapshot() {
  return {
    pending: fs.existsSync(PENDING) ? fs.readFileSync(PENDING, 'utf8') : null,
    results: fs.existsSync(RESULTS) ? fs.readFileSync(RESULTS, 'utf8') : null,
    history: fs.existsSync(HISTORY) ? fs.readFileSync(HISTORY, 'utf8') : null,
  };
}

function restore(snap) {
  fs.mkdirSync(OUTPUT, { recursive: true });
  for (const [file, content] of [
    [PENDING, snap.pending],
    [RESULTS, snap.results],
    [HISTORY, snap.history],
  ]) {
    if (content == null) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } else {
      fs.writeFileSync(file, content, 'utf8');
    }
  }
}

describe('approval publisher gate', () => {
  before(() => {
    backup = snapshot();
    fs.mkdirSync(OUTPUT, { recursive: true });
    fs.writeFileSync(PENDING, '[]', 'utf8');
    if (fs.existsSync(RESULTS)) fs.unlinkSync(RESULTS);
    if (fs.existsSync(HISTORY)) fs.unlinkSync(HISTORY);
  });

  after(() => {
    restore(backup);
  });

  it('blocks publish before watch', async () => {
    const campaign = factory.createCampaignFromTemplate({
      templateId: 'drop_reaction',
      title: 'Test Gate Campaign',
    });
    await assert.rejects(
      () => approval.publishCampaign(campaign, { dryRun: true }),
      /Watch the preview/
    );
  });

  it('publishes after watch and records history', async () => {
    const pending = approval.getPendingQueue();
    const campaign = pending.find((c) => c.title === 'Test Gate Campaign') || pending[0];
    assert.ok(campaign);

    const watched = approval.markWatched(campaign.id);
    assert.equal(watched.success, true);
    assert.equal(watched.campaign.watchedOnce, true);

    const result = await approval.publishCampaign(
      {
        ...watched.campaign,
        platforms: ['instagram', 'tiktok'],
      },
      { dryRun: true }
    );

    assert.equal(result.success, true);
    assert.equal(result.dryRun, true);
    assert.ok(result.urls.instagram);
    assert.ok(result.temporaryMediaUrl);

    const history = approval.getPublishHistory();
    assert.ok(history.some((h) => h.id === campaign.id));

    const stillPending = approval.getPendingQueue().some((c) => c.id === campaign.id);
    assert.equal(stillPending, false);
  });

  it('rejects a pending campaign', () => {
    const created = factory.createCampaignFromTemplate({
      templateId: 'meme',
      title: 'Reject Me',
    });
    const res = approval.rejectCampaign(created.id);
    assert.equal(res.success, true);
    assert.equal(res.campaign.status, approval.STATUS.REJECTED);
    assert.equal(
      approval.getPendingQueue().some((c) => c.id === created.id),
      false
    );
  });

  it('creates remix campaign from radar idea', () => {
    const remix = factory.createFromRadarIdea({
      id: 'viral_test',
      artist: 'Astrix',
      hookText: 'Wait for the drop',
      style: 'Educational / Sound Design Tip',
      outlierLabel: '4.1x',
      keyStrategy: 'save trigger',
    });
    assert.equal(remix.status, approval.STATUS.PENDING_APPROVAL);
    assert.equal(remix.templateId, 'sound_design');
    assert.equal(remix.remixFrom.artist, 'Astrix');
  });
});
