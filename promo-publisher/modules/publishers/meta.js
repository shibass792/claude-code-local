'use strict';

/**
 * Meta Graph API publisher (Instagram Reels + Facebook Page video).
 *
 * Two correctness notes over the previous version:
 *  - Instagram media containers are asynchronous. Publishing straight after
 *    /media returns "Media ID is not available" for any real video, so we poll
 *    the container's status_code until FINISHED.
 *  - Real permalinks are fetched from the API instead of being fabricated.
 */

const axios = require('axios');

const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const CONTAINER_POLL_INTERVAL_MS = Number(process.env.META_POLL_INTERVAL_MS ?? 4000);
const CONTAINER_POLL_TIMEOUT_MS = Number(process.env.META_POLL_TIMEOUT_MS ?? 300000);

function getMetaConfig() {
  return {
    accessToken: process.env.META_ACCESS_TOKEN ?? '',
    pageId: process.env.META_PAGE_ID ?? '',
    igUserId: process.env.META_IG_USER_ID ?? '',
  };
}

function isConfigured() {
  const cfg = getMetaConfig();
  return Boolean(cfg.accessToken && cfg.pageId && cfg.igUserId);
}

/**
 * Graph errors carry the useful detail in the JSON body, not the HTTP status.
 */
function describeGraphError(error) {
  const apiError = error.response?.data?.error;
  if (apiError) {
    const parts = [
      apiError.message,
      apiError.error_user_title,
      apiError.error_user_msg,
      apiError.code ? `code=${apiError.code}` : null,
      apiError.error_subcode ? `subcode=${apiError.error_subcode}` : null,
    ].filter(Boolean);
    return parts.join(' | ');
  }
  return error.message;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for an IG container to finish transcoding.
 */
async function waitForContainer(creationId, accessToken, { onProgress } = {}) {
  const startedAt = Date.now();

  for (;;) {
    const { data } = await axios.get(`${GRAPH_BASE}/${creationId}`, {
      params: { fields: 'status_code,status', access_token: accessToken },
    });

    const status = data.status_code;
    onProgress?.({ status, elapsedMs: Date.now() - startedAt });

    if (status === 'FINISHED') {
      return true;
    }
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new Error(`Instagram container ${status}: ${data.status ?? 'no detail'}`);
    }
    if (Date.now() - startedAt > CONTAINER_POLL_TIMEOUT_MS) {
      throw new Error(
        `Instagram container still ${status} after ${Math.round(
          CONTAINER_POLL_TIMEOUT_MS / 1000,
        )}s`,
      );
    }

    await sleep(CONTAINER_POLL_INTERVAL_MS);
  }
}

async function fetchPermalink(mediaId, accessToken, field = 'permalink') {
  try {
    const { data } = await axios.get(`${GRAPH_BASE}/${mediaId}`, {
      params: { fields: field, access_token: accessToken },
    });
    return data[field] ?? null;
  } catch {
    // A missing permalink must not fail an otherwise successful publish.
    return null;
  }
}

/**
 * Verify the token really works — used by the connections health panel.
 */
async function verifyCredentials() {
  const cfg = getMetaConfig();
  if (!isConfigured()) {
    return {
      ok: false,
      error: 'META credentials missing — set META_ACCESS_TOKEN, META_PAGE_ID, META_IG_USER_ID',
    };
  }

  try {
    const { data } = await axios.get(`${GRAPH_BASE}/${cfg.igUserId}`, {
      params: { fields: 'username,followers_count', access_token: cfg.accessToken },
      timeout: 15000,
    });
    return {
      ok: true,
      igUsername: data.username ?? null,
      followers: data.followers_count ?? null,
    };
  } catch (error) {
    return { ok: false, error: describeGraphError(error) };
  }
}

async function publishInstagramReel({ videoUrl, caption, shareToFeed = true, onProgress }) {
  const cfg = getMetaConfig();
  if (!isConfigured()) {
    return {
      platform: 'instagram',
      success: false,
      error: 'META credentials missing — set META_ACCESS_TOKEN, META_PAGE_ID, META_IG_USER_ID',
    };
  }

  try {
    onProgress?.({ stage: 'create-container' });
    const createRes = await axios.post(`${GRAPH_BASE}/${cfg.igUserId}/media`, null, {
      params: {
        media_type: 'REELS',
        video_url: videoUrl,
        caption,
        share_to_feed: shareToFeed,
        access_token: cfg.accessToken,
      },
    });

    const creationId = createRes.data.id;
    if (!creationId) {
      throw new Error('Graph API did not return a creation id');
    }

    onProgress?.({ stage: 'processing', creationId });
    await waitForContainer(creationId, cfg.accessToken, { onProgress });

    onProgress?.({ stage: 'publish', creationId });
    const publishRes = await axios.post(`${GRAPH_BASE}/${cfg.igUserId}/media_publish`, null, {
      params: { creation_id: creationId, access_token: cfg.accessToken },
    });

    const mediaId = publishRes.data.id;
    const permalink = await fetchPermalink(mediaId, cfg.accessToken, 'permalink');

    return {
      platform: 'instagram',
      success: true,
      id: mediaId,
      creationId,
      url: permalink,
    };
  } catch (error) {
    return {
      platform: 'instagram',
      success: false,
      error: describeGraphError(error),
    };
  }
}

async function publishFacebookVideo({ videoUrl, caption, onProgress }) {
  const cfg = getMetaConfig();
  if (!cfg.accessToken || !cfg.pageId) {
    return {
      platform: 'facebook',
      success: false,
      error: 'META credentials missing — set META_ACCESS_TOKEN and META_PAGE_ID',
    };
  }

  try {
    onProgress?.({ stage: 'upload' });
    const res = await axios.post(`${GRAPH_BASE}/${cfg.pageId}/videos`, null, {
      params: {
        file_url: videoUrl,
        description: caption,
        access_token: cfg.accessToken,
      },
    });

    const videoId = res.data.id;
    const permalink = await fetchPermalink(videoId, cfg.accessToken, 'permalink_url');

    return {
      platform: 'facebook',
      success: true,
      id: videoId,
      url: permalink ? `https://www.facebook.com${permalink}` : null,
    };
  } catch (error) {
    return {
      platform: 'facebook',
      success: false,
      error: describeGraphError(error),
    };
  }
}

module.exports = {
  GRAPH_VERSION,
  GRAPH_BASE,
  getMetaConfig,
  isConfigured,
  describeGraphError,
  waitForContainer,
  fetchPermalink,
  verifyCredentials,
  publishInstagramReel,
  publishFacebookVideo,
};
