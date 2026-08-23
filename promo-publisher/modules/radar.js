'use strict';

/**
 * Artist radar — real competitor scanning via yt-dlp.
 *
 * The previous version had a `tryYtDlpScan` stub that always returned null, so
 * every "scan" silently served a hardcoded sample feed. Now the scan actually
 * shells out to yt-dlp, derives each artist's own baseline from the posts it
 * fetched, and reports honestly when a source could not be read.
 *
 * Sample data is opt-in only (RADAR_ALLOW_SAMPLE=1) and always labelled.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const {
  RADAR_DB,
  WATCHLIST,
  readJson,
  writeJson,
} = require('./store');

const execFileAsync = promisify(execFile);

// Resolved per call so a value loaded later from config/.env still applies.
const ytdlpBin = () => process.env.YTDLP_PATH || 'yt-dlp';

const OUTLIER_THRESHOLD = Number(process.env.RADAR_OUTLIER_THRESHOLD ?? 2.5);
const POSTS_PER_ARTIST = Number(process.env.RADAR_POSTS_PER_ARTIST ?? 12);
const SCAN_TIMEOUT_MS = Number(process.env.RADAR_TIMEOUT_MS ?? 90000);

function loadWatchlist() {
  return readJson(WATCHLIST, []);
}

function computeOutlierScore(views, avgViews) {
  if (!avgViews || avgViews <= 0) {
    return 0;
  }
  return Number((views / avgViews).toFixed(2));
}

function median(numbers) {
  const sorted = numbers.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!sorted.length) {
    return 0;
  }
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function analyzePost(artist, post) {
  const views = post.views ?? 0;
  const avgViews = post.avgViews ?? artist.avgViews ?? 1;
  const outlierScore = computeOutlierScore(views, avgViews);

  return {
    id: post.id,
    artist: artist.name,
    handle: artist.handle,
    platform: post.platform ?? artist.platform ?? 'instagram',
    url: post.url ?? null,
    views,
    avgViews,
    outlierScore,
    outlierLabel: `${outlierScore}x`,
    isViral: outlierScore >= OUTLIER_THRESHOLD,
    hookText: post.hookText ?? '',
    style: post.style ?? 'Unknown',
    captionSnippet: post.captionSnippet ?? '',
    keyStrategy: post.keyStrategy ?? '',
    source: post.source ?? 'live',
    collectedAt: post.collectedAt ?? new Date().toISOString(),
  };
}

async function checkHealth() {
  try {
    const { stdout } = await execFileAsync(ytdlpBin(), ['--version'], { timeout: 15000 });
    return { ok: true, tool: ytdlpBin(), version: stdout.trim() };
  } catch (error) {
    return {
      ok: false,
      tool: ytdlpBin(),
      error: `yt-dlp not available: ${error.message}. Install with: pip install -U yt-dlp`,
    };
  }
}

/**
 * Candidate listing URLs for an artist, tried in order. `url` on the watchlist
 * entry wins so any platform yt-dlp supports can be tracked.
 *
 * YouTube needs two candidates: channels without a Shorts tab return
 * "This channel does not have a shorts tab", so fall back to /videos.
 */
function buildSourceUrls(artist) {
  if (artist.url) {
    return [artist.url];
  }

  const handle = String(artist.handle ?? '').replace(/^@/, '');
  if (!handle) {
    return [];
  }

  switch (artist.platform) {
    case 'youtube':
      return [
        `https://www.youtube.com/@${handle}/shorts`,
        `https://www.youtube.com/@${handle}/videos`,
      ];
    case 'tiktok':
      return [`https://www.tiktok.com/@${handle}`];
    case 'instagram':
    default:
      return [`https://www.instagram.com/${handle}/`];
  }
}

/** First candidate URL — kept for callers that only need the primary source. */
function buildSourceUrl(artist) {
  return buildSourceUrls(artist)[0] ?? null;
}

/**
 * Private platforms need credentials; support both a cookie file and a browser
 * cookie jar so the operator can pick whichever they already have.
 */
function buildAuthArgs() {
  const args = [];
  if (process.env.YTDLP_COOKIES_FILE) {
    args.push('--cookies', process.env.YTDLP_COOKIES_FILE);
  } else if (process.env.YTDLP_COOKIES_FROM_BROWSER) {
    args.push('--cookies-from-browser', process.env.YTDLP_COOKIES_FROM_BROWSER);
  }
  return args;
}

function normalizeEntry(entry, artist, sourceUrl) {
  const views = Number(entry.view_count ?? entry.views ?? 0);
  const title = entry.title ?? entry.description ?? '';

  return {
    id: `${artist.handle}_${entry.id ?? Math.random().toString(36).slice(2)}`,
    platform: artist.platform ?? 'instagram',
    url: entry.url ?? entry.webpage_url ?? sourceUrl,
    views,
    hookText: String(title).split('\n')[0].slice(0, 140),
    captionSnippet: String(entry.description ?? title).slice(0, 220),
    style: entry.duration && entry.duration <= 60 ? 'Short / Vertical' : 'Long form',
    likeCount: Number(entry.like_count ?? 0) || null,
    commentCount: Number(entry.comment_count ?? 0) || null,
    durationSec: Number(entry.duration ?? 0) || null,
    uploadDate: entry.upload_date ?? null,
    source: 'live',
  };
}

