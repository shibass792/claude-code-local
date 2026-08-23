const metaPublisher = require('./publishers/meta');

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function getConfig() {
  return metaPublisher.getMetaConfig();
}

function isConfigured() {
  return metaPublisher.isConfigured();
}

async function probeGraphApi() {
  const cfg = getConfig();
  if (!cfg.accessToken) {
    return {
      configured: false,
      live: false,
      mock: false,
      status: null,
      label: 'Instagram Graph API (official Reels publish)',
      error: 'META_ACCESS_TOKEN is not set — no live Instagram call was made',
    };
  }

  const url = new URL(`${GRAPH_BASE}/me`);
  url.searchParams.set('fields', 'id,name');
  url.searchParams.set('access_token', cfg.accessToken);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    const body = await response.json();
    if (!response.ok) {
      return {
        configured: true,
        live: false,
        mock: false,
        status: response.status,
        label: 'Instagram Graph API (official Reels publish)',
        error: body.error?.message ?? `Graph API HTTP ${response.status}`,
      };
    }

    return {
      configured: true,
      live: true,
      mock: false,
      status: response.status,
      label: 'Instagram Graph API (official Reels publish)',
      accountId: body.id ?? null,
      accountName: body.name ?? null,
      igUserId: cfg.igUserId || null,
      pageId: cfg.pageId || null,
    };
  } catch (error) {
    return {
      configured: true,
      live: false,
      mock: false,
      status: null,
      label: 'Instagram Graph API (official Reels publish)',
      error: error instanceof Error ? error.message : 'Graph API request failed',
    };
  }
}

async function publishReel({ videoUrl, caption }) {
  return metaPublisher.publishInstagramReel({ videoUrl, caption });
}

module.exports = {
  GRAPH_VERSION,
  GRAPH_BASE,
  getConfig,
  isConfigured,
  probeGraphApi,
  publishReel,
};
