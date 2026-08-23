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

function isLegacySampleCampaign(item) {
  return (
    item?.id === 'camp_001' &&
    item?.videoPath === 'output/campaigns/camp_001/reel_1080x1920.mp4'
  );
}

function getPendingQueue() {
  const queue = readJson(PENDING_DB, []);
  const realQueue = Array.isArray(queue) ? queue.filter((item) => !isLegacySampleCampaign(item)) : [];
  if (realQueue.length !== (Array.isArray(queue) ? queue.length : 0)) {
    writeJson(PENDING_DB, realQueue);
  }
  return realQueue;
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

function allowMockPublish() {
  return process.env.SHIBASS_ALLOW_MOCK_PUBLISH === '1';
}

function collectPublishUrls(campaignId, platformResults) {
  const urls = {};
  for (const result of platformResults) {
    if (result.success && result.id) {
      if (result.platform === 'instagram') {
        urls.instagram = `https://www.instagram.com/reel/${result.id}/`;
      }
      if (result.platform === 'facebook') {
        urls.facebook = `https://www.facebook.com/watch/?v=${result.id}`;
      }
    }
    if (result.success && result.publishId && result.platform === 'tiktok') {
      urls.tiktok = `tiktok:publish:${result.publishId}`;
    }
  }
  if (allowMockPublish() && Object.keys(urls).length === 0) {
    return {
      instagram: `https://instagram.com/p/mock_${campaignId}`,
      facebook: `https://facebook.com/watch/mock_${campaignId}`,
      tiktok: `https://tiktok.com/@shibass/video/mock_${campaignId}`,
    };
  }
  return urls;
}

function formatDuration(durationSec) {
  const total = Math.max(0, Math.round(Number(durationSec) || 0));
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function enqueueRenderedCampaign({
  title,
  videoPath,
  durationSec,
  hook,
  hooks,
  audioPath,
}) {
  const campaign = {
    id: `camp_${Date.now()}`,
    title: title || 'Untitled reel',
    videoPath,
    audioPath: audioPath || null,
    duration: formatDuration(durationSec),
    format: 'Reels / TikTok (9:16)',
    templateId: null,
    watched: false,
    captionHe: hook || (hooks && hooks[0]) || '',
    captionEn: (hooks && hooks[1]) || hook || '',
    hashtags: '#Psytrance #ShiBass #ElectronicMusic',
    platforms: ['instagram', 'tiktok', 'facebook'],
    hooks: hooks ?? [],
    createdAt: new Date().toISOString(),
  };

  const queue = getPendingQueue();
  queue.unshift(campaign);
  savePendingQueue(queue);
  return campaign;
}

async function publishCampaign(campaignData) {
  if (!campaignData?.id) {
    throw new Error('Campaign id is required');
  }

  if (!campaignData.watched) {
    return {
      success: false,
      mock: false,
      error: 'יש לצפות בסרטון לפחות פעם אחת לפני פרסום',
    };
  }

  const videoPath = resolveFromRoot(campaignData.videoPath);
  const hasVideo = Boolean(videoPath && fs.existsSync(videoPath));

  if (!hasVideo && !allowMockPublish()) {
    return {
      success: false,
      mock: false,
      error: 'קובץ הווידאו חסר — הרץ רינדור אמיתי לפני פרסום',
    };
  }

  let tunnelHandle = null;
  let publicVideoUrl = null;

  if (hasVideo) {
    tunnelHandle = await createTemporaryPublicUrl(videoPath);
    publicVideoUrl = tunnelHandle.url;
  }

  let platformResults = [];

  try {
    if (hasVideo && publicVideoUrl) {
      platformResults = await publishToPlatforms(campaignData, publicVideoUrl);
    } else {
      platformResults = (campaignData.platforms ?? []).map((platform) => ({
        platform,
        success: false,
        mock: allowMockPublish(),
        error: 'Video file missing',
      }));
    }

    const allMock =
      platformResults.length > 0 && platformResults.every((item) => item.mock);
    const anyFailed = platformResults.some((item) => item.success === false);
    const urls = collectPublishUrls(campaignData.id, platformResults);

    if (!anyFailed) {
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
      success: !anyFailed,
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
  enqueueRenderedCampaign,
  publishCampaign,
  getPublishHistory,
  getConnectionHealth,
};
