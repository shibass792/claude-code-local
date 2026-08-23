#!/usr/bin/env node
'use strict';

/**
 * CLI reel render — the same real pipeline the desktop app uses.
 *
 *   node scripts/render-reel.js track.wav
 *   node scripts/render-reel.js track.wav --style waves --duration 20 --start 45
 *   node scripts/render-reel.js track.wav --hook "שמעתם את הדרופ הזה?"
 *   node scripts/render-reel.js track.wav --campaign     # also writes captions via AI
 */

require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });

const renderer = require('../modules/renderer');
const approval = require('../modules/approval-publisher');

function readFlag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const audioPath = process.argv[2];

if (!audioPath || audioPath.startsWith('--')) {
  console.error('Usage: node scripts/render-reel.js <audio-file> [--style bars|waves|spectrum|cqt]');
  console.error('                                   [--duration 15] [--start 0] [--hook "text"]');
  console.error('                                   [--cover cover.jpg] [--campaign]');
  process.exit(1);
}

const options = {
  audioPath,
  style: readFlag('style', 'bars'),
  durationSec: Number(readFlag('duration', renderer.DEFAULT_DURATION)),
  startSec: Number(readFlag('start', 0)),
  coverPath: readFlag('cover'),
};

(async () => {
  const health = await renderer.checkHealth();
  if (!health.ok) {
    console.error('ffmpeg/ffprobe not found in PATH. Install FFmpeg first.');
    process.exit(1);
  }
  console.log(`encoder: ${health.encoder}`);

  if (process.argv.includes('--campaign')) {
    const { campaign, render, aiError } = await approval.createCampaignFromAudio({
      ...options,
      onProgress: (p) =>
        p.percent != null
          ? process.stderr.write(`render ${p.percent}%\r`)
          : process.stderr.write(`stage: ${p.stage}\n`),
    });

    process.stderr.write('\n');
    console.log(`campaign: ${campaign.id}`);
    console.log(`video:    ${render.relativePath}`);
    console.log(`caption:  ${campaign.captionHe || '(none — AI unavailable)'}`);
    if (aiError) {
      console.log(`⚠ AI:     ${aiError}`);
    }
    return;
  }

  const render = await renderer.renderReel({
    ...options,
    hook: readFlag('hook', ''),
    subtitle: readFlag('subtitle', ''),
    onProgress: (p) => process.stderr.write(`render ${p.percent}%\r`),
  });

  process.stderr.write('\n');
  console.log(`output:   ${render.outputPath}`);
  console.log(`format:   ${render.width}x${render.height} @ ${render.fps}fps ${render.encoder}`);
  console.log(`duration: ${render.durationSec}s`);
  console.log(`size:     ${(render.sizeBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`took:     ${render.renderMs}ms`);
})().catch((error) => {
  console.error(`\n${error.message}`);
  if (error.stderr) {
    console.error(error.stderr);
  }
  process.exit(1);
});
