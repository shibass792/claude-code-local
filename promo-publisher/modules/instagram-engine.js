const { spawn } = require('child_process');
const path = require('path');
const axios = require('axios');
const metaPublisher = require('./publishers/meta');
const { appendLog, snapshotState } = require('./creation-log');
const { probeInstaPy, runCommand, resolvePythonBinary } = require('./engines');

function buildPermalink(platform, id) {
  if (!id) {
    return null;
  }
  if (platform === 'instagram') {
    return `https://www.instagram.com/reel/${id}/`;
  }
  if (platform === 'facebook') {
    const pageId = process.env.META_PAGE_ID;
    return pageId
      ? `https://www.facebook.com/${pageId}/videos/${id}/`
      : `https://www.facebook.com/watch/?v=${id}`;
  }
  if (platform === 'tiktok') {
    return `https://www.tiktok.com/@shibass/video/${id}`;
  }
  return null;
}

async function graphHealth() {
  const cfg = metaPublisher.getMetaConfig();
  if (!metaPublisher.isConfigured()) {
    return {
      ok: false,
      mock: false,
      engine: 'meta-graph',
      error: 'META_ACCESS_TOKEN, META_PAGE_ID and META_IG_USER_ID are required',
    };
  }

  try {
    const res = await axios.get(`https://graph.facebook.com/v21.0/${cfg.igUserId}`, {
      params: {
        fields: 'id,username,name',
        access_token: cfg.accessToken,
      },
      timeout: 10000,
    });
    return {
      ok: true,
      mock: false,
      engine: 'meta-graph',
      user: res.data,
    };
  } catch (error) {
    const detail = error.response?.data?.error?.message || error.message;
    return {
      ok: false,
      mock: false,
      engine: 'meta-graph',
      error: detail,
    };
  }
}

async function runPythonEngine(args) {
  const python = await resolvePythonBinary();
  if (!python) {
    return { ok: false, error: 'No python / py / python3 on PATH', stdout: '', stderr: '' };
  }
  const script = path.join(__dirname, '..', '..', 'tools', 'instapy_engine.py');
  return new Promise((resolve) => {
    const child = spawn(python.command, [...python.extraArgs, script, ...args], {
      env: process.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      resolve({ ok: false, error: error.message, stdout, stderr });
    });
    child.on('close', (code) => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

async function startSession() {
  const probe = await probeInstaPy();
  const graph = await graphHealth();

  if (graph.ok) {
    appendLog({
      source: 'instapy',
      message: `Instagram Graph API session OK for @${graph.user?.username ?? graph.user?.id}`,
      user: graph.user,
    });
    snapshotState({ instagram: graph });
    return {
      success: true,
      mock: false,
      engine: 'meta-graph',
      instapyInstalled: probe.instapyInstalled,
      instapyVersion: probe.instapyVersion,
      user: graph.user,
    };
  }

  if (process.env.INSTAPY_ENABLED === '1' && probe.instapyInstalled) {
    const py = await runPythonEngine(['--status']);
    appendLog({
      source: 'instapy',
      message: py.ok
        ? `InstaPy engine responded: ${py.stdout.trim()}`
        : `InstaPy engine failed: ${py.stderr || py.error}`,
    });
    return {
      success: py.ok,
      mock: false,
      engine: 'instapy',
      instapyVersion: probe.instapyVersion,
      output: py.stdout.trim(),
      error: py.ok ? null : py.stderr || py.error,
    };
  }

  const error =
    graph.error ||
    'No real Instagram API is configured. Set META_* tokens (preferred) or INSTAPY_ENABLED=1 with InstaPy installed.';
  appendLog({ source: 'instapy', level: 'error', message: error });
  return {
    success: false,
    mock: false,
    engine: 'none',
    instapyInstalled: probe.instapyInstalled,
    error,
  };
}

async function publishReel({ videoUrl, caption }) {
  if (!videoUrl) {
    return {
      success: false,
      mock: false,
      error: 'videoUrl is required for a real Instagram publish',
    };
  }

  const result = await metaPublisher.publishInstagramReel({ videoUrl, caption });
  const permalink = buildPermalink('instagram', result.id);
  appendLog({
    source: 'instapy',
    level: result.success ? 'info' : 'error',
    message: result.success
      ? `Instagram Reel published: ${permalink}`
      : `Instagram publish failed: ${result.error}`,
    result,
  });
  return {
    ...result,
    mock: false,
    permalink,
  };
}

async function pythonVersion() {
  const python = await resolvePythonBinary();
  if (!python) {
    return 'python missing';
  }
  const result = await runCommand(python.command, [...python.extraArgs, '--version']);
  return result.ok ? result.stdout : result.stderr;
}

module.exports = {
  buildPermalink,
  graphHealth,
  startSession,
  publishReel,
  pythonVersion,
};
