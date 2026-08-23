'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const PENDING_DB = path.join(OUTPUT_DIR, 'pending_campaigns.json');
const RESULTS_DB = path.join(OUTPUT_DIR, 'publish_results.json');
const HISTORY_DB = path.join(OUTPUT_DIR, 'publish_history.json');

const STATUS = Object.freeze({
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  REJECTED: 'REJECTED',
  PUBLISHED: 'PUBLISHED',
  FAILED: 'FAILED',
});

function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  ensureOutputDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function createSampleQueue() {
  return [
    {
      id: 'camp_001',
      title: 'Shiva Mangala (ShiBass Edit)',
      videoPath: '',
      duration: '00:15',
      format: 'Reels / TikTok (9:16)',
      style: 'Drop Reaction',
      captionHe: 'כשסוף סוף פיצחת את הלואו-אנד המושלם באולפן 🔊 חכו לדרופ...',
      captionEn: 'When the kick & bass finally sit right in the mix. Wait for the drop! #ShiBass #Psytrance',
      hashtags: '#Psytrance #ElectronicMusic #ProducerLife #Cubase #AudixRecords #ShiBass',
      platforms: ['instagram', 'tiktok', 'facebook'],
      status: STATUS.PENDING_APPROVAL,
      watchedOnce: false,
      createdAt: new Date().toISOString(),
      remixFrom: null,
    },
  ];
}

function getPendingQueue() {
  ensureOutputDir();
  if (!fs.existsSync(PENDING_DB)) {
    const sample = createSampleQueue();
    writeJson(PENDING_DB, sample);
    return sample.filter((c) => c.status === STATUS.PENDING_APPROVAL);
  }
  const all = readJson(PENDING_DB, []);
  return all.filter((c) => c.status === STATUS.PENDING_APPROVAL);
}

function saveQueue(campaigns) {
  writeJson(PENDING_DB, campaigns);
}

function loadAllCampaigns() {
  ensureOutputDir();
  if (!fs.existsSync(PENDING_DB)) {
    const sample = createSampleQueue();
    writeJson(PENDING_DB, sample);
    return sample;
  }
  return readJson(PENDING_DB, []);
}

function markWatched(campaignId) {
  const all = loadAllCampaigns();
  const idx = all.findIndex((c) => c.id === campaignId);
  if (idx < 0) {
    return { success: false, error: 'Campaign not found' };
  }
  all[idx].watchedOnce = true;
  saveQueue(all);
  return { success: true, campaign: all[idx] };
}

function updateCampaign(campaignId, patch) {
  const all = loadAllCampaigns();
  const idx = all.findIndex((c) => c.id === campaignId);
  if (idx < 0) {
    return { success: false, error: 'Campaign not found' };
  }
  all[idx] = { ...all[idx], ...patch, id: all[idx].id };
  saveQueue(all);
  return { success: true, campaign: all[idx] };
}

function rejectCampaign(campaignId) {
  const all = loadAllCampaigns();
  const idx = all.findIndex((c) => c.id === campaignId);
  if (idx < 0) {
    return { success: false, error: 'Campaign not found' };
  }
  all[idx].status = STATUS.REJECTED;
  all[idx].rejectedAt = new Date().toISOString();
  saveQueue(all);
  return { success: true, campaign: all[idx] };
}

/**
 * Human-in-the-loop gate: never publish unless watchedOnce is true
 * (or forceWatched is explicitly set by the desktop after play).
 */
function assertCanPublish(campaign) {
  if (!campaign) {
    throw new Error('No campaign selected');
  }
  if (campaign.status !== STATUS.PENDING_APPROVAL) {
    throw new Error(`Campaign is not pending approval (status=${campaign.status})`);
  }
  if (!campaign.watchedOnce) {
    throw new Error('Watch the preview at least once before publishing');
  }
  if (!Array.isArray(campaign.platforms) || campaign.platforms.length === 0) {
    throw new Error('Select at least one platform');
  }
}

/**
 * Dry-run / local publisher. Records intent + mock URLs.
 * Real Meta/TikTok upload hooks go here once tokens + tunnel are wired.
 */
async function publishCampaign(campaignData, options = {}) {
  const dryRun = options.dryRun !== false;
  const all = loadAllCampaigns();
  const idx = all.findIndex((c) => c.id === campaignData.id);
  const campaign = idx >= 0 ? { ...all[idx], ...campaignData } : { ...campaignData };

  assertCanPublish(campaign);

  const publishedAt = new Date().toISOString();
  const tunnelId = crypto.randomBytes(6).toString('hex');
  const temporaryMediaUrl = dryRun
    ? `https://local-tunnel.example/${tunnelId}/${path.basename(campaign.videoPath || 'preview.mp4')}`
    : null;

  const urls = {};
  for (const platform of campaign.platforms) {
    urls[platform] = dryRun
      ? `https://${platform}.com/shibass/mock/${campaign.id}`
      : null;
  }

  const result = {
    success: true,
    dryRun,
    publishedAt,
    campaignId: campaign.id,
    platforms: campaign.platforms,
    temporaryMediaUrl,
    urls,
    captionHe: campaign.captionHe,
    captionEn: campaign.captionEn,
    hashtags: campaign.hashtags,
  };

  if (idx >= 0) {
    all[idx] = {
      ...campaign,
      status: STATUS.PUBLISHED,
      publishedAt,
      publishResult: result,
    };
    saveQueue(all);
  }

  const results = readJson(RESULTS_DB, []);
  results.unshift(result);
  writeJson(RESULTS_DB, results.slice(0, 200));

  const history = readJson(HISTORY_DB, []);
  history.unshift({
    id: campaign.id,
    title: campaign.title,
    platforms: campaign.platforms,
    publishedAt,
    dryRun,
    urls,
  });
  writeJson(HISTORY_DB, history.slice(0, 200));

  return result;
}

function getPublishHistory() {
  return readJson(HISTORY_DB, []);
}

function getConnectionHealth() {
  return {
    instagram: { connected: false, mode: 'token-required', label: 'Meta Graph API' },
    facebook: { connected: false, mode: 'token-required', label: 'Meta Graph API' },
    tiktok: { connected: false, mode: 'draft-inbox', label: 'TikTok Content Posting API' },
    tunnel: { connected: false, mode: 'on-demand', label: 'HTTPS temp tunnel (Cloudflare/ngrok)' },
    ollama: { connected: false, mode: 'optional', label: 'Local LLM captions' },
    localEngine: { connected: true, mode: 'ready', label: 'Local approval engine' },
  };
}

module.exports = {
  STATUS,
  getPendingQueue,
  loadAllCampaigns,
  markWatched,
  updateCampaign,
  rejectCampaign,
  publishCampaign,
  getPublishHistory,
  getConnectionHealth,
  assertCanPublish,
  PENDING_DB,
  RESULTS_DB,
  HISTORY_DB,
  OUTPUT_DIR,
};
