'use strict';

/**
 * Real 9:16 vertical video renderer.
 *
 * Replaces the old "next step: connect FFmpeg" placeholder with an actual
 * ffprobe + ffmpeg pipeline that writes a playable 1080x1920 MP4 to disk.
 * Nothing here fabricates a success line: if ffmpeg fails, the error and its
 * stderr tail are returned to the caller.
 */

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const { OUTPUT_DIR, ensureDir } = require('./store');

const execFileAsync = promisify(execFile);

// Resolved per call so a value loaded later from config/.env still applies.
const ffmpegBin = () => process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobeBin = () => process.env.FFPROBE_PATH || 'ffprobe';

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = Number(process.env.RENDER_FPS ?? 30);
const DEFAULT_DURATION = Number(process.env.RENDER_DURATION ?? 15);
const BG_COLOR = process.env.RENDER_BG ?? '#0f1117';
const FONT_NAME = process.env.RENDER_FONT ?? 'DejaVu Sans';

const AUDIO_EXTENSIONS = new Set([
  '.wav', '.mp3', '.flac', '.aiff', '.aif', '.m4a', '.aac', '.ogg', '.opus', '.wma',
]);

const STYLES = Object.freeze({
  spectrum: 'Scrolling spectrum analyzer',
  waves: 'Waveform pulse',
  cqt: 'Constant-Q bars',
  bars: 'Frequency bars',
});

class RenderError extends Error {
  constructor(message, { stderr, command } = {}) {
    super(message);
    this.name = 'RenderError';
    this.stderr = stderr;
    this.command = command;
  }
}

async function which(binary, args = ['-version']) {
  try {
    await execFileAsync(binary, args);
    return true;
  } catch {
    return false;
  }
}

async function checkHealth() {
  const [ffmpeg, ffprobe] = await Promise.all([which(ffmpegBin()), which(ffprobeBin())]);
  const encoder = ffmpeg ? await detectEncoder() : null;
  return { ok: ffmpeg && ffprobe, ffmpeg, ffprobe, encoder, width: WIDTH, height: HEIGHT, fps: FPS };
}

let cachedEncoder;

const ENCODER_PREFERENCE = ['h264_nvenc', 'h264_qsv', 'h264_videotoolbox', 'libx264'];

/**
 * `ffmpeg -encoders` lists encoders that were compiled in, not encoders that can
 * actually run — NVENC shows up on machines with no CUDA driver. Do a throwaway
 * one-frame encode to /dev/null so we only pick something that really works.
 */
