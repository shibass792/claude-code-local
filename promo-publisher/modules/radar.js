const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const {
  RADAR_DB,
  WATCHLIST,
  readJson,
  writeJson,
} = require('./store');

const execFileAsync = promisify(execFile);

const OUTLIER_THRESHOLD = 2.5;

function loadWatchlist() {
  return readJson(WATCHLIST, []);
}

function computeOutlierScore(views, avgViews) {
  if (!avgViews || avgViews <= 0) {
    return 0;
  }
  return Number((views / avgViews).toFixed(2));
}

function analyzePost(artist, post) {
  const views = post.views ?? 0;
  const avgViews = artist.avgViews ?? 1;
  const outlierScore = computeOutlierScore(views, avgViews);

  return {
    id: post.id,
    artist: artist.name,
    handle: artist.handle,
    platform: post.platform ?? artist.platform ?? 'instagram',
    views,
    avgViews,
    outlierScore,
    outlierLabel: `${outlierScore}x`,
    isViral: outlierScore >= OUTLIER_THRESHOLD,
    hookText: post.hookText ?? '',
    style: post.style ?? 'Unknown',
    captionSnippet: post.captionSnippet ?? '',
    keyStrategy: post.keyStrategy ?? '',
    collectedAt: post.collectedAt ?? new Date().toISOString(),
  };
}

function getSampleFeed(watchlist) {
  const samples = [
    {
      id: 'viral_1',
      hookText: 'When the bass hits 142 BPM in the studio 🔥',
      style: 'DAW Screen + Drop Reaction',
      captionSnippet:
        'Testing the new low-end chain. Wait for the second drop... #Psytrance #StudioLife',
      keyStrategy: 'שמירת מתח ב-4 השניות הראשונות עם חיתוך ישיר לפלאגין',
      views: 185000,
    },
    {
      id: 'viral_2',
      hookText: 'Unreleased Track ID from last night 🤯',
      style: 'Crowd Reaction + Live Stage Drop',
      captionSnippet:
        'Eilat was on fire! Track dropping soon on Audix. #TranceFamily #Festival',
      keyStrategy: 'הוק מסתורין (Track ID) שמייצר הצפה של תגובות',
      views: 310000,
    },
    {
      id: 'viral_3',
      hookText: 'Kick & Bass alignment secret you need to know',
      style: 'Educational / Sound Design Tip',
      captionSnippet:
        'Phase alignment is key. Save this for your next session! #MusicProduction #Mixing',
      keyStrategy: 'טריגר שמירה לפוסט (Save for later) שמקפיץ את האלגוריתם',
      views: 95000,
    },
  ];

  return watchlist.slice(0, samples.length).map((artist, index) =>
    analyzePost(artist, {
      ...samples[index],
      id: `${artist.handle}_${samples[index].id}`,
    }),
  );
}

async function tryYtDlpScan(artist) {
  const query = `${artist.name} ${artist.genre ?? 'psytrance'} short`;
  try {
    const { stdout } = await execFileAsync(
      'yt-dlp',
      [
        '--flat-playlist',
        '--dump-single-json',
        '--no-warnings',
        '--playlist-end',
        '6',
        `ytsearch6:${query}`,
      ],
      { timeout: 45000 },
    );
    const parsed = JSON.parse(stdout);
    const entries = parsed.entries ?? [];
    return entries
      .filter((entry) => entry?.id && entry?.title)
      .map((entry) => ({
        id: `yt_${entry.id}`,
        platform: 'youtube',
        views: Number(entry.view_count ?? entry.viewcount ?? 0),
        hookText: entry.title,
        style: 'YouTube Short / live scan',
        captionSnippet: entry.description ?? entry.title,
        keyStrategy: 'Live yt-dlp search — title-as-hook from recent shorts',
        collectedAt: new Date().toISOString(),
      }));
  } catch {
    return null;
  }
}

async function scanWatchlist() {
  const watchlist = loadWatchlist();
  const collected = [];

  for (const artist of watchlist) {
    const scraped = await tryYtDlpScan(artist);
    if (scraped?.length) {
      collected.push(...scraped.map((post) => analyzePost(artist, post)));
    }
  }

  const feed = collected.length > 0 ? collected : getSampleFeed(watchlist);
  const viralOnly = feed
    .filter((item) => item.isViral)
    .sort((a, b) => b.outlierScore - a.outlierScore);

  const payload = {
    scannedAt: new Date().toISOString(),
    source: collected.length > 0 ? 'live' : 'sample',
    items: feed,
    viral: viralOnly,
  };

  writeJson(RADAR_DB, payload);
  return payload;
}

async function getTopTrendingContent() {
  const cached = readJson(RADAR_DB, null);
  if (cached?.viral?.length) {
    return cached.viral;
  }
  const fresh = await scanWatchlist();
  return fresh.viral;
}

async function getTemplateById(templateId) {
  const cached = readJson(RADAR_DB, null);
  const items = cached?.items ?? [];
  return items.find((item) => item.id === templateId) ?? null;
}

if (require.main === module) {
  const runScan = process.argv.includes('--scan');
  (runScan ? scanWatchlist() : getTopTrendingContent())
    .then((data) => {
      console.log(JSON.stringify(data, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  OUTLIER_THRESHOLD,
  loadWatchlist,
  computeOutlierScore,
  analyzePost,
  scanWatchlist,
  getTopTrendingContent,
  getTemplateById,
};
