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

function normalizeHandle(handle) {
  return String(handle ?? '')
    .trim()
    .replace(/^@/, '');
}

async function tryYtDlpScan(handle) {
  const user = normalizeHandle(handle);
  if (!user) {
    return [];
  }

  try {
    await execFileAsync('yt-dlp', ['--version']);
  } catch {
    return { error: 'yt-dlp is not installed', posts: [] };
  }

  const targets = [
    `https://www.instagram.com/${user}/reels/`,
    `https://www.tiktok.com/@${user}`,
  ];

  let lastScanError = null;

  for (const url of targets) {
    try {
      const { stdout } = await execFileAsync(
        'yt-dlp',
        ['--flat-playlist', '--dump-single-json', '--playlist-end', '8', url],
        { timeout: 45000 },
      );
      const parsed = JSON.parse(stdout);
      const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      const posts = entries
        .map((entry, index) => ({
          id: String(entry.id ?? `${user}_${index}`),
          platform: url.includes('tiktok') ? 'tiktok' : 'instagram',
          views: Number(entry.view_count ?? entry.play_count ?? 0),
          hookText: entry.title ?? entry.description ?? '',
          style: url.includes('tiktok') ? 'TikTok live scan' : 'Instagram Reels live scan',
          captionSnippet: (entry.description ?? entry.title ?? '').slice(0, 180),
          keyStrategy: 'Live yt-dlp metadata — views vs watchlist baseline',
          collectedAt: new Date().toISOString(),
        }))
        .filter((post) => post.hookText || post.views > 0);
      if (posts.length) {
        return { error: null, posts };
      }
    } catch (error) {
      lastScanError = error.message;
    }
  }

  return { error: lastScanError || `No public posts found for @${user}`, posts: [] };
}

async function scanWatchlist() {
  const watchlist = loadWatchlist();
  const collected = [];
  const errors = [];

  for (const artist of watchlist) {
    const scraped = await tryYtDlpScan(artist.handle);
    const posts = Array.isArray(scraped) ? scraped : scraped?.posts ?? [];
    if (scraped && !Array.isArray(scraped) && scraped.error) {
      errors.push(`${artist.handle}: ${scraped.error}`);
    }
    if (posts.length) {
      collected.push(...posts.map((post) => analyzePost(artist, post)));
    }
  }

  const allowSample = process.env.RADAR_ALLOW_SAMPLE === '1';
  const feed = collected.length > 0 ? collected : allowSample ? getSampleFeed(watchlist) : [];
  const viralOnly = feed
    .filter((item) => item.isViral)
    .sort((a, b) => b.outlierScore - a.outlierScore);

  const payload = {
    scannedAt: new Date().toISOString(),
    source: collected.length > 0 ? 'live' : allowSample ? 'sample' : 'empty',
    mock: false,
    errors,
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
  tryYtDlpScan,
  normalizeHandle,
  getTopTrendingContent,
  getTemplateById,
};
