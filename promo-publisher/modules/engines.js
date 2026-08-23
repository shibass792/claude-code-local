const { execFile } = require('child_process');
const { promisify } = require('util');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { appendLog, snapshotState } = require('./creation-log');
const metaPublisher = require('./publishers/meta');
const tiktokPublisher = require('./publishers/tiktok');
const { MUSIC_INDEX, readJson } = require('./store');

const execFileAsync = promisify(execFile);

async function runCommand(command, args, timeoutMs = 8000) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: timeoutMs,
      windowsHide: true,
    });
    return {
      ok: true,
      command,
      stdout: String(stdout ?? '').trim(),
      stderr: String(stderr ?? '').trim(),
    };
  } catch (error) {
    return {
      ok: false,
      command,
      error: error.message,
      stdout: String(error.stdout ?? '').trim(),
      stderr: String(error.stderr ?? '').trim(),
    };
  }
}

function firstLine(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? '';
}

async function probeFfmpeg() {
  const result = await runCommand('ffmpeg', ['-version']);
  return {
    id: 'ffmpeg',
    label: 'FFmpeg / 9:16 renderer',
    available: result.ok,
    version: firstLine(result.stdout) || null,
    error: result.ok ? null : result.error,
  };
}

async function probeFfprobe() {
  const result = await runCommand('ffprobe', ['-version']);
  return {
    id: 'ffprobe',
    label: 'FFprobe',
    available: result.ok,
    version: firstLine(result.stdout) || null,
    error: result.ok ? null : result.error,
  };
}

async function probeOllama() {
  const host = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
  try {
    const res = await axios.get(`${host.replace(/\/$/, '')}/api/tags`, { timeout: 2500 });
    const models = (res.data?.models ?? []).map((model) => model.name).filter(Boolean);
    return {
      id: 'ollama',
      label: 'Ollama / ReelHook AI',
      available: true,
      host,
      model: process.env.OLLAMA_MODEL || models[0] || 'llama3.2',
      models,
    };
  } catch (error) {
    return {
      id: 'ollama',
      label: 'Ollama / ReelHook AI',
      available: false,
      host,
      error: error.message,
    };
  }
}

