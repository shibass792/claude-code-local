'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { OUTPUT_DIR, ensureDir } = require('./store');
const { resolveSafePath } = require('./media-library');

function whichBinary(name) {
  const fromEnv = process.env[`${name.toUpperCase()}_PATH`];
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }
  return name;
}

function runCommand(bin, args, { timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({ ok: false, code: null, stdout, stderr: stderr + '\n[timeout]' });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout, stderr: String(err.message || err) });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

async function probeFfmpeg() {
  const ffmpeg = whichBinary('ffmpeg');
  const result = await runCommand(ffmpeg, ['-version'], { timeoutMs: 10000 });
  const firstLine = (result.stdout || result.stderr || '').split(/\r?\n/)[0] || '';
  return {
    ok: result.ok,
    binary: ffmpeg,
    version: firstLine,
    error: result.ok ? null : result.stderr || 'ffmpeg not available',
  };
}

/**
 * Render a 9:16 1080x1920 reel from audio (spectrum) or video (pad/crop).
 * Uses real FFmpeg — no mock template.
 */
async function renderReel(options = {}) {
  const startedAt = Date.now();
  const ffmpegProbe = await probeFfmpeg();
  if (!ffmpegProbe.ok) {
    return {
      success: false,
      error: 'FFmpeg לא זמין — התקן ffmpeg והוסף ל-PATH',
      engines: { ffmpeg: ffmpegProbe },
    };
  }

  const audioPath = resolveSafePath(options.audioPath) || null;
  const videoPath = resolveSafePath(options.videoPath) || null;
  const hook = String(options.hook || 'ShiBass · New Drop').slice(0, 120);
  const durationSec = Math.min(Math.max(Number(options.durationSec || 15), 5), 60);
  const fps = Number(options.fps || 60);

  if (!audioPath && !videoPath) {
    return {
      success: false,
      error: 'נדרש audioPath או videoPath בתוך שורשי המדיה המאונדקסים',
    };
  }

  const jobId = `reels_render_${Date.now()}`;
  const outDir = path.join(OUTPUT_DIR, 'reels');
  ensureDir(outDir);
  const outputPath = path.join(outDir, `${jobId}.mp4`);

  const drawtext =
    `drawtext=text='${hook.replace(/:/g, '\\:').replace(/'/g, '')}':` +
    `fontsize=42:fontcolor=white:borderw=3:bordercolor=black@0.6:` +
    `x=(w-text_w)/2:y=h*0.12:enable='lt(t,4)'`;

  let args;
  if (videoPath) {
    args = [
      '-y',
      '-i',
      videoPath,
      ...(audioPath ? ['-i', audioPath] : []),
      '-t',
      String(durationSec),
      '-vf',
      `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${drawtext},fps=${fps}`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-shortest',
      '-movflags',
      '+faststart',
      outputPath,
    ];
  } else {
    // Audio → animated spectrum on dark 9:16 canvas
    args = [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=0x0a0e17:s=1080x1920:d=${durationSec}:r=${fps}`,
      '-i',
      audioPath,
      '-filter_complex',
      `[1:a]showwaves=s=1080x720:mode=cline:rate=${fps}:colors=00e5ff[wave];` +
        `[0:v][wave]overlay=0:600,${drawtext}[vout]`,
      '-map',
      '[vout]',
      '-map',
      '1:a',
      '-t',
      String(durationSec),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-shortest',
      '-movflags',
      '+faststart',
      outputPath,
    ];
  }

  const result = await runCommand(ffmpegProbe.binary, args, {
    timeoutMs: 10 * 60 * 1000,
  });

  if (!result.ok || !fs.existsSync(outputPath)) {
    return {
      success: false,
      error: 'רינדור FFmpeg נכשל',
      detail: (result.stderr || '').slice(-2000),
      args,
      engines: { ffmpeg: ffmpegProbe },
    };
  }

  const st = fs.statSync(outputPath);
  const relative = path.relative(path.join(__dirname, '..'), outputPath).replace(/\\/g, '/');

  return {
    success: true,
    jobId,
    outputPath,
    relativePath: relative,
    size: st.size,
    width: 1080,
    height: 1920,
    fps,
    durationSec,
    hook,
    audioPath,
    videoPath,
    elapsedMs: Date.now() - startedAt,
    engines: { ffmpeg: ffmpegProbe },
    source: 'ffmpeg-live',
  };
}

module.exports = {
  probeFfmpeg,
  renderReel,
  runCommand,
  whichBinary,
};
