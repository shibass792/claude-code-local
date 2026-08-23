'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const approval = require('../modules/approval-publisher');
const { PENDING_DB, PUBLISH_RESULTS, writeJson } = require('../modules/store');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'shibass-approval-'));

function ffmpegAvailable() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAS_FFMPEG = ffmpegAvailable();

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

function startOllamaStub() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });

      if (req.url === '/api/tags') {
        res.end(JSON.stringify({ models: [{ name: 'stub-model' }] }));
        return;
      }

      const prompt = JSON.parse(body).messages.at(-1).content;
      const payload = prompt.includes('caption package')
        ? { captionHe: 'כיתוב אמיתי', captionEn: 'Real caption', hashtags: '#psytrance #bass' }
        : { hooks: [{ he: 'הוק מהמודל', en: 'Model hook', why: 'curiosity' }] };

      res.end(JSON.stringify({ message: { content: JSON.stringify(payload) } }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

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

test('buildCaption drops empty sections', () => {
  assert.equal(approval.buildCaption({ captionHe: 'only', captionEn: '  ' }), 'only');
  assert.equal(approval.buildCaption({}), '');
});

test('the pending queue starts empty instead of seeding a demo campaign', () => {
  if (fs.existsSync(PENDING_DB)) {
    fs.unlinkSync(PENDING_DB);
  }
  assert.deepEqual(approval.getPendingQueue(), []);
  assert.equal(fs.existsSync(PENDING_DB), false, 'reading must not write fake data');
});

test('upsertCampaign adds then updates in place', () => {
  writeJson(PENDING_DB, []);
  approval.upsertCampaign({ id: 'c1', title: 'First' });
  approval.upsertCampaign({ id: 'c2', title: 'Second' });
  assert.equal(approval.getPendingQueue().length, 2);

  approval.upsertCampaign({ id: 'c1', title: 'First (edited)' });
  const queue = approval.getPendingQueue();
  assert.equal(queue.length, 2);
  assert.equal(queue.find((item) => item.id === 'c1').title, 'First (edited)');
});

test('rejectCampaign removes item from queue', () => {
  writeJson(PENDING_DB, [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]);
  const res = approval.rejectCampaign('a');
  assert.equal(res.success, true);
  const queue = approval.getPendingQueue();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].id, 'b');
});

test('markWatched flips the gate flag', () => {
  writeJson(PENDING_DB, [{ id: 'w1', title: 'W', watched: false }]);
  const updated = approval.markWatched('w1');
  assert.equal(updated.watched, true);
  assert.equal(approval.getPendingQueue()[0].watched, true);
});

test('publishCampaign requires the watch gate', async () => {
  const result = await approval.publishCampaign({
    id: 'test_unwatched',
    title: 'Test',
    watched: false,
    platforms: ['instagram'],
  });
  assert.equal(result.success, false);
  assert.match(result.error, /צפות/);
});

test('publishCampaign requires at least one platform', async () => {
  const result = await approval.publishCampaign({
    id: 'test_no_platform',
    watched: true,
    platforms: [],
  });
  assert.equal(result.success, false);
  assert.match(result.error, /פלטפורמה/);
});

test('publishCampaign requires an id', async () => {
  await assert.rejects(() => approval.publishCampaign({ watched: true }), /Campaign id/);
});

test('a missing video file fails instead of reporting a mock success', async () => {
  await withEnv({ PUBLISH_DRY_RUN: undefined }, async () => {
    const result = await approval.publishCampaign({
      id: 'test_missing_video',
      title: 'No video',
      watched: true,
      platforms: ['instagram'],
      videoPath: 'output/renders/does-not-exist.mp4',
    });

    assert.equal(result.success, false, 'this used to return success:true with mock urls');
    assert.match(result.error, /לא נמצא/);
    assert.equal(result.urls, undefined, 'no fabricated permalinks');
  });
});

test('dry run is explicit, labelled, and keeps the campaign in the queue', async () => {
  writeJson(PENDING_DB, [{ id: 'dry1', title: 'Dry', watched: true, platforms: ['instagram'] }]);
  writeJson(PUBLISH_RESULTS, []);

  await withEnv({ PUBLISH_DRY_RUN: '1' }, async () => {
    const result = await approval.publishCampaign({
      id: 'dry1',
      title: 'Dry',
      watched: true,
      platforms: ['instagram', 'tiktok'],
    });

    assert.equal(result.success, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.results.length, 2);
    assert.ok(result.results.every((entry) => entry.dryRun === true));
    assert.deepEqual(result.urls, {}, 'a dry run invents no links');

    assert.equal(approval.getPendingQueue().length, 1, 'nothing was really published');

    const history = approval.getPublishHistory();
    assert.equal(history[0].dryRun, true);
  });
});

