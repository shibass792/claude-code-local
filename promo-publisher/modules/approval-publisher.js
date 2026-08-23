require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });

const fs = require('fs');
const path = require('path');
const { createTemporaryPublicUrl } = require('./tunnel');
const metaPublisher = require('./publishers/meta');
const tiktokPublisher = require('./publishers/tiktok');
const instagramEngine = require('./engines/instagram-engine');
const { appendLog } = require('./engines/creation-log');
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
  return readJson(PENDING_DB, []);
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
      await instagramEngine.publishReel({
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

function enqueueRenderedCampaign(render) {
  if (!render?.ok) {
    return null;
  }

  const campaign = {
    id: `camp_${render.id}`,
    title: render.hook || 'ShiBass Reel',
    videoPath: render.relativePath,
    duration: `00:${String(Math.round(render.durationSeconds)).padStart(2, '0')}`,
    format: 'Reels / TikTok (9:16)',
    templateId: null,
    watched: false,
    captionHe: render.hook ?? '',
    captionEn: render.hook ?? '',
    hashtags: '#Psytrance #ShiBass #ElectronicMusic',
    platforms: ['instagram', 'tiktok', 'facebook'],
  };

  const queue = getPendingQueue().filter((item) => item.id !== campaign.id);
  queue.unshift(campaign);
  savePendingQueue(queue);
  appendLog({
    engine: 'approval',
    event: 'enqueue',
    message: `Queued ${campaign.id} from render ${render.relativePath}`,
    data: { campaignId: campaign.id, videoPath: campaign.videoPath },
  });
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
  if (!hasVideo) {
    const error = 'Video file missing — publish aborted (no mock)';
    appendLog({
      engine: 'approval',
      event: 'publish',
      level: 'error',
      message: error,
      data: { campaignId: campaignData.id, videoPath: campaignData.videoPath },
    });
    return { success: false, mock: false, error };
  }

  let tunnelHandle = null;
  let publicVideoUrl = null;

  try {
    tunnelHandle = await createTemporaryPublicUrl(videoPath);
    publicVideoUrl = tunnelHandle.url;
    const platformResults = await publishToPlatforms(campaignData, publicVideoUrl);
    const anyFailed = platformResults.some((item) => item.success === false);
    const anyMock = platformResults.some((item) => item.mock);

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
      mock: false,
    };

    appendPublishResult(entry);
    appendLog({
      engine: 'approval',
      event: 'publish',
      level: anyFailed ? 'error' : 'info',
      message: anyFailed
        ? `Publish failed for ${campaignData.id}`
        : `Published ${campaignData.id} to ${(campaignData.platforms ?? []).join(', ')}`,
      data: { results: platformResults, mock: anyMock },
    });

    return {
      success: !anyFailed,
      mock: false,
      publishedAt: entry.publishedAt,
      campaignId: campaignData.id,
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
  enqueueRenderedCampaign,
};
