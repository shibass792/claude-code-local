const axios = require('axios');

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

async function publishTikTokVideo({ videoUrl, caption }) {
  const cfg = getTikTokConfig();
  if (!isConfigured()) {
    return {
      platform: 'tiktok',
      success: false,
      mock: false,
      error: 'TikTok credentials missing — set TIKTOK_ACCESS_TOKEN and TIKTOK_CLIENT_KEY',
    };
  }

  const privacyLevel = cfg.publishMode === 'direct' ? 'PUBLIC_TO_EVERYONE' : 'SELF_ONLY';

  const initRes = await axios.post(
    'https://open.tiktokapis.com/v2/post/publish/video/init/',
    {
      post_info: {
        title: caption.slice(0, 150),
        privacy_level: privacyLevel,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: videoUrl,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        'Content-Type': 'application/json',
      },
    },
  );

  return {
    platform: 'tiktok',
    success: true,
    mock: false,
    mode: cfg.publishMode,
    publishId: initRes.data?.data?.publish_id,
  };
}

module.exports = {
  getTikTokConfig,
  isConfigured,
  publishTikTokVideo,
};
