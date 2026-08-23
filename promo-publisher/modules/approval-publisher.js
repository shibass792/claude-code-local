require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });

const fs = require('fs');
const path = require('path');
const { createTemporaryPublicUrl } = require('./tunnel');
const metaPublisher = require('./publishers/meta');
const tiktokPublisher = require('./publishers/tiktok');
const ai = require('./ai');
const hooks = require('./hooks');
const renderer = require('./renderer');
const library = require('./library');
const radar = require('./radar');
const {
  PENDING_DB,
  PUBLISH_RESULTS,
  readJson,
  writeJson,
  resolveFromRoot,
} = require('./store');

/** Every target platform pulls the file over the public internet. */
const PLATFORMS_REQUIRING_PUBLIC_URL = new Set(['instagram', 'facebook', 'tiktok']);

function isDryRun() {
  return process.env.PUBLISH_DRY_RUN === '1';
}

function buildCaption(campaign) {
  const parts = [campaign.captionHe, campaign.captionEn, campaign.hashtags]
    .map((part) => (part ?? '').trim())
    .filter(Boolean);
  return parts.join('\n\n');
}

/**
 * The queue only ever contains campaigns the operator actually created — no
 * seeded demo rows.
 */
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

function upsertCampaign(campaign) {
  const queue = getPendingQueue();
  const index = queue.findIndex((item) => item.id === campaign.id);
  if (index >= 0) {
    queue[index] = { ...queue[index], ...campaign };
  } else {
    queue.unshift(campaign);
  }
  savePendingQueue(queue);
  return campaign;
}

/**
 * Build a real campaign: render the reel with ffmpeg, then write the copy with
 * the local model. Rendering is required; if the model is down we still keep the
 * rendered video and flag the missing captions.
 */
