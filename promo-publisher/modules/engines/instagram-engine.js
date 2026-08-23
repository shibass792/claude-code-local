const axios = require('axios');
const { appendLog } = require('./creation-log');

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function getConfig() {
  return {
    accessToken: process.env.META_ACCESS_TOKEN ?? '',
    pageId: process.env.META_PAGE_ID ?? '',
    igUserId: process.env.META_IG_USER_ID ?? '',
  };
}

function isConfigured() {
  const cfg = getConfig();
  return Boolean(cfg.accessToken && cfg.igUserId);
}

/**
 * Official Instagram Graph API only.
 * Unofficial InstaPy / Selenium like-follow-comment bots are not implemented.
 */
async function getStatus() {
  const cfg = getConfig();
  if (!isConfigured()) {
    const result = {
      ok: false,
      configured: false,
      engine: 'instagram-graph',
      instapy: { supported: false, reason: 'InstaPy/Selenium automation is not used' },
      error: 'META_ACCESS_TOKEN and META_IG_USER_ID are required',
    };
    appendLog({
      engine: 'instagram',
      event: 'status',
      level: 'warn',
      message: result.error,
      data: result,
    });
    return result;
  }

  try {
    const res = await axios.get(`${GRAPH_BASE}/${cfg.igUserId}`, {
      params: {
        fields: 'id,username,name,account_type',
        access_token: cfg.accessToken,
      },
      timeout: 12000,
    });

    const result = {
      ok: true,
      configured: true,
      engine: 'instagram-graph',
      httpStatus: res.status,
      account: {
        id: res.data.id,
        username: res.data.username ?? null,
        name: res.data.name ?? null,
        accountType: res.data.account_type ?? null,
      },
      instapy: { supported: false, reason: 'Official Graph API only' },
    };
    appendLog({
      engine: 'instagram',
      event: 'status',
      message: `Graph ${res.status} OK — @${result.account.username ?? result.account.id}`,
      data: { httpStatus: res.status, username: result.account.username },
    });
    return result;
  } catch (error) {
    const httpStatus = error.response?.status ?? 0;
    const graphError = error.response?.data?.error?.message ?? error.message;
    const result = {
      ok: false,
      configured: true,
      engine: 'instagram-graph',
      httpStatus,
      error: graphError,
      instapy: { supported: false, reason: 'Official Graph API only' },
    };
    appendLog({
      engine: 'instagram',
      event: 'status',
      level: 'error',
      message: `Graph ${httpStatus || 'ERR'} — ${graphError}`,
      data: { httpStatus, error: graphError },
    });
    return result;
  }
}

async function publishReel({ videoUrl, caption }) {
  const cfg = getConfig();
  if (!isConfigured()) {
    const result = {
      platform: 'instagram',
      success: false,
      mock: false,
      error: 'META_ACCESS_TOKEN and META_IG_USER_ID are required',
    };
    appendLog({
      engine: 'instagram',
      event: 'publish',
      level: 'error',
      message: result.error,
    });
    return result;
  }

  if (!videoUrl) {
    const result = {
      platform: 'instagram',
      success: false,
      mock: false,
      error: 'videoUrl is required for Graph Reels publish',
    };
    appendLog({
      engine: 'instagram',
      event: 'publish',
      level: 'error',
      message: result.error,
    });
    return result;
  }

  try {
    const createRes = await axios.post(`${GRAPH_BASE}/${cfg.igUserId}/media`, null, {
      params: {
        media_type: 'REELS',
        video_url: videoUrl,
        caption: caption ?? '',
        access_token: cfg.accessToken,
      },
      timeout: 30000,
    });

    const creationId = createRes.data.id;
    const publishRes = await axios.post(`${GRAPH_BASE}/${cfg.igUserId}/media_publish`, null, {
      params: {
        creation_id: creationId,
        access_token: cfg.accessToken,
      },
      timeout: 30000,
    });

    const result = {
      platform: 'instagram',
      success: true,
      mock: false,
      id: publishRes.data.id,
      creationId,
    };
    appendLog({
      engine: 'instagram',
      event: 'publish',
      message: `Published Reel ${result.id}`,
      data: result,
    });
    return result;
  } catch (error) {
    const graphError = error.response?.data?.error?.message ?? error.message;
    const result = {
      platform: 'instagram',
      success: false,
      mock: false,
      httpStatus: error.response?.status ?? 0,
      error: graphError,
    };
    appendLog({
      engine: 'instagram',
      event: 'publish',
      level: 'error',
      message: graphError,
      data: result,
    });
    return result;
  }
}

module.exports = {
  GRAPH_VERSION,
  getConfig,
  isConfigured,
  getStatus,
  publishReel,
};
