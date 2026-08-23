const { execFile } = require('child_process');
const { promisify } = require('util');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { appendLog, snapshotState } = require('./creation-log');
const metaPublisher = require('./publishers/meta');
const tiktokPublisher = require('./publishers/tiktok');
const { MUSIC_INDEX, BG_INDEX, readJson } = require('./store');
const sql = require('./sql-db');

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

async function resolvePythonBinary() {
  const candidates = [
    process.env.PYTHON,
    process.env.PY,
    process.platform === 'win32' ? 'py' : null,
    'python',
    'python3',
  ].filter(Boolean);

  for (const name of candidates) {
    const extraArgs = name === 'py' ? ['-3'] : [];
    const result = await runCommand(name, [...extraArgs, '-c', 'import sys; print(sys.executable)']);
    if (result.ok) {
      return {
        command: name,
        extraArgs,
        executable: firstLine(result.stdout) || name,
      };
    }
  }
  return null;
}

async function probeInstaPy() {
  const python = await resolvePythonBinary();
  let result = { ok: false, error: 'No python / py / python3 on PATH' };
  if (python) {
    result = await runCommand(python.command, [
      ...python.extraArgs,
      '-c',
      'import instapy,sys; print(getattr(instapy,"__version__","installed"))',
    ]);
  }
  const graphReady = metaPublisher.isConfigured();
  return {
    id: 'instapy',
    label: 'Instagram engine (Graph API + optional InstaPy)',
    available: graphReady || result.ok,
    instapyInstalled: result.ok,
    instapyVersion: result.ok ? firstLine(result.stdout) : null,
    python: python?.executable ?? null,
    graphApiConfigured: graphReady,
    enabled: process.env.INSTAPY_ENABLED === '1',
    error: graphReady || result.ok ? null : (result.error || 'InstaPy not installed and META tokens missing'),
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

function probeBackgrounds() {
  const index = readJson(BG_INDEX, null);
  const images = Array.isArray(index?.images) ? index.images : [];
  return {
    id: 'backgrounds',
    label: 'Background / artwork library',
    available: images.length > 0,
    images: images.length,
    scannedAt: index?.scannedAt ?? null,
    error: images.length ? null : 'No background index — run a scan',
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
  const backgrounds = probeBackgrounds();
  const sqlite = sql.health();
  const engines = {
    ffmpeg,
    ffprobe,
    ollama,
    openaiCompat,
    ytDlp,
    instapy,
    remotion,
    music,
    backgrounds,
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
    sqlite: {
      id: 'sqlite',
      label: 'Studio SQLite',
      available: Boolean(sqlite.ok && sqlite.exists),
      path: sqlite.path,
      counts: sqlite.counts,
      error: sqlite.ok ? null : 'SQLite database is not installed',
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
  return process.env.PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
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
    'C:\\Users\\shibass\\Music',
    'C:\\Users\\shibass\\Documents',
    'H:\\shibass-ai\\00_INBOX',
    'H:\\shibass-ai\\01_SAMPLES',
    'H:\\shibass-ai\\02_PROJECTS',
    'H:\\shibass-ai\\10_OUTPUTS',
    'H:\\ShiBass_Cubase_Projects',
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
  resolvePythonBinary,
  resolveMediaRoots,
  probeBackgrounds,
};