async function createCampaignFromAudio({
  audioPath,
  coverPath = null,
  style = 'bars',
  startSec = 0,
  durationSec,
  title,
  platforms = ['instagram', 'tiktok', 'facebook'],
  onProgress,
} = {}) {
  if (!audioPath || !fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  onProgress?.({ stage: 'probe' });
  const meta = await renderer.probeAudio(audioPath);

  const track = {
    title: title || meta.title || meta.fileName,
    bpm: meta.bpm,
    key: meta.key,
    styleHint: renderer.STYLES[style] ?? style,
  };

  let trends = [];
  try {
    trends = (radar.getRadarFeed()?.viral ?? []).slice(0, 5);
  } catch {
    trends = [];
  }

  // Generate copy first so the hook can be burned into the video.
  let hook = null;
  let hookOptions = [];
  let aiMeta = null;
  let captions = null;
  let aiError = null;

  try {
    onProgress?.({ stage: 'hooks' });
    const generated = await hooks.generateHooks({ track, trends, count: 3 });
    hookOptions = generated.hooks;
    [hook] = generated.hooks;
    aiMeta = { model: generated.model, provider: generated.provider };

    onProgress?.({ stage: 'captions' });
    captions = await hooks.generateCaptions({
      track,
      hook: hook.he || hook.en,
      trends,
    });
  } catch (error) {
    aiError = error.message;
  }

  onProgress?.({ stage: 'render' });
  const render = await renderer.renderReel({
    audioPath,
    coverPath,
    hook: hook?.he || hook?.en || '',
    subtitle: track.bpm ? `${track.title} · ${track.bpm} BPM` : track.title,
    style,
    startSec,
    durationSec,
    onProgress: (p) => onProgress?.({ stage: 'render', ...p }),
  });

  const campaign = {
    id: `camp_${Date.now().toString(36)}`,
    title: track.title,
    videoPath: render.relativePath,
    duration: `00:${String(Math.round(render.durationSec)).padStart(2, '0')}`,
    format: `Reels / TikTok (${render.width}x${render.height})`,
    style: renderer.STYLES[style] ?? style,
    watched: false,
    captionHe: captions?.captionHe ?? '',
    captionEn: captions?.captionEn ?? '',
    hashtags: captions?.hashtags ?? '',
    platforms,
    hookOptions,
    source: {
      audioPath,
      bpm: meta.bpm,
      durationSec: meta.duration,
    },
    render: {
      encoder: render.encoder,
      renderMs: render.renderMs,
      sizeBytes: render.sizeBytes,
      renderedAt: render.renderedAt,
    },
    ai: aiMeta,
    aiError,
    createdAt: new Date().toISOString(),
  };

  upsertCampaign(campaign);
  return { campaign, render, aiError };
}

async function publishToPlatforms(campaign, publicVideoUrl, onProgress) {
  const caption = buildCaption(campaign);
  const results = [];
  const platforms = campaign.platforms ?? [];

  if (platforms.includes('instagram')) {
    results.push(
      await metaPublisher.publishInstagramReel({
        videoUrl: publicVideoUrl,
        caption,
        onProgress: (p) => onProgress?.({ platform: 'instagram', ...p }),
      }),
    );
  }

  if (platforms.includes('facebook')) {
    results.push(
      await metaPublisher.publishFacebookVideo({
        videoUrl: publicVideoUrl,
        caption,
        onProgress: (p) => onProgress?.({ platform: 'facebook', ...p }),
      }),
    );
  }

  if (platforms.includes('tiktok')) {
    results.push(
      await tiktokPublisher.publishTikTokVideo({
        videoUrl: publicVideoUrl,
        caption,
        onProgress: (p) => onProgress?.({ platform: 'tiktok', ...p }),
      }),
    );
  }

  return results;
}

/** Collect the permalinks the APIs actually returned. */
function collectUrls(results) {
  return results.reduce((acc, result) => {
    if (result.url) {
      acc[result.platform] = result.url;
    }
    return acc;
  }, {});
}

async function publishCampaign(campaignData, { onProgress } = {}) {
  if (!campaignData?.id) {
    throw new Error('Campaign id is required');
  }

  if (!campaignData.watched) {
    return {
      success: false,
      error: 'יש לצפות בסרטון לפחות פעם אחת לפני פרסום',
    };
  }

  const platforms = campaignData.platforms ?? [];
  if (!platforms.length) {
    return { success: false, error: 'לא נבחרה אף פלטפורמה לפרסום' };
  }

  const dryRun = isDryRun();

  // Dry run is an explicit, labelled mode — never an accidental fallback.
  if (dryRun) {
    const results = platforms.map((platform) => ({
      platform,
      success: true,
      dryRun: true,
      url: null,
      note: 'PUBLISH_DRY_RUN=1 — no API call was made',
    }));

    const entry = {
      campaignId: campaignData.id,
      publishedAt: new Date().toISOString(),
      platforms,
      dryRun: true,
      tunnelMode: 'none',
      publicVideoUrl: null,
      results,
      urls: {},
    };
    appendPublishResult(entry);

    return { success: true, dryRun: true, campaignId: campaignData.id, results, urls: {} };
  }

  const videoPath = resolveFromRoot(campaignData.videoPath);
  if (!videoPath || !fs.existsSync(videoPath)) {
    return {
      success: false,
      error: `קובץ הווידאו לא נמצא: ${campaignData.videoPath ?? '(ריק)'} — הרץ רינדור לפני פרסום`,
    };
  }

  let tunnelHandle = null;

  try {
    onProgress?.({ stage: 'tunnel' });
    tunnelHandle = await createTemporaryPublicUrl(videoPath);
    const publicVideoUrl = tunnelHandle.url;

    const needsPublic = platforms.some((platform) => PLATFORMS_REQUIRING_PUBLIC_URL.has(platform));
    if (needsPublic && !publicVideoUrl.startsWith('https://')) {
      return {
        success: false,
        error:
          'הפלטפורמות דורשות כתובת HTTPS ציבורית לקובץ. התקן cloudflared או הגדר ' +
          'CLOUDFLARE_TUNNEL_TOKEN ב-config/.env (הכתובת הנוכחית מקומית בלבד).',
        tunnelMode: tunnelHandle.mode,
      };
    }

    onProgress?.({ stage: 'publish' });
    const results = await publishToPlatforms(campaignData, publicVideoUrl, onProgress);

    const succeeded = results.filter((item) => item.success);
    const failed = results.filter((item) => !item.success);
    const allSucceeded = results.length > 0 && failed.length === 0;
    const urls = collectUrls(results);

    // Only clear the queue when every selected platform really accepted the post.
    if (allSucceeded) {
      rejectCampaign(campaignData.id);
    }

    const entry = {
      campaignId: campaignData.id,
      publishedAt: new Date().toISOString(),
      platforms,
      dryRun: false,
      tunnelMode: tunnelHandle?.mode ?? 'none',
      publicVideoUrl,
      results,
      urls,
      partial: succeeded.length > 0 && failed.length > 0,
    };
    appendPublishResult(entry);

    return {
      success: allSucceeded,
      partial: entry.partial,
      publishedAt: entry.publishedAt,
      campaignId: campaignData.id,
      urls,
      results,
      ...(failed.length
        ? { error: failed.map((f) => `${f.platform}: ${f.error}`).join(' · ') }
        : {}),
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

/**
 * Live health for every real integration — each entry is a genuine probe, not a
 * config-file guess. `verify: true` also spends a real API call per platform.
 */
async function getConnectionHealth({ verify = false } = {}) {
  const [aiHealth, renderHealth, radarHealth] = await Promise.all([
    ai.checkHealth(),
    renderer.checkHealth(),
    radar.checkHealth(),
  ]);

  const meta = {
    configured: metaPublisher.isConfigured(),
    label: 'Instagram & Facebook (Meta Graph API)',
    apiVersion: metaPublisher.GRAPH_VERSION,
  };
  const tiktok = {
    configured: tiktokPublisher.isConfigured(),
    label: 'TikTok Content Posting API',
    mode: process.env.TIKTOK_PUBLISH_MODE ?? 'draft',
  };

  if (verify) {
    if (meta.configured) {
      Object.assign(meta, await metaPublisher.verifyCredentials());
    }
    if (tiktok.configured) {
      Object.assign(tiktok, await tiktokPublisher.verifyCredentials());
    }
  }

  const libraryStatus = library.getIndexStatus();

  return {
    ai: {
      configured: aiHealth.ok,
      ok: aiHealth.ok,
      label: `AI hooks & captions (${aiHealth.provider})`,
      endpoint: aiHealth.baseUrl,
      model: aiHealth.model,
      error: aiHealth.error ?? null,
    },
    renderer: {
      configured: renderHealth.ok,
      ok: renderHealth.ok,
      label: 'Video renderer (FFmpeg)',
      encoder: renderHealth.encoder,
      resolution: `${renderHealth.width}x${renderHealth.height}@${renderHealth.fps}`,
      error: renderHealth.ok ? null : 'ffmpeg/ffprobe not found in PATH',
    },
    radar: {
      configured: radarHealth.ok,
      ok: radarHealth.ok,
      label: 'Artist radar (yt-dlp)',
      version: radarHealth.version ?? null,
      error: radarHealth.error ?? null,
    },
    library: {
      configured: libraryStatus.indexed,
      ok: libraryStatus.indexed,
      label: 'Music library index',
      detail: libraryStatus.message,
      roots: libraryStatus.roots,
    },
    meta,
    tiktok,
    tunnel: {
      configured: Boolean(process.env.CLOUDFLARE_TUNNEL_TOKEN),
      label: 'Cloudflare Tunnel / HTTPS proxy',
      note: 'נדרש כדי שהרשתות יוכלו להוריד את הקובץ מהמחשב',
    },
    dryRun: isDryRun(),
  };
}

module.exports = {
  PLATFORMS_REQUIRING_PUBLIC_URL,
  isDryRun,
  buildCaption,
  getPendingQueue,
  savePendingQueue,
  upsertCampaign,
  createCampaignFromAudio,
  rejectCampaign,
  markWatched,
  collectUrls,
  publishCampaign,
  getPublishHistory,
  getConnectionHealth,
};
