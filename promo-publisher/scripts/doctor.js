#!/usr/bin/env node
'use strict';

/**
 * Probe every real integration and print what is actually reachable.
 * Run this before blaming the app: it distinguishes "not configured" from
 * "configured but the service is down".
 */

require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });

const approval = require('../modules/approval-publisher');

const VERIFY = process.argv.includes('--verify');

function line(label, ok, detail) {
  const mark = ok ? '✓' : '✗';
  console.log(`${mark} ${label.padEnd(28)} ${detail ?? ''}`.trimEnd());
}

(async () => {
  console.log('ShiBass Social Studio — integration doctor\n');

  const health = await approval.getConnectionHealth({ verify: VERIFY });

  line('AI (hooks/captions)', health.ai.ok, health.ai.ok
    ? `${health.ai.endpoint} · model=${health.ai.model}`
    : health.ai.error);

  line('FFmpeg renderer', health.renderer.ok, health.renderer.ok
    ? `encoder=${health.renderer.encoder} · ${health.renderer.resolution}`
    : health.renderer.error);

  line('yt-dlp radar', health.radar.ok, health.radar.ok
    ? `version ${health.radar.version}`
    : health.radar.error);

  line('Music library index', health.library.ok, health.library.detail);

  line('Meta Graph API', health.meta.ok ?? health.meta.configured,
    health.meta.error ?? (health.meta.igUsername ? `@${health.meta.igUsername}` : `configured=${health.meta.configured}`));

  line('TikTok API', health.tiktok.ok ?? health.tiktok.configured,
    health.tiktok.error ?? (health.tiktok.username ? `@${health.tiktok.username} · mode=${health.tiktok.mode}` : `configured=${health.tiktok.configured} · mode=${health.tiktok.mode}`));

  line('Public URL tunnel', health.tunnel.configured,
    health.tunnel.configured ? 'CLOUDFLARE_TUNNEL_TOKEN set' : 'not set — Meta/TikTok cannot fetch local files');

  if (health.dryRun) {
    console.log('\n⚠ PUBLISH_DRY_RUN=1 — publishing is disabled, no API calls will be made.');
  }

  if (!VERIFY) {
    console.log('\nTip: run with --verify to spend one real API call per platform and confirm tokens.');
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
