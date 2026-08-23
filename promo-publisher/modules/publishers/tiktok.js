'use strict';

/**
 * TikTok Content Posting API publisher.
 *
 * Correctness notes over the previous version:
 *  - Draft and direct posts use *different* endpoints. Drafts go to
 *    /v2/post/publish/inbox/video/init/ (no privacy_level); only direct posts
 *    use /v2/post/publish/video/init/ with post_info.
 *  - privacy_level must be one of the values creator_info actually returns.
 *    Unaudited apps only get SELF_ONLY, so we validate instead of guessing.
 *  - The publish is asynchronous: we poll status/fetch for the real outcome.
 */

const axios = require('axios');

const API_BASE = process.env.TIKTOK_API_BASE ?? 'https://open.tiktokapis.com/v2';

const POLL_INTERVAL_MS = Number(process.env.TIKTOK_POLL_INTERVAL_MS ?? 4000);
const POLL_TIMEOUT_MS = Number(process.env.TIKTOK_POLL_TIMEOUT_MS ?? 300000);

function getTikTokConfig() {
  return {
    accessToken: process.env.TIKTOK_ACCESS_TOKEN ?? '',
    clientKey: process.env.TIKTOK_CLIENT_KEY ?? '',
    publishMode: process.env.TIKTOK_PUBLISH_MODE ?? 'draft',
  };
}

function isConfigured() {
  const cfg = getTikTokConfig();
  return Boolean(cfg.accessToken && cfg.clientKey);
}

function authHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json; charset=UTF-8',
  };
}

/**
 * TikTok reports failures inside body.error even on HTTP 200.
 */
function describeTikTokError(error) {
  const apiError = error.response?.data?.error;
  if (apiError && apiError.code && apiError.code !== 'ok') {
    return [apiError.code, apiError.message, apiError.log_id ? `log_id=${apiError.log_id}` : null]
      .filter(Boolean)
      .join(' | ');
  }
  return error.message;
}

function assertOk(data) {
  const err = data?.error;
  if (err && err.code && err.code !== 'ok') {
    throw new Error(
      [err.code, err.message, err.log_id ? `log_id=${err.log_id}` : null].filter(Boolean).join(' | '),
    );
  }
  return data;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Query creator info — also the cheapest real token check.
 */
async function queryCreatorInfo() {
  const cfg = getTikTokConfig();
  const { data } = await axios.post(
    `${API_BASE}/post/publish/creator_info/query/`,
    {},
    { headers: authHeaders(cfg.accessToken), timeout: 20000 },
  );
  assertOk(data);
  return data.data ?? {};
}

async function verifyCredentials() {
  if (!isConfigured()) {
    return {
      ok: false,
      error: 'TikTok credentials missing — set TIKTOK_ACCESS_TOKEN and TIKTOK_CLIENT_KEY',
    };
  }

  try {
    const info = await queryCreatorInfo();
    return {
      ok: true,
      nickname: info.creator_nickname ?? null,
      username: info.creator_username ?? null,
      privacyOptions: info.privacy_level_options ?? [],
      maxDurationSec: info.max_video_post_duration_sec ?? null,
    };
  } catch (error) {
    return { ok: false, error: describeTikTokError(error) };
  }
}

/**
 * Pick a privacy level the account is actually allowed to use.
 */
function resolvePrivacyLevel(options, publishMode) {
  const available = Array.isArray(options) ? options : [];
  const preferred =
    publishMode === 'direct' ? 'PUBLIC_TO_EVERYONE' : 'SELF_ONLY';

  if (available.includes(preferred)) {
    return preferred;
  }
  if (available.includes('SELF_ONLY')) {
    return 'SELF_ONLY';
  }
  return available[0] ?? 'SELF_ONLY';
}

async function fetchPublishStatus(publishId) {
  const cfg = getTikTokConfig();
  const { data } = await axios.post(
    `${API_BASE}/post/publish/status/fetch/`,
    { publish_id: publishId },
    { headers: authHeaders(cfg.accessToken), timeout: 20000 },
  );
  assertOk(data);
  return data.data ?? {};
}

/**
 * Poll until TikTok finishes (or fails) the upload.
 */
async function waitForPublish(publishId, { onProgress } = {}) {
  const startedAt = Date.now();

  for (;;) {
    const status = await fetchPublishStatus(publishId);
    onProgress?.({ status: status.status, elapsedMs: Date.now() - startedAt });

    if (status.status === 'PUBLISH_COMPLETE' || status.status === 'SEND_TO_USER_INBOX') {
      return status;
    }
    if (status.status === 'FAILED') {
      throw new Error(`TikTok publish FAILED: ${status.fail_reason ?? 'no reason given'}`);
    }
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      return { ...status, timedOut: true };
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

async function publishTikTokVideo({ videoUrl, caption, onProgress }) {
  const cfg = getTikTokConfig();
  if (!isConfigured()) {
    return {
      platform: 'tiktok',
      success: false,
      error: 'TikTok credentials missing — set TIKTOK_ACCESS_TOKEN and TIKTOK_CLIENT_KEY',
    };
  }

  const isDirect = cfg.publishMode === 'direct';

  try {
    onProgress?.({ stage: 'creator-info' });
    const creatorInfo = await queryCreatorInfo();

    const sourceInfo = { source: 'PULL_FROM_URL', video_url: videoUrl };

    // Drafts land in the user's TikTok inbox and use a different endpoint.
    const endpoint = isDirect
      ? `${API_BASE}/post/publish/video/init/`
      : `${API_BASE}/post/publish/inbox/video/init/`;

    const body = isDirect
      ? {
          post_info: {
            title: String(caption ?? '').slice(0, 2200),
            privacy_level: resolvePrivacyLevel(creatorInfo.privacy_level_options, cfg.publishMode),
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
          },
          source_info: sourceInfo,
        }
      : { source_info: sourceInfo };

    onProgress?.({ stage: 'init', mode: cfg.publishMode });
    const { data } = await axios.post(endpoint, body, {
      headers: authHeaders(cfg.accessToken),
      timeout: 60000,
    });
    assertOk(data);

    const publishId = data.data?.publish_id;
    if (!publishId) {
      throw new Error('TikTok did not return a publish_id');
    }

    onProgress?.({ stage: 'processing', publishId });
    const status = await waitForPublish(publishId, { onProgress });

    const postId = status.publicaly_available_post_id?.[0] ?? null;
    const username = creatorInfo.creator_username;

    return {
      platform: 'tiktok',
      success: !status.timedOut,
      mode: cfg.publishMode,
      publishId,
      status: status.status ?? null,
      id: postId,
      url:
        postId && username
          ? `https://www.tiktok.com/@${username}/video/${postId}`
          : null,
      ...(status.timedOut
        ? { error: `Still ${status.status} after ${Math.round(POLL_TIMEOUT_MS / 1000)}s` }
        : {}),
      ...(isDirect ? {} : { note: 'Uploaded to TikTok drafts — finish the post in the app' }),
    };
  } catch (error) {
    return {
      platform: 'tiktok',
      success: false,
      mode: cfg.publishMode,
      error: describeTikTokError(error),
    };
  }
}

module.exports = {
  API_BASE,
  getTikTokConfig,
  isConfigured,
  describeTikTokError,
  assertOk,
  queryCreatorInfo,
  verifyCredentials,
  resolvePrivacyLevel,
  fetchPublishStatus,
  waitForPublish,
  publishTikTokVideo,
};
