#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, 'config/.env') });

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const radar = require('./modules/radar');
const approval = require('./modules/approval-publisher');
const ai = require('./modules/ai');
const hooks = require('./modules/hooks');
const renderer = require('./modules/renderer');
const library = require('./modules/library');
const { resolveFromRoot, OUTPUT_DIR, ROOT } = require('./modules/store');

const UNAVAILABLE_PREFIXES = Object.freeze({
  '/api/instagram': 'Instagram engine is not on this Social Studio build',
  '/api/catalog': 'Catalog module is not on this Social Studio build',
  '/api/backgrounds': 'Backgrounds module is not on this Social Studio build',
  '/api/career': 'Career ladder is not on this Social Studio build',
  '/api/pack': 'Psy pack is not on this Social Studio build',
  '/api/log': 'Creation log is not on this Social Studio build',
  '/api/db': 'SQL db module is not on this Social Studio build',
});

const AUDIO_TYPES = Object.freeze({
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
});

function isInsideRoot(absolutePath) {
  if (!absolutePath) {
    return false;
  }
  const resolved = path.resolve(absolutePath);
  return resolved === ROOT || resolved.startsWith(`${ROOT}${path.sep}`);
}

function safeResolve(relativePath) {
  const absolute = resolveFromRoot(relativePath);
  if (!absolute || !isInsideRoot(absolute)) {
    return null;
  }
  return absolute;
}

function resolveStreamPath(idOrPath) {
  const track = library.findTrack(idOrPath);
  if (track?.path && fs.existsSync(track.path)) {
    return track.path;
  }
  const fromRoot = safeResolve(idOrPath);
  if (fromRoot && fs.existsSync(fromRoot)) {
    return fromRoot;
  }
  return null;
}

function sendFile(res, filePath) {
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': AUDIO_TYPES[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(res);
}

const DEFAULT_PORT = Number(process.env.STUDIO_API_PORT || 4052);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Filename',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendCors204(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-Filename',
  });
  res.end();
}

function readBody(req, limit = 2 * 1024 * 1024) {
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
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`Invalid JSON: ${error.message}`));
      }
    });
    req.on('error', reject);
  });
}

