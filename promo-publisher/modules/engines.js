'use strict';

const metaPublisher = require('./publishers/meta');
const tiktokPublisher = require('./publishers/tiktok');
const { probeFfmpeg } = require('./render-engine');
const { probeOllama } = require('./hook-generator');
const { loadIndex, defaultRoots } = require('./media-library');

/**
 * Live engine health — never returns a static "200 OK" template.
 * Instagram path = Meta Graph API only (no InstaPy / Selenium botting).
 */
async function getEnginesStatus() {
  const [ffmpeg, ollama] = await Promise.all([probeFfmpeg(), probeOllama()]);
  const index = loadIndex();
  const mediaRoots = defaultRoots();

  const engines = {
    ffmpeg: {
      ok: ffmpeg.ok,
      label: 'FFmpeg Reel Renderer',
      detail: ffmpeg.version || ffmpeg.error || '',
    },
    ollama: {
      ok: ollama.ok,
      label: 'ReelHook AI (Ollama)',
      detail: ollama.ok
        ? `models: ${(ollama.models || []).slice(0, 6).join(', ') || 'none'}`
        : ollama.error || 'offline',
    },
    metaGraph: {
      ok: metaPublisher.isConfigured(),
      label: 'Instagram / Facebook (Meta Graph API)',
      detail: metaPublisher.isConfigured()
        ? 'credentials present'
        : 'set META_ACCESS_TOKEN + META_IG_USER_ID / META_PAGE_ID',
      note: 'InstaPy/Selenium bots are not supported — official Graph API only',
    },
    tiktok: {
      ok: tiktokPublisher.isConfigured(),
      label: 'TikTok Content Posting API',
      detail: tiktokPublisher.isConfigured()
        ? `mode=${process.env.TIKTOK_PUBLISH_MODE || 'draft'}`
        : 'set TIKTOK_ACCESS_TOKEN',
    },
    mediaIndex: {
      ok: Boolean(index.scannedAt),
      label: 'ShiBass Universal Player Index',
      detail: index.scannedAt
        ? `${index.counts?.total || 0} files · scanned ${index.scannedAt}`
        : `אין אינדקס — הרץ סריקה (${mediaRoots.length} שורשים זמינים)`,
      roots: mediaRoots,
    },
  };

  const ready = Object.values(engines).filter((e) => e.ok).length;
  const total = Object.keys(engines).length;

  return {
    ok: true,
    source: 'live-probe',
    statusCode: 200,
    ready,
    total,
    message: `${ready}/${total} engines ready`,
    engines,
    policy: {
      instagram: 'meta-graph-api',
      instapy: 'disabled',
      reason:
        'Browser automation / InstaPy violates Instagram ToS and is blocked. Use Meta Content Publishing API with tokens in config/.env.',
    },
    checkedAt: new Date().toISOString(),
  };
}

function formatStatusLog(status) {
  const lines = [
    `[SYSTEM] ShiBass Social Studio API — live probes (not a simulator).`,
    `[ENGINES] FFmpeg ${status.engines.ffmpeg.ok ? 'OK' : 'MISSING'} · Ollama ${status.engines.ollama.ok ? 'OK' : 'OFFLINE'} · Meta Graph ${status.engines.metaGraph.ok ? 'READY' : 'NEEDS TOKENS'} · TikTok ${status.engines.tiktok.ok ? 'READY' : 'NEEDS TOKENS'}`,
    `[STATUS] ${status.statusCode} — ${status.message}`,
    `[POLICY] Instagram = Meta Graph API only. InstaPy/Selenium = disabled.`,
    `[MEDIA] ${status.engines.mediaIndex.detail}`,
    `[CHECKED] ${status.checkedAt}`,
  ];
  return lines.join('\n');
}

module.exports = {
  getEnginesStatus,
  formatStatusLog,
};
