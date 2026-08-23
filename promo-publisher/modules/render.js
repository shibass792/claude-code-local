const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { OUTPUT_DIR, MEDIA_DIR, ensureDir, resolveFromRoot } = require('./store');
const { appendLog, snapshotState } = require('./creation-log');
const { probeFfmpeg, runCommand } = require('./engines');
const approval = require('./approval-publisher');

const execFileAsync = promisify(execFile);

function sanitizeName(value) {
  return String(value ?? 'track')
    .replace(/[^\w.\- ()\[\]]+/g, '_')
    .slice(0, 80) || 'track';
}

function resolveAudioPath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return null;
  }
  if (path.isAbsolute(inputPath) && fs.existsSync(inputPath)) {
    return inputPath;
  }
  const fromRoot = resolveFromRoot(inputPath);
  if (fromRoot && fs.existsSync(fromRoot)) {
    return fromRoot;
  }
  return null;
}

async function probeAudio(audioPath) {
  const result = await runCommand('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration:stream=codec_type,codec_name,sample_rate',
    '-of',
    'json',
    audioPath,
  ]);
  if (!result.ok) {
    return { duration: null, raw: result.stderr };
  }
  try {
    const parsed = JSON.parse(result.stdout || '{}');
    return {
      duration: Number(parsed.format?.duration) || null,
      streams: parsed.streams ?? [],
    };
  } catch {
    return { duration: null };
  }
}

function buildDrawText(title) {
  const escaped = String(title)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .slice(0, 80);
  return `drawtext=text='${escaped}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=220`;
}

async function renderVerticalReel({
  audioPath,
  title,
  hook,
  durationSec = 30,
  fps = 30,
  enqueue = true,
} = {}) {
  const ffmpeg = await probeFfmpeg();
  if (!ffmpeg.available) {
    const error = 'FFmpeg is not installed — cannot render a real 9:16 video';
    appendLog({ source: 'render', level: 'error', message: error });
    return { success: false, mock: false, error };
  }

  const resolved = resolveAudioPath(audioPath);
  if (!resolved) {
    const error = `Audio file not found: ${audioPath ?? '(empty)'}`;
    appendLog({ source: 'render', level: 'error', message: error });
    return { success: false, mock: false, error };
  }

  const info = await probeAudio(resolved);
  const clipSeconds = Math.max(3, Math.min(Number(durationSec) || 30, info.duration || 30, 59));
  const stamp = Date.now();
  const outDir = path.join(OUTPUT_DIR, 'renders');
  ensureDir(outDir);
  const fileName = `reels_render_${stamp}.mp4`;
  const outputPath = path.join(outDir, fileName);
  const displayTitle = title || path.parse(resolved).name;
  const hookText = hook || `🔥 ${displayTitle} - Out Now!`;

  const filter = [
    '[0:a]showwaves=s=1080x720:mode=cline:rate=25:colors=0xA78BFA[wv]',
    'color=c=0x0c0e14:s=1080x1920:r=30[bg]',
    '[bg][wv]overlay=0:600[base]',
    `[base]${buildDrawText(displayTitle)}[v]`,
  ].join(';');

  const args = [
    '-y',
    '-i',
    resolved,
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-map',
    '0:a',
    '-t',
    String(clipSeconds),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'veryfast',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-r',
    String(fps),
    outputPath,
  ];

  appendLog({
    source: 'render',
    message: `Rendering 9:16 from ${path.basename(resolved)} (${clipSeconds}s)`,
    audio: resolved,
    hook: hookText,
  });

  try {
    await execFileAsync('ffmpeg', args, { timeout: 120000, windowsHide: true });
  } catch (error) {
    const fallbackArgs = [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=0x111827:s=1080x1920:d=${clipSeconds}:r=${fps}`,
      '-i',
      resolved,
      '-vf',
      buildDrawText(displayTitle),
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-t',
      String(clipSeconds),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      outputPath,
    ];
    try {
      await execFileAsync('ffmpeg', fallbackArgs, { timeout: 120000, windowsHide: true });
    } catch (fallbackError) {
      const message = fallbackError.stderr?.toString() || fallbackError.message;
      appendLog({ source: 'render', level: 'error', message: `FFmpeg failed: ${message}` });
      return { success: false, mock: false, error: message };
    }
  }

  if (!fs.existsSync(outputPath)) {
    return { success: false, mock: false, error: 'FFmpeg finished but output file is missing' };
  }

  const stat = fs.statSync(outputPath);
  const relativePath = path.relative(path.join(__dirname, '..'), outputPath).replace(/\\/g, '/');
  const campaign = {
    id: `camp_${stamp}`,
    title: displayTitle,
    videoPath: relativePath,
    duration: `00:${String(Math.round(clipSeconds)).padStart(2, '0')}`,
    format: 'Reels / TikTok (9:16 1080x1920)',
    watched: false,
    captionHe: hookText,
    captionEn: hookText,
    hashtags: '#Psytrance #ShiBass #ElectronicMusic',
    platforms: ['instagram', 'tiktok', 'facebook'],
    audioPath: resolved,
  };

  if (enqueue) {
    const queue = approval.getPendingQueue();
    queue.unshift(campaign);
    approval.savePendingQueue(queue);
  }

  const result = {
    success: true,
    mock: false,
    outputPath,
    relativePath,
    bytes: stat.size,
    width: 1080,
    height: 1920,
    fps,
    durationSec: clipSeconds,
    hook: hookText,
    audio: resolved,
    campaignId: campaign.id,
  };

  appendLog({
    source: 'render',
    message: `Rendered ${relativePath} (9:16 1080x1920 ${fps}fps, ${stat.size} bytes)`,
    ...result,
  });
  snapshotState({ lastRender: result });
  return result;
}

async function writeUploadedAudio(buffer, fileName) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Empty upload');
  }
  ensureDir(MEDIA_DIR);
  const safe = sanitizeName(fileName || `upload_${Date.now()}.wav`);
  const dest = path.join(MEDIA_DIR, safe);
  fs.writeFileSync(dest, buffer);
  return dest;
}

module.exports = {
  resolveAudioPath,
  probeAudio,
  renderVerticalReel,
  writeUploadedAudio,
};