async function fetchFromUrl(artist, sourceUrl) {
  const args = [
    '--dump-single-json',
    '--flat-playlist',
    '--playlist-end', String(POSTS_PER_ARTIST),
    '--no-warnings',
    '--ignore-errors',
    ...buildAuthArgs(),
    sourceUrl,
  ];

  const { stdout } = await execFileAsync(ytdlpBin(), args, {
    timeout: SCAN_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
  });

  const data = JSON.parse(stdout);
  const entries = Array.isArray(data.entries) ? data.entries : [data];
  return entries.filter(Boolean).map((entry) => normalizeEntry(entry, artist, sourceUrl));
}

/**
 * Fetch real recent-post metadata for one artist, trying each candidate URL.
 * Returns posts: null when no source could be read (tool missing, login
 * required, network error) — never invented data.
 */
async function scanArtist(artist) {
  const candidates = buildSourceUrls(artist);
  if (!candidates.length) {
    return { posts: null, error: 'No handle or url configured' };
  }

  const errors = [];

  for (const sourceUrl of candidates) {
    try {
      const usable = await fetchFromUrl(artist, sourceUrl);

      if (!usable.length) {
        errors.push(`${sourceUrl}: returned no posts`);
        continue;
      }

      // The artist's own recent median is a far better baseline than a
      // hand-typed avgViews, and it keeps up as their audience grows.
      const observedMedian = median(usable.map((post) => post.views));
      const baseline = observedMedian > 0 ? observedMedian : artist.avgViews ?? 1;

      return {
        posts: usable.map((post) => ({ ...post, avgViews: baseline })),
        baseline,
        sourceUrl,
      };
    } catch (error) {
      const detail = (error.stderr || error.message || '').toString().trim().slice(-300);
      errors.push(`${sourceUrl}: ${detail || 'yt-dlp failed'}`);
    }
  }

  return { posts: null, error: errors.join(' | '), sourceUrl: candidates[0] };
}

const SAMPLE_POSTS = [
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
    captionSnippet: 'Eilat was on fire! Track dropping soon on Audix. #TranceFamily #Festival',
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

function sampleAllowed() {
  return process.env.RADAR_ALLOW_SAMPLE === '1';
}

function getSampleFeed(watchlist) {
  return watchlist.slice(0, SAMPLE_POSTS.length).map((artist, index) =>
    analyzePost(artist, {
      ...SAMPLE_POSTS[index],
      id: `${artist.handle}_${SAMPLE_POSTS[index].id}`,
      source: 'sample',
    }),
  );
}

/**
 * Scan the whole watchlist against the real sources.
 */
async function scanWatchlist({ onProgress } = {}) {
  const watchlist = loadWatchlist();
  const health = await checkHealth();
  const collected = [];
  const errors = [];

  if (health.ok) {
    for (const [index, artist] of watchlist.entries()) {
      onProgress?.({ phase: 'artist', artist: artist.name, index: index + 1, total: watchlist.length });
      const result = await scanArtist(artist);

      if (result.posts?.length) {
        collected.push(...result.posts.map((post) => analyzePost(artist, post)));
      } else {
        errors.push({ artist: artist.name, handle: artist.handle, error: result.error });
      }
    }
  } else {
    errors.push({ artist: '*', error: health.error });
  }

  const usedSample = collected.length === 0 && sampleAllowed();
  const feed = collected.length > 0 ? collected : usedSample ? getSampleFeed(watchlist) : [];

  const viralOnly = feed
    .filter((item) => item.isViral)
    .sort((a, b) => b.outlierScore - a.outlierScore);

  let warning = null;
  if (collected.length === 0) {
    warning = usedSample
      ? 'לא הושג מידע חי — מוצג פיד דוגמה (RADAR_ALLOW_SAMPLE=1)'
      : `לא הושג מידע חי מאף מקור. ${health.ok ? 'בדוק handles / cookies' : health.error}`;
  }

  const payload = {
    scannedAt: new Date().toISOString(),
    source: collected.length > 0 ? 'live' : usedSample ? 'sample' : 'none',
    tool: health,
    items: feed,
    viral: viralOnly,
    errors,
    warning,
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

function getRadarFeed() {
  return readJson(RADAR_DB, null);
}

async function getTemplateById(templateId) {
  const cached = readJson(RADAR_DB, null);
  const items = cached?.items ?? [];
  return items.find((item) => item.id === templateId) ?? null;
}

if (require.main === module) {
  const runScan = process.argv.includes('--scan');
  (runScan
    ? scanWatchlist({
        onProgress: (p) => console.error(`[radar] ${p.index}/${p.total} ${p.artist}`),
      })
    : getTopTrendingContent()
  )
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
  POSTS_PER_ARTIST,
  SAMPLE_POSTS,
  loadWatchlist,
  computeOutlierScore,
  median,
  analyzePost,
  checkHealth,
  buildSourceUrl,
  buildSourceUrls,
  buildAuthArgs,
  normalizeEntry,
  scanArtist,
  sampleAllowed,
  getSampleFeed,
  scanWatchlist,
  getTopTrendingContent,
  getRadarFeed,
  getTemplateById,
};
