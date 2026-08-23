'use strict';

const fs = require('fs');
const crypto = require('crypto');
const approval = require('./approval-publisher');

const TEMPLATES = Object.freeze({
  drop_reaction: {
    id: 'drop_reaction',
    label: 'Drop Reaction / Bass Face',
    format: 'Reels / TikTok (9:16)',
    duration: '00:15',
    captionHe: 'חכו לדרופ... הלואו-אנד הזה לא משחק 🔊',
    captionEn: 'Wait for the drop... that low-end hits different.',
    hashtags: '#Psytrance #Drop #Bass #ShiBass #ProducerLife',
  },
  sound_design: {
    id: 'sound_design',
    label: 'Sound Design Secret',
    format: 'Reels / TikTok (9:16)',
    duration: '00:30',
    captionHe: 'איך בניתי את הסאונד הזה בפלאגין — שמרו לשימוש הבא',
    captionEn: 'How I built this sound in the plugin — save for your next session.',
    hashtags: '#SoundDesign #Serum #MusicProduction #ShiBass',
  },
  before_after: {
    id: 'before_after',
    label: 'Before vs After Mixing',
    format: 'Reels / TikTok (9:16)',
    duration: '00:20',
    captionHe: 'Dry vs ShiBass Master — תראו את ההבדל בקיק ובאס',
    captionEn: 'Dry vs ShiBass Master — hear the kick & bass difference.',
    hashtags: '#Mixing #Mastering #BeforeAfter #ShiBass',
  },
  visualizer: {
    id: 'visualizer',
    label: 'Hypnotic Visualizer & Spectrum',
    format: 'Reels / TikTok (9:16)',
    duration: '00:15',
    captionHe: 'ספקטרום חי על הדרופ — לופ חלק לשימור צפייה',
    captionEn: 'Live spectrum on the drop — seamless loop for retention.',
    hashtags: '#Visualizer #Psytrance #ElectronicMusic #ShiBass',
  },
  meme: {
    id: 'meme',
    label: 'Producer Relatable / Meme',
    format: 'Reels / TikTok (9:16)',
    duration: '00:12',
    captionHe: 'כשהקיק והבאס סוף סוף יושבים במיקס',
    captionEn: 'When the kick and bass finally sit in the mix.',
    hashtags: '#ProducerLife #StudioHumor #ShiBass #TranceFamily',
  },
});

function listTemplates() {
  return Object.values(TEMPLATES);
}

function createCampaignFromTemplate(options = {}) {
  const templateKey = options.templateId || 'drop_reaction';
  const template = TEMPLATES[templateKey] || TEMPLATES.drop_reaction;
  const title = options.title || `ShiBass Draft — ${template.label}`;
  const sourceFile = options.sourceFile || null;
  const remixFrom = options.remixFrom || null;

  const campaign = {
    id: `camp_${crypto.randomBytes(4).toString('hex')}`,
    title,
    videoPath: sourceFile || '',
    duration: template.duration,
    format: template.format,
    style: template.label,
    captionHe: options.captionHe || template.captionHe,
    captionEn: options.captionEn || template.captionEn,
    hashtags: options.hashtags || template.hashtags,
    platforms: options.platforms || ['instagram', 'tiktok', 'facebook'],
    status: approval.STATUS.PENDING_APPROVAL,
    watchedOnce: false,
    createdAt: new Date().toISOString(),
    remixFrom,
    templateId: template.id,
  };

  const all = approval.loadAllCampaigns();
  all.unshift(campaign);
  fs.mkdirSync(approval.OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(approval.PENDING_DB, JSON.stringify(all, null, 2), 'utf8');

  return campaign;
}

function createFromRadarIdea(trend, options = {}) {
  const styleHint = (trend.style || '').toLowerCase();
  let templateId = 'drop_reaction';
  if (styleHint.includes('educat') || styleHint.includes('sound')) {
    templateId = 'sound_design';
  } else if (styleHint.includes('visual')) {
    templateId = 'visualizer';
  } else if (styleHint.includes('meme') || styleHint.includes('relat')) {
    templateId = 'meme';
  }

  return createCampaignFromTemplate({
    templateId,
    title: `Remix: ${trend.artist} — ${trend.hookText}`.slice(0, 80),
    captionHe: options.captionHe || `הוק בהשראת ${trend.artist}: ${trend.hookText}`,
    captionEn: options.captionEn || `${trend.hookText} — ShiBass take`,
    remixFrom: {
      trendId: trend.id,
      artist: trend.artist,
      outlierLabel: trend.outlierLabel,
      keyStrategy: trend.keyStrategy,
    },
    ...options,
  });
}

module.exports = {
  TEMPLATES,
  listTemplates,
  createCampaignFromTemplate,
  createFromRadarIdea,
};