async function probeOpenAiCompat() {
  const base = process.env.OPENAI_BASE_URL || process.env.ANTHROPIC_BASE_URL || '';
  if (!base) {
    return {
      id: 'openai_compat',
      label: 'OpenAI-compatible LLM',
      available: false,
      error: 'OPENAI_BASE_URL / ANTHROPIC_BASE_URL not set',
    };
  }
  try {
    const res = await axios.get(`${base.replace(/\/$/, '')}/models`, {
      timeout: 2500,
      headers: process.env.OPENAI_API_KEY
        ? { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
        : {},
      validateStatus: () => true,
    });
    return {
      id: 'openai_compat',
      label: 'OpenAI-compatible LLM',
      available: res.status < 500,
      host: base,
      status: res.status,
    };
  } catch (error) {
    return {
      id: 'openai_compat',
      label: 'OpenAI-compatible LLM',
      available: false,
      host: base,
      error: error.message,
    };
  }
}

async function probeYtDlp() {
  const result = await runCommand('yt-dlp', ['--version']);
  return {
    id: 'yt_dlp',
    label: 'yt-dlp radar scanner',
    available: result.ok,
    version: firstLine(result.stdout) || null,
    error: result.ok ? null : result.error,
  };
}

async function probeInstaPy() {
  const result = await runCommand('python3', ['-c', 'import instapy,sys; print(getattr(instapy,"__version__","installed"))']);
  const graphReady = metaPublisher.isConfigured();
  return {
    id: 'instapy',
    label: 'Instagram engine (Graph API + optional InstaPy)',
    available: graphReady || result.ok,
    instapyInstalled: result.ok,
    instapyVersion: result.ok ? firstLine(result.stdout) : null,
    graphApiConfigured: graphReady,
    enabled: process.env.INSTAPY_ENABLED === '1',
    error: graphReady || result.ok ? null : 'InstaPy not installed and META tokens missing',
  };
}

async function probeRemotion() {
  const localBin = path.join(__dirname, '..', 'node_modules', '.bin', 'remotion');
  if (fs.existsSync(localBin)) {
    const result = await runCommand(localBin, ['--version']);
    return {
      id: 'remotion',
      label: 'Remotion CLI',
      available: result.ok,
      version: firstLine(result.stdout) || firstLine(result.stderr) || null,
      error: result.ok ? null : result.error,
    };
  }
  const result = await runCommand('remotion', ['--version']);
  return {
    id: 'remotion',
    label: 'Remotion CLI',
    available: result.ok,
    version: firstLine(result.stdout) || firstLine(result.stderr) || null,
    error: result.ok ? null : 'Remotion CLI not installed — FFmpeg is the active 9:16 renderer',
  };
}

function probeMusicIndex() {
  const index = readJson(MUSIC_INDEX, null);
  const tracks = Array.isArray(index?.tracks) ? index.tracks : [];
  return {
    id: 'music_index',
    label: 'Music library index',
    available: tracks.length > 0,
    tracks: tracks.length,
    scannedAt: index?.scannedAt ?? null,
    error: tracks.length ? null : 'No music index — run a scan',
  };
}

async function getEngineStatus({ log = false } = {}) {
  const [ffmpeg, ffprobe, ollama, openaiCompat, ytDlp, instapy, remotion] = await Promise.all([
    probeFfmpeg(),
    probeFfprobe(),
    probeOllama(),
    probeOpenAiCompat(),
    probeYtDlp(),
    probeInstaPy(),
    probeRemotion(),
  ]);

  const music = probeMusicIndex();
  const engines = {
    ffmpeg,
    ffprobe,
    ollama,
    openaiCompat,
    ytDlp,
    instapy,
    remotion,
    music,
    meta: {
      id: 'meta',
      label: 'Meta Graph API',
      available: metaPublisher.isConfigured(),
      error: metaPublisher.isConfigured() ? null : 'META_ACCESS_TOKEN / META_PAGE_ID / META_IG_USER_ID missing',
    },
    tiktok: {
      id: 'tiktok',
      label: 'TikTok Content Posting API',
      available: tiktokPublisher.isConfigured(),
      error: tiktokPublisher.isConfigured() ? null : 'TIKTOK_ACCESS_TOKEN / TIKTOK_CLIENT_KEY missing',
    },
  };

  const ready = engines.ffmpeg.available;
  const payload = {
    ok: ready,
    mock: false,
    status: ready ? 'ready' : 'degraded',
    generatedAt: new Date().toISOString(),
    engines,
  };

  snapshotState({ engines, status: payload.status });

  if (log) {
    appendLog({
      source: 'engines',
      message: ready
        ? `Engine probe OK — FFmpeg ${ffmpeg.version ?? 'ready'}`
        : `Engine probe degraded — FFmpeg missing: ${ffmpeg.error}`,
      engines: Object.fromEntries(
        Object.entries(engines).map(([key, value]) => [key, Boolean(value.available)]),
      ),
    });
  }

  return payload;
}

function resolvePython() {
  const candidates = [process.env.PYTHON, 'python3', 'python'];
  return candidates.find(Boolean);
}

function resolveMediaRoots() {
  const raw = process.env.SHIBASS_MUSIC_ROOTS ?? '';
  const extra = raw
    .split(/[;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const defaults = [
    path.join(__dirname, '..', 'media'),
    'C:\\Users\\shibass\\Documents\\ShiBass Synth Samples',
    'H:\\shibass-ai\\00_INBOX',
    'H:\\shibass-ai\\10_OUTPUTS',
  ];
  return [...new Set([...extra, ...defaults])].filter((dir) => fs.existsSync(dir));
}

module.exports = {
  runCommand,
  probeFfmpeg,
  probeOllama,
  probeYtDlp,
  probeInstaPy,
  getEngineStatus,
  resolvePython,
  resolveMediaRoots,
};
