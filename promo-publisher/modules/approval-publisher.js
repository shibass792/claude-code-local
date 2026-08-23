require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });

const fs = require('fs');
const path = require('path');
const { createTemporaryPublicUrl } = require('./tunnel');
const instagramGraph = require('./engines/instagram-graph');
const tiktokPublisher = require('./publishers/tiktok');
const { probeOllama } = require('./engines/ollama-hooks');
const { probeFfmpeg } = require('./engines/ffmpeg-render');
const { getLibrary } = require('./engines/library-index');
const { appendLog } = require('./creation-log');
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

function enqueueRenderedCampaign(campaign) {
  if (!campaign?.id || !campaign.videoPath) {
    throw new Error('Rendered campaign requires id and videoPath');
  }
  const queue = getPendingQueue().filter((item) => item.id !== campaign.id);
  queue.unshift({
    watched: false,
    format: 'Reels / TikTok (9:16)',
    platforms: ['instagram', 'tiktok', 'facebook'],
    ...campaign,
  });
  savePendingQueue(queue);
  appendLog('success', 'studio', `Queued campaign ${campaign.id} for approval`);
  return queue[0];
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
      await instagramGraph.publishInstagramReel({
        videoUrl: publicVideoUrl,
        caption,
      }),
    );
  }

  if (campaign.platforms.includes('facebook')) {
    results.push(
      await instagramGraph.publishFacebookVideo({
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
    if (item.success && item.id) {
      if (item.platform === 'instagram') {
        urls.instagram = `https://www.instagram.com/reel/${item.id}/`;
      }
      if (item.platform === 'facebook') {
        urls.facebook = `https://www.facebook.com/watch/?v=${item.id}`;
      }
    }
    if (item.success && item.publishId && item.platform === 'tiktok') {
      urls.tiktok = `tiktok:publish:${item.publishId}`;
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

  if (!hasVideo) {
    appendLog('error', 'publish', 'Publish blocked — rendered video file is missing');
    return {
      success: false,
      mock: false,
      live: false,
      error: 'אין קובץ וידאו אמיתי לפרסום — רנדר קודם בטאב היצירה',
    };
  }

  let tunnelHandle = null;
  let publicVideoUrl = null;

  tunnelHandle = await createTemporaryPublicUrl(videoPath);
  publicVideoUrl = tunnelHandle.url;
  appendLog('info', 'publish', `Tunnel ${tunnelHandle.mode}: ${publicVideoUrl}`);

  try {
    const platformResults = await publishToPlatforms(campaignData, publicVideoUrl);
    const urls = collectPublishUrls(platformResults);
    const anyFailed = platformResults.some((item) => item.success === false);
    const allLive = platformResults.every((item) => item.live && item.success);

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
      mock: false,
      live: allLive,
    };

    appendPublishResult(entry);
    appendLog(anyFailed ? 'error' : 'success', 'publish', anyFailed ? 'Publish had API failures' : 'Live publish completed');

    return {
      success: !anyFailed,
      mock: false,
      live: allLive,
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

async function getConnectionHealth() {
  const [instagram, ollama, ffmpeg] = await Promise.all([
    instagramGraph.probeInstagram(),
    probeOllama(),
    probeFfmpeg(),
  ]);
  const library = getLibrary();

  return {
    instagram: {
      ...instagram,
      configured: instagram.configured,
      label: 'Instagram Graph API (official)',
    },
    tiktok: {
      configured: tiktokPublisher.isConfigured(),
      live: tiktokPublisher.isConfigured(),
      label: 'TikTok Content Posting API',
      mode: process.env.TIKTOK_PUBLISH_MODE ?? 'draft',
    },
    ollama: {
      ...ollama,
      label: 'Ollama ReelHook (local LLM)',
    },
    ffmpeg: {
      ...ffmpeg,
      label: 'FFmpeg 9:16 renderer',
    },
    library: {
      configured: library.count > 0,
      live: true,
      count: library.count,
      label: `Music library index (${library.count} files)`,
    },
    tunnel: {
      configured: Boolean(process.env.CLOUDFLARE_TUNNEL_TOKEN),
      cloudflared: Boolean(process.env.CLOUDFLARE_TUNNEL_TOKEN),
      label: 'Cloudflare Tunnel / HTTPS proxy',
    },
  };
}

module.exports = {
  buildCaption,
  getPendingQueue,
  savePendingQueue,
  enqueueRenderedCampaign,
  rejectCampaign,
  markWatched,
  publishCampaign,
  getPublishHistory,
  getConnectionHealth,
};