async function engineStatus() {
  const [aiHealth, renderHealth, radarHealth] = await Promise.all([
    ai.checkHealth().catch((error) => ({ ok: false, error: error.message })),
    renderer.checkHealth().catch((error) => ({ ok: false, error: error.message })),
    radar.checkHealth().catch((error) => ({ ok: false, error: error.message })),
  ]);
  return {
    ok: Boolean(aiHealth.ok || renderHealth.ok || radarHealth.ok),
    mock: false,
    engines: {
      ai: aiHealth,
      render: renderHealth,
      radar: radarHealth,
    },
  };
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const method = String(req.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    sendCors204(res);
    return;
  }

  try {
    if ((pathname === '/api/health' || pathname === '/api/ops/health') && method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        mock: false,
        service: 'shibass-studio-api',
        port: DEFAULT_PORT,
      });
      return;
    }

    if (pathname === '/api/engines' && method === 'GET') {
      sendJson(res, 200, await engineStatus());
      return;
    }

    if (pathname === '/api/radar' && method === 'GET') {
      sendJson(res, 200, { ok: true, feed: radar.getRadarFeed() });
      return;
    }

    if (pathname === '/api/radar/scan' && method === 'POST') {
      const result = await radar.scanWatchlist();
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (pathname === '/api/hooks' && method === 'POST') {
      const body = await readBody(req);
      const result = await hooks.generateHooks(body);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (pathname === '/api/render' && method === 'POST') {
      const body = await readBody(req);
      const result = await approval.createCampaignFromAudio(body);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (pathname === '/api/approval/pending' && method === 'GET') {
      sendJson(res, 200, { ok: true, pending: approval.getPendingQueue() });
      return;
    }

    if (pathname === '/api/approval/history' && method === 'GET') {
      sendJson(res, 200, { ok: true, history: approval.getPublishHistory() });
      return;
    }

    if (pathname === '/api/approval/mark-watched' && method === 'POST') {
      const body = await readBody(req);
      sendJson(res, 200, { ok: true, ...(approval.markWatched(body.campaignId) || {}) });
      return;
    }

    if (pathname === '/api/approval/reject' && method === 'POST') {
      const body = await readBody(req);
      sendJson(res, 200, { ok: true, ...(approval.rejectCampaign(body.campaignId) || {}) });
      return;
    }

    if (pathname === '/api/approval/publish' && method === 'POST') {
      const body = await readBody(req);
      const result = await approval.publishCampaign(body);
      sendJson(res, result.success ? 200 : 400, { ok: Boolean(result.success), ...result });
      return;
    }

    if (pathname === '/api/connections' && method === 'GET') {
      const verify = url.searchParams.get('verify') === '1';
      sendJson(res, 200, { ok: true, ...(await approval.getConnectionHealth({ verify })) });
      return;
    }

    if (pathname === '/api/connections/verify' && method === 'POST') {
      sendJson(res, 200, { ok: true, ...(await approval.getConnectionHealth({ verify: true })) });
      return;
    }

    if ((pathname === '/api/music' || pathname === '/api/music/index' || pathname === '/api/media') && method === 'GET') {
      sendJson(res, 200, { ok: true, ...library.getIndexStatus() });
      return;
    }

    if (pathname === '/api/music/search' && method === 'GET') {
      const tracks = library.searchTracks(url.searchParams.get('q') || '', {
        limit: Number(url.searchParams.get('limit') || 50),
        category: url.searchParams.get('category') || undefined,
      });
      sendJson(res, 200, { ok: true, tracks });
      return;
    }

    if (pathname === '/api/music/scan' && method === 'POST') {
      const result = await library.scanLibrary();
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (pathname === '/api/music/stream' || pathname.startsWith('/api/music/stream/')) {
      if (method !== 'GET') {
        sendJson(res, 405, { ok: false, mock: false, error: 'Use GET' });
        return;
      }
      const id = pathname === '/api/music/stream'
        ? (url.searchParams.get('id') || url.searchParams.get('path') || '')
        : pathname.slice('/api/music/stream/'.length);
      const filePath = resolveStreamPath(id);
      if (!filePath) {
        sendJson(res, 404, { ok: false, mock: false, error: 'Track not found' });
        return;
      }
      sendFile(res, filePath);
      return;
    }

    if (pathname === '/api/file' && method === 'GET') {
      const relative = url.searchParams.get('path');
      const absolute = safeResolve(relative);
      sendJson(res, 200, {
        ok: Boolean(absolute && fs.existsSync(absolute)),
        path: absolute,
        exists: Boolean(absolute && fs.existsSync(absolute)),
      });
      return;
    }

    if (pathname === '/api/scan' && method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        mock: false,
        implemented: [
          '/api/health',
          '/api/ops/health',
          '/api/engines',
          '/api/radar',
          '/api/radar/scan',
          '/api/hooks',
          '/api/render',
          '/api/approval/pending',
          '/api/approval/history',
          '/api/approval/mark-watched',
          '/api/approval/reject',
          '/api/approval/publish',
          '/api/connections',
          '/api/connections/verify',
          '/api/music',
          '/api/music/index',
          '/api/music/search',
          '/api/music/scan',
          '/api/music/stream',
          '/api/media',
          '/api/file',
          '/api/scan',
          '/api/mcp/status',
        ],
        unavailable: Object.keys(UNAVAILABLE_PREFIXES),
        outputDir: OUTPUT_DIR,
      });
      return;
    }

    if (pathname === '/api/mcp/status' && method === 'GET') {
      sendJson(res, 200, { ok: true, available: false, reason: 'MCP is not mounted on Studio API' });
      return;
    }

    const unavailableKey = Object.keys(UNAVAILABLE_PREFIXES).find((prefix) => (
      pathname === prefix || pathname.startsWith(`${prefix}/`)
    ));
    if (unavailableKey) {
      sendJson(res, 200, {
        ok: false,
        available: false,
        mock: false,
        error: UNAVAILABLE_PREFIXES[unavailableKey],
        prefix: unavailableKey,
      });
      return;
    }

    sendJson(res, 404, { ok: false, mock: false, error: `Unknown route ${method} ${pathname}` });
  } catch (error) {
    sendJson(res, 500, { ok: false, mock: false, error: error.message });
  }
}

function createStudioApiServer() {
  return http.createServer((req, res) => {
    Promise.resolve(handle(req, res)).catch((error) => {
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, mock: false, error: error.message });
      }
    });
  });
}

function listenStudioApi(port = DEFAULT_PORT) {
  const server = createStudioApiServer();
  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => {
      const address = server.address();
      console.log(`[studio-api] listening on http://127.0.0.1:${address.port}`);
      resolve(server);
    });
  });
}

module.exports = {
  createStudioApiServer,
  listenStudioApi,
  handle,
};

if (require.main === module) {
  listenStudioApi().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
