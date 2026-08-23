#!/usr/bin/env node
/**
 * Scan H:\shibass-ai\10_OUTPUTS\social for new videos and enqueue for approval.
 *
 * Usage:
 *   node scripts/import-social-inbox.js
 *   node scripts/import-social-inbox.js --inbox "D:\renders\social"
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { PENDING_DB, readJson, writeJson } = require('../modules/store');

const execFileAsync = promisify(execFile);

const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.mkv']);

/**
 * Read the real duration and frame size instead of assuming 9:16.
 */
async function probeVideo(filePath) {
  try {
    const { stdout } = await execFileAsync(process.env.FFPROBE_PATH || 'ffprobe', [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);
    const probe = JSON.parse(stdout);
    const video = (probe.streams ?? []).find((stream) => stream.codec_type === 'video');
    const seconds = Number(probe.format?.duration ?? 0);

    return {
      duration: seconds > 0
        ? `00:${String(Math.round(seconds)).padStart(2, '0')}`
        : null,
      format: video
        ? `Reels / TikTok (${video.width}x${video.height})`
        : 'Reels / TikTok (9:16)',
      width: video?.width ?? null,
      height: video?.height ?? null,
    };
  } catch {
    return { duration: null, format: 'Reels / TikTok (9:16)', width: null, height: null };
  }
}

function parseArgs(argv) {
  const args = { inbox: process.env.SHIBASS_SOCIAL_INBOX || 'H:\\shibass-ai\\10_OUTPUTS\\social' };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--inbox' && argv[i + 1]) {
      args.inbox = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function stableId(filePath) {
  return `camp_${crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 10)}`;
}

function listVideos(inboxDir) {
  if (!fs.existsSync(inboxDir)) {
    return [];
  }
  return fs
    .readdirSync(inboxDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && VIDEO_EXT.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(inboxDir, entry.name));
}

async function main() {
  const { inbox } = parseArgs(process.argv);
  const queue = readJson(PENDING_DB, []);
  const existingPaths = new Set(queue.map((item) => item.sourcePath || item.videoPath));

  const added = [];
  for (const absPath of listVideos(inbox)) {
    if (existingPaths.has(absPath)) {
      continue;
    }

    const probe = await probeVideo(absPath);
    added.push({
      id: stableId(absPath),
      title: path.basename(absPath, path.extname(absPath)),
      sourcePath: absPath,
      videoPath: absPath,
      duration: probe.duration,
      format: probe.format,
      templateId: null,
      watched: false,
      captionHe: '',
      captionEn: '',
      hashtags: '#ShiBass #Psytrance #ElectronicMusic',
      platforms: ['instagram', 'tiktok'],
      importedAt: new Date().toISOString(),
    });
  }

  if (added.length === 0) {
    console.log(`No new videos in ${inbox}`);
    return;
  }

  writeJson(PENDING_DB, [...added, ...queue]);
  console.log(`Imported ${added.length} video(s) from ${inbox}`);
  for (const item of added) {
    console.log(`  + ${item.id} ${item.title} ${item.duration ?? ''} ${item.format}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
