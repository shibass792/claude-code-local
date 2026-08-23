const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { OUTPUT_DIR, ensureDir } = require('./store');

const execFileAsync = promisify(execFile);

const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1920;
const DEFAULT_FPS = 30;

function resolveBinary(name) {
  const override = process.env[`${name.toUpperCase()}_PATH`];
  return override && override.trim() ? override.trim() : name;
}

async function runTool(bin, args, timeoutMs = 120000) {
  const { stdout, stderr } = await execFileAsync(bin, args, {
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  return { stdout: stdout.toString(), stderr: stderr.toString() };
}

async function probeMedia(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Audio file not found: ${filePath ?? '(empty)'}`);
  }

  const ffprobe = resolveBinary('ffprobe');
  const { stdout } = await runTool(ffprobe, [
    '-v',
    'error',
    '-show_entries',
    'format=duration:stream=codec_type,codec_name,width,height',
    '-of',
    'json',
    filePath,
  ]);

  const parsed = JSON.parse(stdout || '{}');
  const duration = Number(parsed.format?.duration ?? 0);
  const audioStream = (parsed.streams ?? []).find((stream) => stream.codec_type === 'audio');

  return {
    path: path.resolve(filePath),
    durationSec: Number.isFinite(duration) ? duration : 0,
    codec: audioStream?.codec_name ?? 'unknown',
  };
}

function buildShowwavesFilter(width, height, fps) {
  return `[0:a]showwaves=s=${width}x${height}:mode=cline:rate=${fps}:colors=0x6366F1|0x22D3EE,format=yuv420p[v]`;
}

function buildOutputName(prefix) {
  return `${prefix}_${Date.now()}.mp4`;
}

async function renderVerticalReel({
  audioPath,
  hook = '',
  outputDir = path.join(OUTPUT_DIR, 'renders'),
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  fps = DEFAULT_FPS,
  filePrefix = 'reels_render',
} = {}) {
  if (!audioPath || typeof audioPath !== 'string') {
    throw new Error('audioPath is required');
  }

  const resolvedAudio = path.resolve(audioPath);
  const probe = await probeMedia(resolvedAudio);
  ensureDir(outputDir);

  const outputPath = path.join(outputDir, buildOutputName(filePrefix));
  const ffmpeg = resolveBinary('ffmpeg');
  const filter = buildShowwavesFilter(width, height, fps);
  const args = [
    '-y',
    '-i',
    resolvedAudio,
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-map',
    '0:a',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(fps),
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-movflags',
    '+faststart',
    outputPath,
  ];

  await runTool(ffmpeg, args, 180000);

  if (!fs.existsSync(outputPath)) {
    throw new Error('FFmpeg finished without writing an output file');
  }

  const stats = fs.statSync(outputPath);
  return {
    success: true,
    mock: false,
    engine: 'ffmpeg',
    outputPath,
    relativePath: path.relative(path.join(__dirname, '..'), outputPath).replace(/\\/g, '/'),
    width,
    height,
    fps,
    durationSec: probe.durationSec,
    sizeBytes: stats.size,
    hook: hook || null,
    audioPath: resolvedAudio,
    createdAt: new Date().toISOString(),
  };
}

async function getEngineHealth() {
  const ffmpeg = resolveBinary('ffmpeg');
  const ffprobe = resolveBinary('ffprobe');

  try {
    const ffmpegInfo = await runTool(ffmpeg, ['-version'], 8000);
    const firstLine = ffmpegInfo.stdout.split('\n')[0] ?? '';
    await runTool(ffprobe, ['-version'], 8000);
    return {
      configured: true,
      live: true,
      mock: false,
      label: 'FFmpeg 9:16 video renderer',
      version: firstLine.trim(),
    };
  } catch (error) {
    return {
      configured: false,
      live: false,
      mock: false,
      label: 'FFmpeg 9:16 video renderer',
      error: error instanceof Error ? error.message : 'ffmpeg missing',
    };
  }
}

module.exports = {
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  DEFAULT_FPS,
  probeMedia,
  renderVerticalReel,
  getEngineHealth,
};
