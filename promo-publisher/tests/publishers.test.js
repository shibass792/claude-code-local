'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const meta = require('../modules/publishers/meta');
const tiktok = require('../modules/publishers/tiktok');

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

const NO_META = {
  META_ACCESS_TOKEN: undefined,
  META_PAGE_ID: undefined,
  META_IG_USER_ID: undefined,
};

const NO_TIKTOK = {
  TIKTOK_ACCESS_TOKEN: undefined,
  TIKTOK_CLIENT_KEY: undefined,
};

test('meta isConfigured requires all three values', async () => {
  await withEnv(NO_META, () => assert.equal(meta.isConfigured(), false));
  await withEnv({ ...NO_META, META_ACCESS_TOKEN: 't' }, () =>
    assert.equal(meta.isConfigured(), false),
  );
  await withEnv({ META_ACCESS_TOKEN: 't', META_PAGE_ID: 'p', META_IG_USER_ID: 'i' }, () =>
    assert.equal(meta.isConfigured(), true),
  );
});

test('describeGraphError surfaces the Graph error body, not just the status', () => {
  const message = meta.describeGraphError({
    message: 'Request failed with status code 400',
    response: {
      data: {
        error: {
          message: 'Invalid parameter',
          error_user_msg: 'The video is too long',
          code: 100,
          error_subcode: 2207026,
        },
      },
    },
  });

  assert.match(message, /Invalid parameter/);
  assert.match(message, /The video is too long/);
  assert.match(message, /code=100/);
  assert.match(message, /subcode=2207026/);
});

test('describeGraphError falls back to the transport message', () => {
  assert.equal(meta.describeGraphError({ message: 'socket hang up' }), 'socket hang up');
});

test('missing Meta credentials fail without claiming success', async () => {
  await withEnv(NO_META, async () => {
    const ig = await meta.publishInstagramReel({ videoUrl: 'https://x/y.mp4', caption: 'c' });
    assert.equal(ig.success, false);
    assert.equal(ig.platform, 'instagram');
    assert.match(ig.error, /META credentials missing/);
    assert.ok(!('mock' in ig), 'no mock flag that could be read as success');

    const fb = await meta.publishFacebookVideo({ videoUrl: 'https://x/y.mp4', caption: 'c' });
    assert.equal(fb.success, false);

    const verified = await meta.verifyCredentials();
    assert.equal(verified.ok, false);
  });
});

test('graph base pins an explicit API version', () => {
  assert.match(meta.GRAPH_BASE, /graph\.facebook\.com\/v\d+\.\d+$/);
});

test('tiktok isConfigured requires token and client key', async () => {
  await withEnv(NO_TIKTOK, () => assert.equal(tiktok.isConfigured(), false));
  await withEnv({ TIKTOK_ACCESS_TOKEN: 'a', TIKTOK_CLIENT_KEY: 'k' }, () =>
    assert.equal(tiktok.isConfigured(), true),
  );
});

test('resolvePrivacyLevel never picks an option the account lacks', () => {
  assert.equal(
    tiktok.resolvePrivacyLevel(['PUBLIC_TO_EVERYONE', 'SELF_ONLY'], 'direct'),
    'PUBLIC_TO_EVERYONE',
  );
  assert.equal(
    tiktok.resolvePrivacyLevel(['SELF_ONLY'], 'direct'),
    'SELF_ONLY',
    'unaudited apps only get SELF_ONLY',
  );
  assert.equal(tiktok.resolvePrivacyLevel(['SELF_ONLY'], 'draft'), 'SELF_ONLY');
  assert.equal(tiktok.resolvePrivacyLevel([], 'direct'), 'SELF_ONLY');
  assert.equal(tiktok.resolvePrivacyLevel(undefined, 'draft'), 'SELF_ONLY');
});

test('assertOk treats an in-body error code as a failure', () => {
  assert.doesNotThrow(() => tiktok.assertOk({ error: { code: 'ok' } }));
  assert.doesNotThrow(() => tiktok.assertOk({ data: {} }));
  assert.throws(
    () => tiktok.assertOk({ error: { code: 'invalid_params', message: 'bad url', log_id: '42' } }),
    /invalid_params.*bad url.*log_id=42/s,
  );
});

test('missing TikTok credentials fail without claiming success', async () => {
  await withEnv(NO_TIKTOK, async () => {
    const result = await tiktok.publishTikTokVideo({ videoUrl: 'https://x/y.mp4', caption: 'c' });
    assert.equal(result.success, false);
    assert.match(result.error, /TikTok credentials missing/);

    const verified = await tiktok.verifyCredentials();
    assert.equal(verified.ok, false);
  });
});
