const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const radar = require('../modules/radar');
const approval = require('../modules/approval-publisher');
const { PENDING_DB, RADAR_DB, writeJson } = require('../modules/store');

test('computeOutlierScore calculates ratio', () => {
  assert.equal(radar.computeOutlierScore(100000, 40000), 2.5);
  assert.equal(radar.computeOutlierScore(0, 40000), 0);
});

test('analyzePost flags viral outliers', () => {
  const artist = { name: 'Test', handle: 'test', avgViews: 10000 };
  const viral = radar.analyzePost(artist, {
    id: 'p1',
    views: 30000,
    hookText: 'hook',
  });
  assert.equal(viral.isViral, true);
  assert.equal(viral.outlierScore, 3);
});

test('scanWatchlist writes radar feed', async () => {
  if (fs.existsSync(RADAR_DB)) {
    fs.unlinkSync(RADAR_DB);
  }
  const result = await radar.scanWatchlist();
  assert.ok(result.viral.length >= 1);
  assert.ok(fs.existsSync(RADAR_DB));
});

test('publishCampaign requires watched flag', async () => {
  const result = await approval.publishCampaign({
    id: 'test_unwatched',
    title: 'Test',
    watched: false,
    platforms: ['instagram'],
  });
  assert.equal(result.success, false);
  assert.match(result.error, /צפות/);
});

test('rejectCampaign removes item from queue', () => {
  writeJson(PENDING_DB, [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
  ]);
  const res = approval.rejectCampaign('a');
  assert.equal(res.success, true);
  const queue = approval.getPendingQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].id, 'b');
});

test('buildCaption joins he/en/hashtags', () => {
  const caption = approval.buildCaption({
    captionHe: 'שלום',
    captionEn: 'Hello',
    hashtags: '#test',
  });
  assert.match(caption, /שלום/);
  assert.match(caption, /Hello/);
  assert.match(caption, /#test/);
});
