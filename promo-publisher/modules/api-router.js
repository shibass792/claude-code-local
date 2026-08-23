const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const engines = require('./engines');
const approvalEngine = require('./approval-publisher');
const { ROOT } = require('./store');

const UI_DIR = path.join(ROOT, 'ui');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Filename',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 80 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const raw = await readBody(req, 2 * 1024 * 1024);
  if (!raw.length) {
    return {};
  }
  return JSON.parse(raw.toString('utf-8'));
}

function serveFromDir(res, rootDir, urlPath) {
  const relative = urlPath.replace(/^\/+/, '');
  const filePath = path.normalize(path.join(rootDir, relative));
  if (!filePath.startsWith(path.normalize(rootDir))) {
    sendJson(res, 403, { error: 'Forbidden' });
    return true;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function serveStatic(req, res, urlPath) {
  const relative = urlPath === '/' ? '/index.html' : urlPath;
  if (urlPath.startsWith('/output/')) {
    return serveFromDir(res, ROOT, urlPath);
  }
  return serveFromDir(res, UI_DIR, relative);
}

function serveTrack(req, res, id) {
  const track = engines.player.getTrackById(id);
  if (!track) {
    sendJson(res, 404, { error: 'Track not found — run a scan first' });
    return;
  }
  if (!track.playable) {
    sendJson(res, 415, {
      error: 'MIDI is indexed but not playable in the browser player',
      track,
    });
    return;
  }

  const range = engines.player.streamHeaders(track.path, req.headers.range);
  res.writeHead(range.status, {
    ...range.headers,
    'Content-Type': MIME[track.ext] ?? 'application/octet-stream',
    'Access-Control-Allow-Origin': '*',
  });
  fs.createReadStream(track.path, { start: range.start, end: range.end }).pipe(res);
}

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (route === 'GET /api/health') {
    sendJson(res, 200, await engines.getEnginesStatus());
    return;
  }

  if (route === 'GET /api/log') {
    const limit = Number(url.searchParams.get('limit') ?? 80);
    sendJson(res, 200, { entries: engines.creationLog.readLog(limit) });
    return;
  }

  if (route === 'POST /api/log/clear') {
    sendJson(res, 200, { cleared: true, entry: engines.creationLog.clearLog() });
    return;
  }

  if (route === 'GET /api/instagram/status') {
    sendJson(res, 200, await engines.instagram.getStatus());
    return;
  }

  if (route === 'POST /api/instagram/publish') {
    const body = await readJsonBody(req);
    sendJson(res, 200, await engines.instagram.publishReel(body));
    return;
  }

  if (route === 'POST /api/hooks') {
    const body = await readJsonBody(req);
    sendJson(res, 200, await engines.reelhook.generateHooks(body));
    return;
  }

  if (route === 'POST /api/render') {
    const body = await readJsonBody(req);
    const render = await engines.renderer.renderVerticalReel(body);
    if (render.ok) {
      approvalEngine.enqueueRenderedCampaign(render);
    }
    sendJson(res, 200, render);
    return;
  }

  if (route === 'POST /api/render/import') {
    const filename = path.basename(req.headers['x-filename'] ?? 'import.wav');
    const destDir = path.join(ROOT, 'media', 'imports');
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, `${Date.now()}_${filename}`);
    const raw = await readBody(req);
    fs.writeFileSync(dest, raw);
    engines.creationLog.appendLog({
      engine: 'render',
      event: 'import',
      message: `Imported ${filename} (${raw.length} bytes)`,
      data: { path: dest, bytes: raw.length },
    });
    sendJson(res, 200, { ok: true, audioPath: dest, bytes: raw.length });
    return;
  }

  if (route === 'GET /api/player/index') {
    sendJson(res, 200, engines.player.getIndexOrEmpty());
    return;
  }

  if (route === 'POST /api/player/scan') {
    const body = await readJsonBody(req).catch(() => ({}));
    sendJson(res, 200, engines.player.scanLibrary(body.roots));
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/player/stream/')) {
    const id = decodeURIComponent(url.pathname.slice('/api/player/stream/'.length));
    serveTrack(req, res, id);
    return;
  }

  if (route === 'GET /api/approval/pending') {
    sendJson(res, 200, approvalEngine.getPendingQueue());
    return;
  }

  if (route === 'GET /api/approval/history') {
    sendJson(res, 200, approvalEngine.getPublishHistory());
    return;
  }

  if (route === 'GET /api/connections') {
    sendJson(res, 200, approvalEngine.getConnectionHealth());
    return;
  }

  if (route === 'POST /api/approval/mark-watched') {
    const body = await readJsonBody(req);
    sendJson(res, 200, approvalEngine.markWatched(body.campaignId));
    return;
  }

  if (route === 'POST /api/approval/reject') {
    const body = await readJsonBody(req);
    sendJson(res, 200, approvalEngine.rejectCampaign(body.campaignId));
    return;
  }

  if (route === 'POST /api/approval/publish') {
    const body = await readJsonBody(req);
    sendJson(res, 200, await approvalEngine.publishCampaign(body));
    return;
  }

  sendJson(res, 404, { error: `No API route for ${route}` });
}

async function handleRequest(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (!serveStatic(req, res, url.pathname)) {
      sendJson(res, 404, { error: 'Not found' });
    }
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

module.exports = {
  handleRequest,
  sendJson,
};
