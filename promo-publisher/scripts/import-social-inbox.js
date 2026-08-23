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
const {
  PENDING_DB,
  readJson,
  writeJson,
  resolveFromRoot,
} = require('../modules/store');

const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.mkv']);

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

function main() {
  const { inbox } = parseArgs(process.argv);
  const queue = readJson(PENDING_DB, []);
  const existingPaths = new Set(queue.map((item) => item.sourcePath || item.videoPath));

  const added = [];
  for (const absPath of listVideos(inbox)) {
    if (existingPaths.has(absPath)) {
      continue;
    }
    const id = stableId(absPath);
    const title = path.basename(absPath, path.extname(absPath));
    added.push({
      id,
      title,
      sourcePath: absPath,
      videoPath: absPath,
      duration: null,
      format: 'Reels / TikTok (9:16)',
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
    console.log(`  + ${item.id} ${item.title}`);
  }
}

main();
