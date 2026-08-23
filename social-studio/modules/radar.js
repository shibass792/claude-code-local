'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const WATCHLIST_PATH = path.join(DATA_DIR, 'watchlist.json');
const FEED_PATH = path.join(DATA_DIR, 'viral-feed.json');
const DEFAULT_OUTLIER_THRESHOLD = 2.5;

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadWatchlist() {
  return readJson(WATCHLIST_PATH, []);
}

function loadFeed() {
  return readJson(FEED_PATH, []);
}

/**
 * Outlier score = post views / artist average views.
 * Returns null when avgViews is missing or zero.
 */
function computeOutlierScore(views, avgViews) {
  const v = Number(views);
  const avg = Number(avgViews);
  if (!Number.isFinite(v) || !Number.isFinite(avg) || avg <= 0) {
    return null;
  }
  return Math.round((v / avg) * 100) / 100;
}

function formatOutlierLabel(score) {
  if (score == null) {
    return 'n/a';
  }
  return `${score.toFixed(1)}x`;
}

function enrichPost(post, watchlistByName, threshold) {
  const artistMeta = watchlistByName.get(post.artist) || {};
  const avgViews = post.avgViews ?? artistMeta.avgViews ?? 0;
  const score = computeOutlierScore(post.views, avgViews);
  const isWinning = score != null && score >= threshold;

  return {
    ...post,
    avgViews,
    outlierScore: score,
    outlierLabel: formatOutlierLabel(score),
    isWinningTemplate: isWinning,
    genre: artistMeta.genre || post.genre || 'unknown',
  };
}

function getTopTrendingContent(options = {}) {
  const threshold = options.threshold ?? DEFAULT_OUTLIER_THRESHOLD;
  const winnersOnly = options.winnersOnly !== false;
  const watchlist = loadWatchlist();
  const feed = loadFeed();
  const byName = new Map(watchlist.map((a) => [a.name, a]));

  const enriched = feed
    .map((post) => enrichPost(post, byName, threshold))
    .filter((post) => (winnersOnly ? post.isWinningTemplate : true))
    .sort((a, b) => (b.outlierScore || 0) - (a.outlierScore || 0));

  return enriched;
}

function getWatchlist() {
  return loadWatchlist();
}

function summarizeRadar() {
  const all = getTopTrendingContent({ winnersOnly: false });
  const winners = all.filter((p) => p.isWinningTemplate);
  return {
    watchedArtists: loadWatchlist().length,
    scannedPosts: all.length,
    winningTemplates: winners.length,
    topHook: winners[0]?.hookText || null,
    threshold: DEFAULT_OUTLIER_THRESHOLD,
  };
}

module.exports = {
  DEFAULT_OUTLIER_THRESHOLD,
  computeOutlierScore,
  formatOutlierLabel,
  getTopTrendingContent,
  getWatchlist,
  summarizeRadar,
  enrichPost,
};
