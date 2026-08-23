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
const { buildPermalink } = require('./instagram-engine');
const sql = require('./sql-db');

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
  sql.replaceCampaigns(queue);
}

function appendPublishResult(entry) {
  const history = readJson(PUBLISH_RESULTS, []);
  history.unshift(entry);
  writeJson(PUBLISH_RESULTS, history.slice(0, 200));
  sql.insertPublish(entry);
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

function collectPublishUrls(platformResults) {
  const urls = {};
  for (const item of platformResults) {
    const id = item.id || item.publishId;
    const permalink = buildPermalink(item.platform, id);
    if (permalink) {
      urls[item.platform] = permalink;
    }
  }
  return urls;
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
  let urls = {};

  try {
    if (!hasVideo || !publicVideoUrl) {
      return {
        success: false,
        mock: false,
        error: 'Video file missing — render a real 9:16 file before publish',
      };
    }

    platformResults = await publishToPlatforms(campaignData, publicVideoUrl);
    urls = collectPublishUrls(platformResults);
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
      urls,
      mock: anyMock,
    };

    appendPublishResult(entry);

    return {
      success: !anyFailed,
      mock: false,
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
  const sqlHealth = sql.health();
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
    sqlite: {
      configured: Boolean(sqlHealth.ok && sqlHealth.exists),
      available: Boolean(sqlHealth.ok),
      label: 'Studio SQLite (catalog / log / approval)',
      path: sqlHealth.path,
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