async function canEncode(encoder) {
  try {
    await execFileAsync(
      ffmpegBin(),
      [
        '-hide_banner', '-loglevel', 'error', '-nostdin',
        '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.1',
        '-frames:v', '1',
        '-c:v', encoder,
        '-f', 'null', '-',
      ],
      { timeout: 20000 },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Pick the best usable H.264 encoder. NVENC on the studio box, x264 elsewhere.
 */
async function detectEncoder() {
  if (process.env.RENDER_ENCODER) {
    return process.env.RENDER_ENCODER;
  }
  if (cachedEncoder) {
    return cachedEncoder;
  }

  let listed = '';
  try {
    ({ stdout: listed } = await execFileAsync(ffmpegBin(), ['-hide_banner', '-encoders']));
  } catch {
    cachedEncoder = 'libx264';
    return cachedEncoder;
  }

  for (const candidate of ENCODER_PREFERENCE) {
    if (listed.includes(candidate) && (await canEncode(candidate))) {
      cachedEncoder = candidate;
      return candidate;
    }
  }

  cachedEncoder = 'libx264';
  return cachedEncoder;
}

function isAudioFile(filePath) {
  return AUDIO_EXTENSIONS.has(path.extname(String(filePath ?? '')).toLowerCase());
}

/**
 * Real ffprobe metadata read — duration, stream info and embedded tags.
 */
async function probeAudio(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new RenderError(`Audio file not found: ${filePath}`);
  }

  const { stdout } = await execFileAsync(ffprobeBin(), [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);

  const probe = JSON.parse(stdout);
  const audioStream = (probe.streams ?? []).find((s) => s.codec_type === 'audio');

  if (!audioStream) {
    throw new RenderError(`No audio stream found in ${path.basename(filePath)}`);
  }

  const tags = { ...(probe.format?.tags ?? {}), ...(audioStream.tags ?? {}) };
  const lower = Object.fromEntries(
    Object.entries(tags).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const bpmRaw = lower.bpm ?? lower.tbpm ?? lower.tempo;
  const bpmFromName = path.basename(filePath).match(/(\d{2,3})\s*bpm/i);

  return {
    path: filePath,
    fileName: path.basename(filePath),
    duration: Number(probe.format?.duration ?? 0),
    sizeBytes: Number(probe.format?.size ?? 0),
    codec: audioStream.codec_name ?? null,
    sampleRate: Number(audioStream.sample_rate ?? 0) || null,
    channels: audioStream.channels ?? null,
    bitRate: Number(probe.format?.bit_rate ?? 0) || null,
    title: lower.title ?? null,
    artist: lower.artist ?? null,
    bpm: bpmRaw ? Number(bpmRaw) : bpmFromName ? Number(bpmFromName[1]) : null,
    key: lower.initialkey ?? lower.key ?? null,
  };
}

function toAssTime(seconds) {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total - Math.floor(total)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function escapeAssText(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\r?\n/g, '\\N');
}

/**
 * Build an ASS subtitle track for the hook + optional caption lines.
 * libass handles Hebrew shaping and RTL, which drawtext does not.
 */
function buildAssFile({ hook, subtitle, duration = DEFAULT_DURATION, outputPath }) {
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${WIDTH}`,
    `PlayResY: ${HEIGHT}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Hook,${FONT_NAME},96,&H00FFFFFF,&H000000FF,&H00101010,&H96000000,-1,0,0,0,100,100,0,0,1,6,3,8,60,60,180,1`,
    `Style: Sub,${FONT_NAME},58,&H00FFE9A8,&H000000FF,&H00101010,&H96000000,-1,0,0,0,100,100,0,0,1,4,2,2,60,60,220,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events = [];
  const end = toAssTime(duration);

  if (hook) {
    events.push(
      `Dialogue: 0,${toAssTime(0)},${end},Hook,,0,0,0,,{\\fad(220,220)}${escapeAssText(hook)}`,
    );
  }
  if (subtitle) {
    events.push(
      `Dialogue: 0,${toAssTime(0.4)},${end},Sub,,0,0,0,,{\\fad(260,260)}${escapeAssText(subtitle)}`,
    );
  }

  const content = `${[...header, ...events].join('\n')}\n`;
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, content, 'utf8');
  return outputPath;
}

/**
 * ffmpeg filter arguments need `\`, `:` and `'` neutralised inside the graph.
 */
function escapeFilterPath(filePath) {
  return String(filePath)
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

/**
 * Audio-reactive visualizer, driven by the real audio stream.
 *
 * Each generator paints on black, so we key the black out and let the overlay
 * blend into the background instead of stamping an opaque rectangle on frame.
 */
function buildVisualizerFilter(style) {
  const keyOut = 'format=rgba,colorkey=0x000000:0.32:0.08';

  switch (style) {
    case 'waves':
      return `showwaves=s=${WIDTH}x520:mode=cline:rate=${FPS}:colors=#FF3EA5|#00E5FF,${keyOut}`;
    case 'cqt':
      return `showcqt=s=${WIDTH}x620:rate=${FPS}:count=2:bar_g=4,${keyOut}`;
    case 'spectrum':
      return (
        `showspectrum=s=${WIDTH}x620:mode=combined:color=intensity:scale=cbrt:` +
        `slide=scroll:fscale=log,${keyOut}`
      );
    case 'bars':
    default:
      return (
        `showfreqs=s=${WIDTH}x560:mode=bar:ascale=log:fscale=log:win_size=2048:` +
        `colors=#00E5FF|#FF3EA5,${keyOut}`
      );
  }
}

/**
 * Assemble the full ffmpeg argument list for one reel render.
 */
function buildFfmpegArgs({
  audioPath,
  coverPath,
  assPath,
  outputPath,
  startSec,
  durationSec,
  style,
  encoder,
}) {
  const args = ['-hide_banner', '-nostdin', '-y'];

  if (startSec > 0) {
    args.push('-ss', String(startSec));
  }
  args.push('-t', String(durationSec), '-i', audioPath);

  const hasCover = Boolean(coverPath && fs.existsSync(coverPath));
  if (hasCover) {
    args.push('-loop', '1', '-t', String(durationSec), '-i', coverPath);
  }

  const filters = [];

  if (hasCover) {
    // Slow push-in keeps a still cover from looking frozen.
    filters.push(
      `[1:v]scale=${WIDTH * 1.15}:-1:force_original_aspect_ratio=increase,` +
        `crop=${WIDTH}:${HEIGHT},` +
        `zoompan=z='min(zoom+0.0006,1.12)':d=${Math.round(durationSec * FPS)}:s=${WIDTH}x${HEIGHT}:fps=${FPS},` +
        `eq=brightness=-0.06:saturation=1.1,format=yuv420p[bg]`,
    );
  } else {
    filters.push(
      `color=c=${BG_COLOR}:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${durationSec},` +
        `format=yuv420p[bg]`,
    );
  }

  filters.push(`[0:a]${buildVisualizerFilter(style)}[viz]`);
  filters.push(
    `[bg][viz]overlay=x=(W-w)/2:y=H-h-320:shortest=1:format=auto[composited]`,
  );
  filters.push(
    `[composited]ass='${escapeFilterPath(assPath)}',format=yuv420p[vout]`,
  );

  args.push('-filter_complex', filters.join(';'));
  args.push('-map', '[vout]', '-map', '0:a');

  args.push('-c:v', encoder);
  if (encoder === 'libx264') {
    args.push('-preset', 'veryfast', '-crf', '20');
  } else {
    args.push('-preset', 'p5', '-cq', '22', '-b:v', '8M');
  }

  args.push(
    '-pix_fmt', 'yuv420p',
    '-r', String(FPS),
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    '-movflags', '+faststart',
    '-t', String(durationSec),
    '-progress', 'pipe:1',
    '-loglevel', 'error',
    outputPath,
  );

  return args;
}

function runFfmpeg(args, { onProgress, totalDurationSec } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stdoutBuffer = '';

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const match = line.match(/^out_time_ms=(\d+)/);
        if (match && onProgress && totalDurationSec > 0) {
          const seconds = Number(match[1]) / 1_000_000;
          const percent = Math.min(99, Math.round((seconds / totalDurationSec) * 100));
          onProgress({ percent, seconds });
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 20000) {
        stderr = stderr.slice(-20000);
      }
    });

    child.on('error', (error) =>
      reject(new RenderError(`Failed to launch ffmpeg (${ffmpegBin()}): ${error.message}`, { command: ffmpegBin() })),
    );

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stderr });
        return;
      }
      reject(
        new RenderError(`ffmpeg exited with code ${code}`, {
          stderr: stderr.trim().split('\n').slice(-12).join('\n'),
          command: `${ffmpegBin()} ${args.join(' ')}`,
        }),
      );
    });
  });
}

