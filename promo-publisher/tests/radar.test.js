'use strict';

// Redirect all generated files to a scratch dir BEFORE the modules are loaded,
// so running the suite never touches a real approval queue, radar feed or index.
process.env.SHIBASS_OUTPUT_DIR = require('fs').mkdtempSync(
  require('path').join(require('os').tmpdir(), 'shibass-out-'),
);

/**
 * Radar tests never touch the network: YTDLP_PATH is pointed at a binary that
 * does not exist so the "tool unavailable" path is exercised deterministically.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const radar = require('../modules/radar');
const { RADAR_DB } = require('../modules/store');

const NO_TOOL = '/definitely/not/a/real/yt-dlp';

function withEnv(vars, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return (async () => {
    try {
      return await fn();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  })();
}

test('computeOutlierScore calculates ratio', () => {
  assert.equal(radar.computeOutlierScore(100000, 40000), 2.5);
  assert.equal(radar.computeOutlierScore(0, 40000), 0);
  assert.equal(radar.computeOutlierScore(1000, 0), 0);
});

test('median ignores zeros and handles even counts', () => {
  assert.equal(radar.median([1, 2, 3]), 2);
  assert.equal(radar.median([1, 2, 3, 4]), 2.5);
  assert.equal(radar.median([0, 0, 10]), 10);
  assert.equal(radar.median([]), 0);
});

test('analyzePost flags viral outliers', () => {
  const artist = { name: 'Test', handle: 'test', avgViews: 10000 };
  const viral = radar.analyzePost(artist, { id: 'p1', views: 30000, hookText: 'hook' });
  assert.equal(viral.isViral, true);
  assert.equal(viral.outlierScore, 3);

  const normal = radar.analyzePost(artist, { id: 'p2', views: 12000 });
  assert.equal(normal.isViral, false);
});

test('analyzePost prefers the per-post baseline over the configured average', () => {
  const artist = { name: 'A', handle: 'a', avgViews: 1000 };
  const post = radar.analyzePost(artist, { id: 'p', views: 4000, avgViews: 2000 });
  assert.equal(post.avgViews, 2000);
  assert.equal(post.outlierScore, 2);
});

test('buildSourceUrl maps each platform and respects an explicit url', () => {
  assert.equal(
    radar.buildSourceUrl({ handle: 'astrixofficial', platform: 'instagram' }),
    'https://www.instagram.com/astrixofficial/',
  );
  assert.equal(
    radar.buildSourceUrl({ handle: '@shibass', platform: 'tiktok' }),
    'https://www.tiktok.com/@shibass',
  );
  assert.equal(
    radar.buildSourceUrl({ handle: 'chan', platform: 'youtube' }),
    'https://www.youtube.com/@chan/shorts',
  );
  assert.equal(radar.buildSourceUrl({ url: 'https://example.com/x' }), 'https://example.com/x');
  assert.equal(radar.buildSourceUrl({}), null);
});

test('youtube falls back to /videos for channels with no shorts tab', () => {
  assert.deepEqual(radar.buildSourceUrls({ handle: 'chan', platform: 'youtube' }), [
    'https://www.youtube.com/@chan/shorts',
    'https://www.youtube.com/@chan/videos',
  ]);

  assert.equal(radar.buildSourceUrls({ handle: 'x', platform: 'tiktok' }).length, 1);
  assert.deepEqual(radar.buildSourceUrls({ url: 'https://e.com/x' }), ['https://e.com/x']);
  assert.deepEqual(radar.buildSourceUrls({}), []);
});

test('scanArtist reports every candidate it tried when all of them fail', async () => {
  await withEnv({ YTDLP_PATH: NO_TOOL }, async () => {
    const result = await radar.scanArtist({ handle: 'chan', platform: 'youtube' });
    assert.equal(result.posts, null);
    assert.match(result.error, /shorts/);
    assert.match(result.error, /videos/, 'the fallback attempt is reported too');
  });
});

test('buildAuthArgs prefers a cookie file over a browser jar', async () => {
  await withEnv({ YTDLP_COOKIES_FILE: '/tmp/c.txt', YTDLP_COOKIES_FROM_BROWSER: 'chrome' }, () => {
    assert.deepEqual(radar.buildAuthArgs(), ['--cookies', '/tmp/c.txt']);
  });

  await withEnv({ YTDLP_COOKIES_FILE: undefined, YTDLP_COOKIES_FROM_BROWSER: 'firefox' }, () => {
    assert.deepEqual(radar.buildAuthArgs(), ['--cookies-from-browser', 'firefox']);
  });

  await withEnv({ YTDLP_COOKIES_FILE: undefined, YTDLP_COOKIES_FROM_BROWSER: undefined }, () => {
    assert.deepEqual(radar.buildAuthArgs(), []);
  });
});

test('normalizeEntry maps real yt-dlp fields', () => {
  const post = radar.normalizeEntry(
    {
      id: 'abc',
      title: 'Massive drop\nsecond line',
      view_count: 250000,
      like_count: 9000,
      duration: 28,
      upload_date: '20260801',
      webpage_url: 'https://example.com/abc',
    },
    { handle: 'shibass', platform: 'youtube' },
    'https://example.com',
  );

  assert.equal(post.id, 'shibass_abc');
  assert.equal(post.views, 250000);
  assert.equal(post.hookText, 'Massive drop', 'only the first line becomes the hook');
  assert.equal(post.likeCount, 9000);
  assert.equal(post.style, 'Short / Vertical');
  assert.equal(post.url, 'https://example.com/abc');
  assert.equal(post.source, 'live');
});

test('normalizeEntry labels long form content', () => {
  const post = radar.normalizeEntry({ id: 'x', duration: 600 }, { handle: 'h' }, 'u');
  assert.equal(post.style, 'Long form');
});

test('checkHealth reports a missing yt-dlp with install guidance', async () => {
  await withEnv({ YTDLP_PATH: NO_TOOL }, async () => {
    const health = await radar.checkHealth();
    assert.equal(health.ok, false);
    assert.match(health.error, /pip install -U yt-dlp/);
  });
});

test('scanArtist returns an error instead of throwing when the tool is missing', async () => {
  await withEnv({ YTDLP_PATH: NO_TOOL }, async () => {
    const result = await radar.scanArtist({ handle: 'someone', platform: 'instagram' });
    assert.equal(result.posts, null);
    assert.ok(result.error);
  });
});

test('scanArtist refuses an entry with no handle or url', async () => {
  const result = await radar.scanArtist({ name: 'nameless' });
  assert.equal(result.posts, null);
  assert.match(result.error, /No handle or url/);
});

test('scanWatchlist fabricates nothing when no live source is reachable', async () => {
  await withEnv({ YTDLP_PATH: NO_TOOL, RADAR_ALLOW_SAMPLE: undefined }, async () => {
    const result = await radar.scanWatchlist();

    assert.equal(result.source, 'none');
    assert.deepEqual(result.items, [], 'no invented posts');
    assert.deepEqual(result.viral, []);
    assert.ok(result.warning, 'the failure is surfaced to the UI');
    assert.ok(result.errors.length > 0);
    assert.equal(result.tool.ok, false);
    assert.ok(fs.existsSync(RADAR_DB));
  });
});

test('scanWatchlist only serves sample data when explicitly opted in, and labels it', async () => {
  await withEnv({ YTDLP_PATH: NO_TOOL, RADAR_ALLOW_SAMPLE: '1' }, async () => {
    const result = await radar.scanWatchlist();

    assert.equal(result.source, 'sample');
    assert.ok(result.items.length > 0);
    assert.ok(result.items.every((item) => item.source === 'sample'), 'each item is marked');
    assert.match(result.warning, /דוגמה/);
  });
});

test('sampleAllowed is opt-in', async () => {
  await withEnv({ RADAR_ALLOW_SAMPLE: undefined }, () => {
    assert.equal(radar.sampleAllowed(), false);
  });
  await withEnv({ RADAR_ALLOW_SAMPLE: '1' }, () => {
    assert.equal(radar.sampleAllowed(), true);
  });
});

test('getTemplateById reads back from the persisted feed', async () => {
  await withEnv({ YTDLP_PATH: NO_TOOL, RADAR_ALLOW_SAMPLE: '1' }, async () => {
    const scan = await radar.scanWatchlist();
    const first = scan.items[0];
    const found = await radar.getTemplateById(first.id);
    assert.equal(found.id, first.id);
    assert.equal(await radar.getTemplateById('no-such-id'), null);
  });
});
