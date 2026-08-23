'use strict';

/**
 * If Main IDE :4000 is down, serve library aliases so "API 4000 not reachable"
 * UIs can keep working. Does nothing if :4000 is already bound.
 */

const http = require('http');
const net = require('net');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const mediaLibrary = require('./modules/media-library');
const { getLineStatus } = require('./modules/line-status');
const { scanQuality } = require('./modules/quality-scan');

const HOST = '127.0.0.1';
const PORT = Number(process.env.SHIBASS_IDE_PORT || 4000);

function send(res, code, payload) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function portFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port, HOST);
  });
}

function attachLibraryRoutes(req, res) {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  if (req.method === 'OPTIONS') {
    send(res, 204, {});
    return;
  }
  if (url.pathname === '/api/ops/health' || url.pathname === '/api/health') {
    send(res, 200, {
      ok: true,
      service: 'shibass-line-compat-4000',
      note: 'Main IDE was offline. This is the Studio library bridge. Prefer http://127.0.0.1:4051/',
    });
    return;
  }
  if (
    url.pathname === '/api/media/library' ||
    url.pathname === '/api/library' ||
    url.pathname === '/api/files'
  ) {
    send(res, 200, mediaLibrary.getLibrary({
      kind: url.searchParams.get('kind') || 'all',
      limit: url.searchParams.get('limit') || 400,
      q: url.searchParams.get('q') || url.searchParams.get('filter') || '',
    }));
    return;
  }
  if (url.pathname === '/api/media/scan' && req.method === 'POST') {
    send(res, 200, { success: true, ...mediaLibrary.scanMediaLibrary() });
    return;
  }
  if (url.pathname === '/api/line/status') {
    getLineStatus().then((status) => send(res, 200, status));
    return;
  }
  if (
    url.pathname === '/api/quality'
    || url.pathname === '/api/code-quality'
    || url.pathname === '/api/analyze'
  ) {
    send(res, 200, scanQuality());
    return;
  }
  if (url.pathname === '/api/media/stream' && req.method === 'GET') {
    const byId = url.searchParams.get('id');
    const byPath = url.searchParams.get('path');
    let absolute = null;
    if (byId) {
      absolute = mediaLibrary.resolveMediaById(byId)?.path || null;
    } else if (byPath) {
      absolute = mediaLibrary.resolveSafePath(byPath);
    }
    if (!absolute) {
      send(res, 404, { error: 'media not found or path not allowed' });
      return;
    }
    const ext = path.extname(absolute).toLowerCase();
    const types = {
      '.wav': 'audio/wav',
      '.mp3': 'audio/mpeg',
      '.flac': 'audio/flac',
      '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4',
      '.mp4': 'video/mp4',
    };
    const st = fs.statSync(absolute);
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(absolute).pipe(res);
    return;
  }
  send(res, 404, { error: 'not_found', hint: 'Use Studio API on :4051' });
}

async function startIfIdle() {
  const free = await portFree(PORT);
  if (!free) {
    console.log(`:4000 already in use (Main IDE). Compat bridge not started.`);
    return null;
  }
  const server = http.createServer((req, res) => {
    try {
      attachLibraryRoutes(req, res);
    } catch (err) {
      send(res, 500, { error: String(err.message || err) });
    }
  });
  return new Promise((resolve) => {
    server.listen(PORT, HOST, () => {
      console.log(`Library compat on http://${HOST}:${PORT} (IDE was offline)`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  startIfIdle().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { startIfIdle, attachLibraryRoutes };
