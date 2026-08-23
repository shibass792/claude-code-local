const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { OUTPUT_DIR, ensureDir } = require('../store');
const { appendLog } = require('../creation-log');

const execFileAsync = promisify(execFile);

function quoteDrawtext(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .slice(0, 80);
}

async function probeFfmpeg() {
  try {
    const { stdout, stderr } = await execFileAsync('ffmpeg', ['-version']);
    const blob = `${stdout}\n${stderr}`;
    const first = blob.split('\n')[0] ?? 'ffmpeg';
    return { configured: true, live: true, version: first.trim() };
  } catch (error) {
    return {
      configured: false,
      live: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stderr });
        return;
      }
      reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}

function writeSidecarSrt(outputMp4, hook) {
  const srtPath = outputMp4.replace(/\.mp4$/i, '.srt');
  const body = [
    '1',
    '00:00:00,000 --> 00:00:04,000',
    hook || 'ShiBass — Out Now',
    '',
  ].join('\n');
  fs.writeFileSync(srtPath, body, 'utf-8');
  return srtPath;
}

async function renderVerticalReel({ audioPath, hook, title }) {
  if (!audioPath || !fs.existsSync(audioPath)) {
    throw new Error('Audio file not found for render');
  }

  const ffmpeg = await probeFfmpeg();
  if (!ffmpeg.live) {
    appendLog('error', 'render', 'FFmpeg is not installed');
    throw new Error('FFmpeg is not installed — cannot render a real 9:16 reel');
  }

  const stamp = Date.now();
  const outDir = path.join(OUTPUT_DIR, 'renders');
  ensureDir(outDir);
  const outputPath = path.join(outDir, `reels_render_${stamp}.mp4`);
  const hookText = quoteDrawtext(hook || title || 'ShiBass');

  appendLog('info', 'render', `Rendering 9:16 from ${audioPath}`);

  const filter = [
    '[0:a]showwaves=s=1080x720:mode=cline:rate=30:colors=0xC084FC[wf]',
    'color=c=0x0c0e14:s=1080x1920:r=30[bg]',
    '[bg][wf]overlay=0:600[base]',
    `[base]drawtext=text='${hookText}':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=220:box=1:boxcolor=0x00000099[v]`,
  ].join(';');

  try {
    await runFfmpeg([
      '-y',
      '-i',
      audioPath,
      '-filter_complex',
      filter,
      '-map',
      '[v]',
      '-map',
      '0:a',
      '-shortest',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '30',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      outputPath,
    ]);
  } catch (waveError) {
    appendLog('warn', 'render', `Waveform/drawtext failed, falling back to color bed: ${waveError.message}`);
    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x12081f:s=1080x1920:r=30',
      '-i',
      audioPath,
      '-shortest',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      outputPath,
    ]);
  }

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1024) {
    throw new Error('Render finished but output file is missing or empty');
  }

  const srtPath = writeSidecarSrt(outputPath, hook || title);
  const relative = path.relative(path.join(__dirname, '../..'), outputPath).replace(/\\/g, '/');

  appendLog('success', 'render', `Rendered ${relative} (9:16 1080x1920)`, {
    bytes: fs.statSync(outputPath).size,
  });

  return {
    live: true,
    engine: 'ffmpeg',
    outputPath,
    relativePath: relative,
    srtPath,
    width: 1080,
    height: 1920,
    fps: 30,
  };
}

module.exports = {
  probeFfmpeg,
  renderVerticalReel,
  quoteDrawtext,
};
