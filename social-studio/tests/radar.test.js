'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const radar = require('../modules/radar');

describe('radar outlier engine', () => {
  it('computes outlier score as views / avgViews', () => {
    assert.equal(radar.computeOutlierScore(90000, 30000), 3);
    assert.equal(radar.computeOutlierScore(185000, 45000), 4.11);
  });

  it('returns null for invalid averages', () => {
    assert.equal(radar.computeOutlierScore(1000, 0), null);
    assert.equal(radar.computeOutlierScore('x', 10), null);
  });

  it('formats outlier labels', () => {
    assert.equal(radar.formatOutlierLabel(2.7), '2.7x');
    assert.equal(radar.formatOutlierLabel(null), 'n/a');
  });

  it('returns winning templates sorted by score', () => {
    const winners = radar.getTopTrendingContent({ winnersOnly: true, threshold: 2.5 });
    assert.ok(winners.length >= 3);
    assert.equal(winners[0].isWinningTemplate, true);
    for (let i = 1; i < winners.length; i += 1) {
      assert.ok(winners[i - 1].outlierScore >= winners[i].outlierScore);
    }
  });

  it('summarizes radar health', () => {
    const summary = radar.summarizeRadar();
    assert.ok(summary.watchedArtists >= 5);
    assert.ok(summary.scannedPosts >= 5);
    assert.ok(summary.winningTemplates >= 1);
    assert.ok(summary.topHook);
  });
});
