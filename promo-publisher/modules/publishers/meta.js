const axios = require('axios');

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

async function publishInstagramReel({ videoUrl, caption }) {
  const cfg = getMetaConfig();
  if (!isConfigured()) {
    return {
      platform: 'instagram',
      success: false,
      mock: false,
      live: false,
      error: 'META credentials missing — set META_ACCESS_TOKEN, META_PAGE_ID, META_IG_USER_ID',
    };
  }

  const createRes = await axios.post(
    `https://graph.facebook.com/v21.0/${cfg.igUserId}/media`,
    null,
    {
      params: {
        media_type: 'REELS',
        video_url: videoUrl,
        caption,
        access_token: cfg.accessToken,
      },
    },
  );

  const creationId = createRes.data.id;
  const publishRes = await axios.post(
    `https://graph.facebook.com/v21.0/${cfg.igUserId}/media_publish`,
    null,
    {
      params: {
        creation_id: creationId,
        access_token: cfg.accessToken,
      },
    },
  );

  return {
    platform: 'instagram',
    success: true,
    mock: false,
    live: true,
    id: publishRes.data.id,
  };
}

async function publishFacebookVideo({ videoUrl, caption }) {
  const cfg = getMetaConfig();
  if (!cfg.accessToken || !cfg.pageId) {
    return {
      platform: 'facebook',
      success: false,
      mock: false,
      live: false,
      error: 'META credentials missing — set META_ACCESS_TOKEN and META_PAGE_ID',
    };
  }

  const res = await axios.post(
    `https://graph.facebook.com/v21.0/${cfg.pageId}/videos`,
    null,
    {
      params: {
        file_url: videoUrl,
        description: caption,
        access_token: cfg.accessToken,
      },
    },
  );

  return {
    platform: 'facebook',
    success: true,
    mock: false,
    live: true,
    id: res.data.id,
  };
}

module.exports = {
  getMetaConfig,
  isConfigured,
  publishInstagramReel,
  publishFacebookVideo,
};
