'use strict';

/**
 * ReelHook — real hook/caption generation.
 *
 * Every string returned here comes back from an actual model round-trip via
 * modules/ai.js. There is no static hook table: if the engine is unreachable the
 * call fails loudly so the operator knows nothing was generated.
 */

const ai = require('./ai');

const MAX_HOOK_LENGTH = 120;
const DEFAULT_HOOK_COUNT = 3;

const SYSTEM_PROMPT = [
  'You are ReelHook, a short-form video strategist for the psytrance producer ShiBass.',
  'You write scroll-stopping opening hooks for Instagram Reels and TikTok.',
  'Rules:',
  '- A hook must land in under 3 seconds when spoken aloud.',
  '- Write Hebrew that sounds native to Israeli music producers, not translated.',
  '- Never invent release dates, streaming numbers, or chart positions.',
  '- Reply with JSON only. No commentary, no markdown fences.',
].join('\n');

function clean(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^["'`\s]+|["'`\s]+$/g, '')
    .trim();
}

function truncate(value, max = MAX_HOOK_LENGTH) {
  const text = clean(value);
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function normalizeHashtags(value) {
  const raw = Array.isArray(value) ? value.join(' ') : String(value ?? '');
  const tags = raw
    .split(/[\s,]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
    .filter((tag) => tag.length > 1);

  return [...new Set(tags)].slice(0, 12).join(' ');
}

function describeTrack(track = {}) {
  const bits = [
    track.title ? `Title: ${track.title}` : null,
    track.bpm ? `BPM: ${track.bpm}` : null,
    track.key ? `Musical key: ${track.key}` : null,
    track.genre ? `Genre: ${track.genre}` : 'Genre: progressive psytrance',
    track.styleHint ? `Video style: ${track.styleHint}` : null,
    track.notes ? `Extra context: ${track.notes}` : null,
  ].filter(Boolean);

  return bits.join('\n');
}

/**
 * Real competitor posts from the radar become grounding context, so hooks are
 * shaped by observed data instead of guesswork.
 */
function describeTrends(trends = []) {
  if (!trends.length) {
    return '';
  }

  const lines = trends.slice(0, 5).map((trend, index) => {
    const parts = [
      `${index + 1}. ${trend.artist ?? 'unknown artist'}`,
      trend.outlierLabel ? `(${trend.outlierLabel} over their average)` : null,
      trend.hookText ? `hook: "${trend.hookText}"` : null,
      trend.keyStrategy ? `why it worked: ${trend.keyStrategy}` : null,
    ].filter(Boolean);
    return parts.join(' — ');
  });

  return ['', 'Recent verified viral posts from the watchlist:', ...lines].join('\n');
}

function normalizeHooks(payload, count) {
  const list = Array.isArray(payload) ? payload : payload?.hooks;

  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('AI response did not contain a "hooks" array');
  }

  const hooks = list
    .map((item) => {
      if (typeof item === 'string') {
        return { he: truncate(item), en: '', why: '' };
      }
      return {
        he: truncate(item.he ?? item.hebrew ?? item.hook ?? ''),
        en: truncate(item.en ?? item.english ?? ''),
        why: clean(item.why ?? item.reason ?? item.strategy ?? ''),
      };
    })
    .filter((hook) => hook.he || hook.en);

  if (!hooks.length) {
    throw new Error('AI response contained no usable hook text');
  }

  return hooks.slice(0, count);
}

function buildHooksPrompt({ track, trends, count }) {
  return [
    `Write ${count} different opening hooks for a 9:16 vertical video.`,
    '',
    describeTrack(track),
    describeTrends(trends),
    '',
    `Return exactly ${count} entries in this JSON shape:`,
    '{"hooks":[{"he":"Hebrew hook","en":"English hook","why":"one short line on why it stops the scroll"}]}',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/**
 * Generate `count` hooks for a track. Throws when the engine is down.
 *
 * Smaller models often return fewer entries than asked for, so top up with
 * bounded extra requests rather than silently handing back one hook for a
 * button that promises three. Duplicates are dropped.
 */
async function generateHooks({
  track = {},
  trends = [],
  count = DEFAULT_HOOK_COUNT,
  attempts = Number(process.env.AI_HOOK_ATTEMPTS ?? 2),
} = {}) {
  const safeCount = Math.max(1, Math.min(Number(count) || DEFAULT_HOOK_COUNT, 6));
  const maxAttempts = Math.max(1, Math.min(Number(attempts) || 1, 4));

  const collected = [];
  const seen = new Set();
  let model = null;
  let provider = null;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts && collected.length < safeCount; attempt += 1) {
    const remaining = safeCount - collected.length;
    const prompt = buildHooksPrompt({
      track,
      trends,
      count: attempt === 0 ? safeCount : remaining,
    });

    try {
      const result = await ai.chatJson({ system: SYSTEM_PROMPT, prompt, temperature: 0.95 });
      model = result.model;
      provider = result.provider;

      for (const hook of normalizeHooks(result.data, safeCount)) {
        const key = (hook.he || hook.en).toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          collected.push(hook);
        }
      }
    } catch (error) {
      lastError = error;
      // A later attempt failing is tolerable once we already have hooks.
      if (!collected.length) {
        throw error;
      }
      break;
    }
  }

  if (!collected.length) {
    throw lastError ?? new Error('AI returned no hooks');
  }

  return {
    hooks: collected.slice(0, safeCount),
    requested: safeCount,
    model,
    provider,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generate a full caption set (Hebrew + English + hashtags) for a campaign.
 */
async function generateCaptions({ track = {}, hook = '', trends = [] } = {}) {
  const prompt = [
    'Write the caption package for one Instagram Reel / TikTok post.',
    '',
    describeTrack(track),
    hook ? `Chosen hook: ${hook}` : '',
    describeTrends(trends),
    '',
    'Return exactly this JSON shape:',
    '{"captionHe":"Hebrew caption with 1-2 emoji","captionEn":"English caption","hashtags":"#tag1 #tag2"}',
    'Keep each caption under 220 characters. Use 6-10 hashtags that match psytrance and music production.',
  ]
    .filter(Boolean)
    .join('\n');

  const { data, model, provider } = await ai.chatJson({
    system: SYSTEM_PROMPT,
    prompt,
    temperature: 0.8,
  });

  const captionHe = clean(data.captionHe ?? data.he ?? '');
  const captionEn = clean(data.captionEn ?? data.en ?? '');

  if (!captionHe && !captionEn) {
    throw new Error('AI response contained no caption text');
  }

  return {
    captionHe,
    captionEn,
    hashtags: normalizeHashtags(data.hashtags ?? data.tags ?? ''),
    model,
    provider,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Rewrite one existing hook — powers the "change hook" button.
 */
async function remixHook({ currentHook, track = {}, trends = [] } = {}) {
  const prompt = [
    'Rewrite this hook so it keeps the same promise but opens differently.',
    `Current hook: ${clean(currentHook) || '(none yet)'}`,
    '',
    describeTrack(track),
    describeTrends(trends),
    '',
    'Return exactly this JSON shape:',
    '{"hooks":[{"he":"Hebrew hook","en":"English hook","why":"what changed"}]}',
  ]
    .filter(Boolean)
    .join('\n');

  const { data, model, provider } = await ai.chatJson({
    system: SYSTEM_PROMPT,
    prompt,
    temperature: 1,
  });

  const [hook] = normalizeHooks(data, 1);
  return { ...hook, model, provider, generatedAt: new Date().toISOString() };
}

module.exports = {
  DEFAULT_HOOK_COUNT,
  MAX_HOOK_LENGTH,
  SYSTEM_PROMPT,
  clean,
  truncate,
  normalizeHashtags,
  describeTrack,
  describeTrends,
  normalizeHooks,
  buildHooksPrompt,
  generateHooks,
  generateCaptions,
  remixHook,
};
