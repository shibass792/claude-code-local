const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const videoEngine = require('./video-engine');
const reelhook = require('./reelhook');
const musicLibrary = require('./music-library');
const instagramEngine = require('./instagram-engine');
const approvalEngine = require('./approval-publisher');
const tiktokPublisher = require('./publishers/tiktok');
const { ROOT, resolveFromRoot } = require('./store');

function json(status, payload) {
  return {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  };
}

function guessAudioType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.flac') return 'audio/flac';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.m4a') return 'audio/mp4';
  return 'application/octet-stream';
}

async function collectHealth() {
  const [ffmpeg, ollama, instagram] = await Promise.all([
    videoEngine.getEngineHealth(),
    reelhook.getEngineHealth(),
    instagramEngine.probeGraphApi(),
  ]);

  return {
    mock: false,
    checkedAt: new Date().toISOString(),
    ffmpeg,
    reelhook: ollama,
    instagram,
    tiktok: {
      configured: tiktokPublisher.isConfigured(),
      live: tiktokPublisher.isConfigured(),
      mock: false,
      label: 'TikTok Content Posting API',
      mode: process.env.TIKTOK_PUBLISH_MODE ?? 'draft',
    },
    player: musicLibrary.getEngineHealth(),
    approval: approvalEngine.getConnectionHealth(),
  };
}

async function createCampaignFromAudio(audioPath, hookText = '') {
  const render = await videoEngine.renderVerticalReel({
    audioPath,
    hook: hookText,
  });
  const hooks = await reelhook.generateHooks({
    trackName: path.basename(audioPath),
    title: path.basename(audioPath, path.extname(audioPath)),
  });
  const campaign = approvalEngine.enqueueRenderedCampaign({
    title: path.basename(audioPath, path.extname(audioPath)),
    videoPath: render.relativePath,
    durationSec: render.durationSec,
    hook: hookText || hooks.hooks[0],
    hooks: hooks.hooks,
    audioPath,
  });

  return { render, hooks, campaign };
}

async function handleJsonRoute(method, pathname, query, body) {
  if (method === 'GET' && pathname === '/api/health') {
    return json(200, await collectHealth());
  }

  if (method === 'GET' && pathname === '/api/instagram/health') {
    return json(200, await instagramEngine.probeGraphApi());
  }

  if (method === 'GET' && pathname === '/api/approval/pending') {
    return json(200, approvalEngine.getPendingQueue());
  }

  if (method === 'GET' && pathname === '/api/approval/history') {
    return json(200, approvalEngine.getPublishHistory());
  }

  if (method === 'POST' && pathname === '/api/approval/mark-watched') {
    return json(200, approvalEngine.markWatched(body.id));
  }

  if (method === 'POST' && pathname === '/api/approval/reject') {
    return json(200, approvalEngine.rejectCampaign(body.id));
  }

  if (method === 'POST' && pathname === '/api/approval/publish') {
    return json(200, await approvalEngine.publishCampaign(body));
  }

  if (method === 'GET' && pathname === '/api/media') {
    const relativePath = query.get('rel');
    const absolute = resolveFromRoot(relativePath);
    if (!absolute || !absolute.startsWith(ROOT) || !fs.existsSync(absolute)) {
      return json(404, { exists: false, error: 'Media not found' });
    }
    const buffer = fs.readFileSync(absolute);
    return {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(buffer.length),
      },
      body: buffer,
    };
  }

  if (method === 'GET' && pathname === '/api/player/index') {
    return json(200, musicLibrary.getIndex());
  }

  if (method === 'POST' && pathname === '/api/player/scan') {
    const roots = Array.isArray(body.roots) ? body.roots : undefined;
    return json(200, await musicLibrary.scanLibrary({ roots }));
  }

  if (method === 'POST' && pathname === '/api/render') {
    if (!body.audioPath) {
      return json(400, { success: false, error: 'audioPath is required' });
    }
    const result = await videoEngine.renderVerticalReel(body);
    return json(200, result);
  }

  if (method === 'POST' && pathname === '/api/hooks') {
    const result = await reelhook.generateHooks(body);
    return json(200, result);
  }

  if (method === 'POST' && pathname === '/api/create-campaign') {
    if (!body.audioPath) {
      return json(400, { success: false, error: 'audioPath is required' });
    }
    const result = await createCampaignFromAudio(body.audioPath, body.hook);
    return json(200, { success: true, mock: false, ...result });
  }

  if (method === 'GET' && pathname === '/api/player/file') {
    const track = musicLibrary.getTrackById(query.get('id'));
    const playable = musicLibrary.resolvePlayablePath(track);
    if (!playable) {
      return json(404, { success: false, error: 'Track not found or not playable' });
    }
    const buffer = fs.readFileSync(playable);
    return {
      status: 200,
      headers: {
        'Content-Type': guessAudioType(playable),
        'Content-Length': String(buffer.length),
        'Accept-Ranges': 'bytes',
      },
      body: buffer,
    };
  }

  return json(404, { success: false, error: `No route for ${method} ${pathname}` });
}

async function route({ method, url, body = {} }) {
  const parsed = new URL(url, 'http://127.0.0.1');
  try {
    return await handleJsonRoute(method, parsed.pathname, parsed.searchParams, body);
  } catch (error) {
    return json(500, {
      success: false,
      mock: false,
      error: error instanceof Error ? error.message : 'Internal error',
    });
  }
}

module.exports = {
  route,
  collectHealth,
  createCampaignFromAudio,
};
