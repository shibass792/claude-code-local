const axios = require('axios');
const { appendLog } = require('../creation-log');
const metaPublisher = require('../publishers/meta');

const GRAPH = 'https://graph.facebook.com/v21.0';

function getMetaConfig() {
  return metaPublisher.getMetaConfig();
}

function isConfigured() {
  return metaPublisher.isConfigured();
}

async function probeInstagram() {
  const cfg = getMetaConfig();
  if (!isConfigured()) {
    return {
      configured: false,
      live: false,
      engine: 'meta-graph',
      error: 'META_ACCESS_TOKEN, META_PAGE_ID, and META_IG_USER_ID are required',
    };
  }

  try {
    const [meRes, igRes] = await Promise.all([
      axios.get(`${GRAPH}/me`, {
        params: { fields: 'id,name', access_token: cfg.accessToken },
        timeout: 8000,
      }),
      axios.get(`${GRAPH}/${cfg.igUserId}`, {
        params: { fields: 'id,username,name', access_token: cfg.accessToken },
        timeout: 8000,
      }),
    ]);

    appendLog('success', 'instagram', `Graph API live as ${igRes.data.username ?? meRes.data.name}`);

    return {
      configured: true,
      live: true,
      engine: 'meta-graph',
      pageId: cfg.pageId,
      igUserId: cfg.igUserId,
      username: igRes.data.username ?? null,
      accountName: meRes.data.name ?? null,
    };
  } catch (error) {
    const message = error.response?.data?.error?.message ?? error.message;
    appendLog('error', 'instagram', `Graph probe failed: ${message}`);
    return {
      configured: true,
      live: false,
      engine: 'meta-graph',
      error: message,
    };
  }
}

async function waitForReelReady(creationId, accessToken, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await axios.get(`${GRAPH}/${creationId}`, {
      params: { fields: 'status_code', access_token: accessToken },
      timeout: 8000,
    });
    const status = res.data?.status_code;
    if (status === 'FINISHED') {
      return status;
    }
    if (status === 'ERROR') {
      throw new Error('Instagram finished processing the reel with ERROR');
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error('Timed out waiting for Instagram reel processing');
}

async function publishInstagramReel({ videoUrl, caption }) {
  const cfg = getMetaConfig();
  if (!isConfigured()) {
    appendLog('error', 'instagram', 'Publish blocked — Graph credentials missing');
    return {
      platform: 'instagram',
      success: false,
      mock: false,
      live: false,
      error: 'META credentials missing — set META_ACCESS_TOKEN, META_PAGE_ID, META_IG_USER_ID',
    };
  }

  if (!videoUrl || videoUrl.startsWith('http://127.0.0.1') || videoUrl.startsWith('http://localhost')) {
    appendLog('error', 'instagram', 'Graph Reels require a public HTTPS video URL');
    return {
      platform: 'instagram',
      success: false,
      mock: false,
      live: false,
      error: 'Instagram Graph Reels need a public HTTPS URL (Cloudflare Tunnel)',
    };
  }

  appendLog('info', 'instagram', 'Creating Reel container via Graph API');

  try {
    const createRes = await axios.post(`${GRAPH}/${cfg.igUserId}/media`, null, {
      params: {
        media_type: 'REELS',
        video_url: videoUrl,
        caption,
        access_token: cfg.accessToken,
      },
      timeout: 30000,
    });

    const creationId = createRes.data.id;
    appendLog('info', 'instagram', `Container ${creationId} — waiting for FINISHED`);
    await waitForReelReady(creationId, cfg.accessToken);

    const publishRes = await axios.post(`${GRAPH}/${cfg.igUserId}/media_publish`, null, {
      params: {
        creation_id: creationId,
        access_token: cfg.accessToken,
      },
      timeout: 30000,
    });

    appendLog('success', 'instagram', `Published Reel ${publishRes.data.id}`);
    return {
      platform: 'instagram',
      success: true,
      mock: false,
      live: true,
      id: publishRes.data.id,
      creationId,
    };
  } catch (error) {
    const message = error.response?.data?.error?.message ?? error.message;
    appendLog('error', 'instagram', `Publish failed: ${message}`);
    return {
      platform: 'instagram',
      success: false,
      mock: false,
      live: false,
      error: message,
    };
  }
}

module.exports = {
  getMetaConfig,
  isConfigured,
  probeInstagram,
  waitForReelReady,
  publishInstagramReel,
  publishFacebookVideo: metaPublisher.publishFacebookVideo,
};