test('collectUrls only reports links the API actually returned', () => {
  const urls = approval.collectUrls([
    { platform: 'instagram', success: true, url: 'https://instagram.com/reel/REAL' },
    { platform: 'tiktok', success: true, url: null },
    { platform: 'facebook', success: false, error: 'nope' },
  ]);
  assert.deepEqual(urls, { instagram: 'https://instagram.com/reel/REAL' });
});

test('getConnectionHealth probes every real integration', async () => {
  const health = await approval.getConnectionHealth();

  for (const key of ['ai', 'renderer', 'radar', 'library', 'meta', 'tiktok', 'tunnel']) {
    assert.ok(health[key], `missing health entry: ${key}`);
    assert.ok(health[key].label, `missing label: ${key}`);
  }

  assert.equal(typeof health.ai.ok, 'boolean');
  assert.equal(typeof health.renderer.ok, 'boolean');
  assert.equal(typeof health.dryRun, 'boolean');
  assert.ok(health.meta.apiVersion, 'the pinned Graph version is reported');
});

test('createCampaignFromAudio renders a real video and writes real AI captions', async (t) => {
  if (!HAS_FFMPEG) return t.skip('ffmpeg not installed');

  const audio = path.join(TMP, 'campaign.mp3');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=150:duration=4',
    '-metadata', 'title=Dextamine',
    '-metadata', 'BPM=143',
    audio,
  ]);

  writeJson(PENDING_DB, []);
  const stub = await startOllamaStub();

  try {
    await withEnv({ OLLAMA_HOST: stub.url, AI_BASE_URL: undefined }, async () => {
      const stages = [];
      const { campaign, render, aiError } = await approval.createCampaignFromAudio({
        audioPath: audio,
        durationSec: 3,
        style: 'bars',
        onProgress: (p) => stages.push(p.stage),
      });

      assert.equal(aiError, null, 'no AI error when the model answers');
      assert.equal(render.width, 1080);
      assert.equal(render.height, 1920);
      assert.ok(fs.existsSync(render.outputPath), 'a real mp4 exists on disk');

      assert.equal(campaign.captionHe, 'כיתוב אמיתי');
      assert.equal(campaign.captionEn, 'Real caption');
      assert.equal(campaign.hashtags, '#psytrance #bass');
      assert.equal(campaign.hookOptions[0].he, 'הוק מהמודל');
      assert.equal(campaign.ai.model, 'stub-model');
      assert.equal(campaign.source.bpm, 143);
      assert.match(campaign.format, /1080x1920/);

      assert.ok(stages.includes('probe'));
      assert.ok(stages.includes('hooks'));
      assert.ok(stages.includes('render'));

      const queue = approval.getPendingQueue();
      assert.equal(queue[0].id, campaign.id, 'the campaign is queued for approval');
      assert.equal(queue[0].watched, false, 'the watch gate starts closed');
    });
  } finally {
    await stub.close();
  }
});

test('createCampaignFromAudio still renders when the model is offline', async (t) => {
  if (!HAS_FFMPEG) return t.skip('ffmpeg not installed');

  const audio = path.join(TMP, 'no-ai.wav');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=150:duration=3', audio,
  ]);

  writeJson(PENDING_DB, []);

  await withEnv({ OLLAMA_HOST: 'http://127.0.0.1:1', AI_BASE_URL: undefined }, async () => {
    const { campaign, render, aiError } = await approval.createCampaignFromAudio({
      audioPath: audio,
      durationSec: 2,
    });

    assert.ok(aiError, 'the AI failure is reported, not hidden');
    assert.match(aiError, /Cannot reach AI engine/);
    assert.ok(fs.existsSync(render.outputPath), 'the video is still rendered');
    assert.equal(campaign.captionHe, '', 'no invented caption text');
    assert.equal(campaign.aiError, aiError);
  });
});

test('createCampaignFromAudio rejects a missing file', async () => {
  await assert.rejects(
    () => approval.createCampaignFromAudio({ audioPath: '/nope/missing.wav' }),
    /not found/,
  );
});

test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});
