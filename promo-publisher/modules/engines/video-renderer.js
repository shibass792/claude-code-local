const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { OUTPUT_DIR, ROOT, ensureDir } = require('../store');
const { appendLog } = require('./creation-log');

const RENDER_DIR = path.join(OUTPUT_DIR, 'renders');

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        const error = new Error(`${command} exited ${code}`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code;
        reject(error);
      }
    });
  });
}

async function getFfmpegInfo() {
  try {
    const result = await runCommand('ffmpeg', ['-version']);
    const firstLine = result.stdout.split('\n')[0] ?? result.stderr.split('\n')[0] ?? '';
    return { ok: true, version: firstLine.trim(), bin: 'ffmpeg' };
  } catch (error) {
    return { ok: false, error: error.message, bin: 'ffmpeg' };
  }
}

function findFont() {
  const candidates = [
    process.env.REEL_FONT,
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
    'C:\\Windows\\Fonts\\arial.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
  ].filter(Boolean);

  return candidates.find((fontPath) => fs.existsSync(fontPath)) ?? null;
}

function escapeDrawtext(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/\n/g, ' ');
}

function resolveAudioPath(audioPath) {
  if (!audioPath) {
    return null;
  }
  if (path.isAbsolute(audioPath) && fs.existsSync(audioPath)) {
    return audioPath;
  }
  const fromRoot = path.resolve(ROOT, audioPath);
  return fs.existsSync(fromRoot) ? fromRoot : null;
}

async function probeDurationSeconds(audioPath) {
  try {
    const result = await runCommand('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ]);
    const seconds = Number.parseFloat(result.stdout.trim());
    return Number.isFinite(seconds) ? seconds : null;
  } catch {
    return null;
  }
}

async function renderVerticalReel(options = {}) {
  const ffmpeg = await getFfmpegInfo();
  if (!ffmpeg.ok) {
    const failure = {
      ok: false,
      error: `ffmpeg is not available: ${ffmpeg.error}`,
    };
    appendLog({
      engine: 'render',
      event: 'failed',
      level: 'error',
      message: failure.error,
    });
    return failure;
  }

  ensureDir(RENDER_DIR);
  const id = Date.now();
  const outputName = `reels_render_${id}.mp4`;
  const outputPath = path.join(RENDER_DIR, outputName);
  const hook = options.hook ?? 'ShiBass Progressive Psytrance';
  const requestedDuration = Number(options.durationSeconds) || 8;
  const audioPath = resolveAudioPath(options.audioPath);
  const font = findFont();
  const fps = Number(options.fps) || 30;
  const width = 1080;
  const height = 1920;

  appendLog({
    engine: 'render',
    event: 'start',
    message: `Rendering 9:16 ${width}x${height} @ ${fps}fps`,
    data: {
      hook,
      audioPath: audioPath ?? null,
      ffmpeg: ffmpeg.version,
    },
  });

  const args = ['-y'];
  let duration = Math.min(Math.max(requestedDuration, 3), 20);

  if (audioPath) {
    const probed = await probeDurationSeconds(audioPath);
    if (probed) {
      duration = Math.min(probed, duration);
    }
    args.push('-i', audioPath);
    args.push('-f', 'lavfi', '-i', `color=c=0x0b0d14:s=${width}x${height}:d=${duration}:r=${fps}`);
  } else {
    args.push('-f', 'lavfi', '-i', `sine=frequency=142:sample_rate=44100:duration=${duration}`);
    args.push('-f', 'lavfi', '-i', `color=c=0x0b0d14:s=${width}x${height}:d=${duration}:r=${fps}`);
  }

  const overlay = font
    ? `,drawtext=fontfile='${escapeDrawtext(font)}':text='${escapeDrawtext(hook)}':fontcolor=white:fontsize=56:x=(w-text_w)/2:y=220:box=1:boxcolor=black@0.45:boxborderw=16`
    : '';

  args.push(
    '-filter_complex',
    `[0:a]showwaves=s=${width}x${Math.floor(height * 0.55)}:mode=cline:rate=${fps}:colors=0xFF7A18[wave];[1:v][wave]overlay=0:${Math.floor(height * 0.28)}${overlay}[v]`,
    '-map',
    '[v]',
    '-map',
    '0:a',
    '-t',
    String(duration),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-r',
    String(fps),
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    outputPath,
  );

  try {
    await runCommand('ffmpeg', args);
  } catch (error) {
    const failure = {
      ok: false,
      error: error.message,
      stderr: String(error.stderr ?? '').slice(-800),
    };
    appendLog({
      engine: 'render',
      event: 'failed',
      level: 'error',
      message: failure.error,
      data: { stderr: failure.stderr },
    });
    return failure;
  }

  if (!fs.existsSync(outputPath)) {
    const failure = { ok: false, error: 'ffmpeg finished but output file is missing' };
    appendLog({
      engine: 'render',
      event: 'failed',
      level: 'error',
      message: failure.error,
    });
    return failure;
  }

  const stat = fs.statSync(outputPath);
  const relativePath = path.relative(ROOT, outputPath).replace(/\\/g, '/');
  const result = {
    ok: true,
    id: String(id),
    outputPath,
    relativePath,
    bytes: stat.size,
    width,
    height,
    fps,
    durationSeconds: duration,
    hook,
    audioPath: audioPath ?? null,
    usedTone: !audioPath,
    ffmpeg: ffmpeg.version,
  };

  appendLog({
    engine: 'render',
    event: 'success',
    message: `Rendered ${relativePath} (${width}x${height} ${fps}fps, ${stat.size} bytes)`,
    data: {
      relativePath,
      bytes: stat.size,
      usedTone: result.usedTone,
    },
  });

  return result;
}

module.exports = {
  RENDER_DIR,
  runCommand,
  getFfmpegInfo,
  findFont,
  resolveAudioPath,
  renderVerticalReel,
};