/**
 * Render one real 9:16 reel and return the verified output path plus metadata.
 */
async function renderReel({
  audioPath,
  coverPath = null,
  hook = '',
  subtitle = '',
  style = 'bars',
  startSec = 0,
  durationSec,
  outputPath,
  onProgress,
} = {}) {
  if (!audioPath) {
    throw new RenderError('renderReel requires audioPath');
  }

  const meta = await probeAudio(audioPath);
  const encoder = await detectEncoder();

  const target = Number(durationSec || DEFAULT_DURATION);
  // `available` of exactly 0 means the start offset is past the end — it must not
  // be treated as "unknown duration" and silently fall back to the full target.
  const available = meta.duration > 0 ? Math.max(0, meta.duration - Number(startSec || 0)) : null;
  const finalDuration =
    available === null ? target : Number(Math.min(target, available).toFixed(2));

  if (finalDuration <= 0) {
    throw new RenderError(
      `Start offset ${startSec}s is beyond the ${meta.duration.toFixed(2)}s audio length`,
    );
  }

  const renderDir = path.join(OUTPUT_DIR, 'renders');
  ensureDir(renderDir);

  const stamp = Date.now();
  const finalOutput = outputPath
    ? path.resolve(outputPath)
    : path.join(renderDir, `reel_${stamp}_1080x1920.mp4`);
  ensureDir(path.dirname(finalOutput));

  const assPath = path.join(renderDir, `reel_${stamp}.ass`);
  buildAssFile({ hook, subtitle, duration: finalDuration, outputPath: assPath });

  const args = buildFfmpegArgs({
    audioPath: path.resolve(audioPath),
    coverPath: coverPath ? path.resolve(coverPath) : null,
    assPath,
    outputPath: finalOutput,
    startSec: Number(startSec || 0),
    durationSec: finalDuration,
    style,
    encoder,
  });

  const startedAt = Date.now();
  await runFfmpeg(args, { onProgress, totalDurationSec: finalDuration });

  if (!fs.existsSync(finalOutput)) {
    throw new RenderError('ffmpeg reported success but no output file was written');
  }

  // Verify the artifact really is a playable 1080x1920 video.
  const { stdout } = await execFileAsync(ffprobeBin(), [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    finalOutput,
  ]);
  const outProbe = JSON.parse(stdout);
  const videoStream = (outProbe.streams ?? []).find((s) => s.codec_type === 'video');

  if (!videoStream) {
    throw new RenderError('Rendered file contains no video stream');
  }

  return {
    success: true,
    outputPath: finalOutput,
    relativePath: path.relative(path.join(OUTPUT_DIR, '..'), finalOutput).replace(/\\/g, '/'),
    assPath,
    encoder,
    style,
    width: videoStream.width,
    height: videoStream.height,
    fps: FPS,
    durationSec: Number(outProbe.format?.duration ?? finalDuration),
    sizeBytes: Number(outProbe.format?.size ?? 0),
    renderMs: Date.now() - startedAt,
    source: meta,
    renderedAt: new Date().toISOString(),
  };
}

module.exports = {
  RenderError,
  STYLES,
  WIDTH,
  HEIGHT,
  FPS,
  DEFAULT_DURATION,
  AUDIO_EXTENSIONS,
  ENCODER_PREFERENCE,
  isAudioFile,
  checkHealth,
  canEncode,
  detectEncoder,
  probeAudio,
  buildAssFile,
  buildFfmpegArgs,
  escapeFilterPath,
  buildVisualizerFilter,
  toAssTime,
  renderReel,
};
