require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });

const fs = require('fs');
const path = require('path');
const { createTemporaryPublicUrl } = require('./tunnel');
const metaPublisher = require('./publishers/meta');
const tiktokPublisher = require('./publishers/tiktok');
const {
  PENDING_DB,
  PUBLISH_RESULTS,
  readJson,
  writeJson,
  resolveFromRoot,
} = require('./store');

function buildCaption(campaign) {
  const parts = [campaign.captionHe, campaign.captionEn, campaign.hashtags]
    .map((part) => (part ?? '').trim())
    .filter(Boolean);
  return parts.join('\n\n');
}

function getPendingQueue() {
  const queue = readJson(PENDING_DB, null);
  if (queue) {
    return queue;
  }

  const sampleQueue = [
    {
      id: 'camp_001',
      title: 'Shiva Mangala (ShiBass Edit)',
      videoPath: 'output/campaigns/camp_001/reel_1080x1920.mp4',
      duration: '00:15',
      format: 'Reels / TikTok (9:16)',
      templateId: null,
      watched: false,
      captionHe:
        'כשסוף סוף פיצחת את הלואו-אנד המושלם באולפן 🔊✨ חכו לדרופ...',
      captionEn:
        'When the kick & bass finally sit right in the mix 🔥 Wait for the drop! #ShiBass #Psytrance',
      hashtags: '#Psytrance #ElectronicMusic #ProducerLife #Cubase #AudixRecords',
      platforms: ['instagram', 'tiktok', 'facebook'],
    },
  ];

  writeJson(PENDING_DB, sampleQueue);
  return sampleQueue;
}

function savePendingQueue(queue) {
  writeJson(PENDING_DB, queue);
}

function appendPublishResult(entry) {
  const history = readJson(PUBLISH_RESULTS, []);
  history.unshift(entry);
  writeJson(PUBLISH_RESULTS, history.slice(0, 200));
}

function rejectCampaign(campaignId) {
  const queue = getPendingQueue().filter((item) => item.id !== campaignId);
  savePendingQueue(queue);
  return { success: true, remaining: queue.length };
}

function markWatched(campaignId) {
  const queue = getPendingQueue().map((item) =>
    item.id === campaignId ? { ...item, watched: true } : item,
  );
  savePendingQueue(queue);
  return queue.find((item) => item.id === campaignId) ?? null;
}

async function publishToPlatforms(campaign, publicVideoUrl) {
  const caption = buildCaption(campaign);
  const results = [];

  if (campaign.platforms.includes('instagram')) {
    results.push(
      await metaPublisher.publishInstagramReel({
        videoUrl: publicVideoUrl,
        caption,
      }),
    );
  }

  if (campaign.platforms.includes('facebook')) {
    results.push(
      await metaPublisher.publishFacebookVideo({
        videoUrl: publicVideoUrl,
        caption,
      }),
    );
  }

  if (campaign.platforms.includes('tiktok')) {
    results.push(
      await tiktokPublisher.publishTikTokVideo({
        videoUrl: publicVideoUrl,
        caption,
      }),
    );
  }

  return results;
}

function mockPublishUrls(campaignId) {
  return {
    instagram: `https://instagram.com/p/mock_${campaignId}`,
    facebook: `https://facebook.com/watch/mock_${campaignId}`,
    tiktok: `https://tiktok.com/@shibass/video/mock_${campaignId}`,
  };
}

async function publishCampaign(campaignData) {
  if (!campaignData?.id) {
    throw new Error('Campaign id is required');
  }

  if (!campaignData.watched) {
    return {
      success: false,
      error: 'יש לצפות בסרטון לפחות פעם אחת לפני פרסום',
    };
  }

  const videoPath = resolveFromRoot(campaignData.videoPath);
  const hasVideo = Boolean(videoPath && fs.existsSync(videoPath));

  let tunnelHandle = null;
  let publicVideoUrl = null;

  if (hasVideo) {
    tunnelHandle = await createTemporaryPublicUrl(videoPath);
    publicVideoUrl = tunnelHandle.url;
  }

  let platformResults = [];
  let urls = mockPublishUrls(campaignData.id);

  try {
    if (hasVideo && publicVideoUrl) {
      platformResults = await publishToPlatforms(campaignData, publicVideoUrl);
    } else {
      platformResults = (campaignData.platforms ?? []).map((platform) => ({
        platform,
        success: true,
        mock: true,
        error: 'Video file missing — mock publish only',
      }));
    }

    const allMock =
      platformResults.length > 0 && platformResults.every((item) => item.mock);
    const anyFailed = platformResults.some((item) => item.success === false);

    if (!anyFailed || allMock) {
      rejectCampaign(campaignData.id);
    }

    const entry = {
      campaignId: campaignData.id,
      publishedAt: new Date().toISOString(),
      platforms: campaignData.platforms,
      tunnelMode: tunnelHandle?.mode ?? 'none',
      publicVideoUrl,
      results: platformResults,
      urls,
      mock: allMock,
    };

    appendPublishResult(entry);

    return {
      success: !anyFailed || allMock,
      mock: allMock,
      publishedAt: entry.publishedAt,
      campaignId: campaignData.id,
      urls,
      results: platformResults,
    };
  } finally {
    if (tunnelHandle?.close) {
      await tunnelHandle.close();
    }
  }
}

function getPublishHistory() {
  return readJson(PUBLISH_RESULTS, []);
}

function getConnectionHealth() {
  return {
    meta: {
      configured: metaPublisher.isConfigured(),
      label: 'Instagram & Facebook (Meta Graph API)',
    },
    tiktok: {
      configured: tiktokPublisher.isConfigured(),
      label: 'TikTok Content Posting API',
      mode: process.env.TIKTOK_PUBLISH_MODE ?? 'draft',
    },
    tunnel: {
      cloudflared: Boolean(process.env.CLOUDFLARE_TUNNEL_TOKEN),
      label: 'Cloudflare Tunnel / HTTPS proxy',
    },
  };
}

module.exports = {
  buildCaption,
  getPendingQueue,
  savePendingQueue,
  rejectCampaign,
  markWatched,
  publishCampaign,
  getPublishHistory,
  getConnectionHealth,
};
