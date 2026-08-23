'use strict';

/**
 * Standalone HTTP API for ShiBass Social Studio.
 * Real endpoints — no static simulator templates.
 *
 *   node api-server.js
 *   Default: http://127.0.0.1:4051
 */

require('dotenv').config({ path: require('path').join(__dirname, 'config/.env') });

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const engines = require('./modules/engines');
const mediaLibrary = require('./modules/media-library');
const renderEngine = require('./modules/render-engine');
const hookGenerator = require('./modules/hook-generator');
const approvalEngine = require('./modules/approval-publisher');
const radar = require('./modules/radar');
const { createCampaignFromRender } = require('./modules/campaign-factory');
const { generatePsyPack } = require('./modules/psy-pack');
const { buildProducerPack } = require('./modules/producer-pack');
const { buildEpk } = require('./modules/epk');
const { getLineStatus } = require('./modules/line-status');
const transcriber = require('./modules/transcriber');
const { getSprint, toggleCell } = require('./modules/sprint');
const { getLadder } = require('./modules/ladder');
const { getWave1, evaluateCsv, evaluateCsvFile } = require('./modules/ads-cpc');
const { probeOps, formatOpsLog } = require('./modules/ops-probe');
const { ROOT, ensureDir, OUTPUT_DIR } = require('./modules/store');

const HOST = process.env.SHIBASS_API_HOST || '127.0.0.1';
const PORT = Number(process.env.SHIBASS_API_PORT || 4051);

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error('body too large'));
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
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mid': 'audio/midi',
    '.midi': 'audio/midi',
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  };
  return map[ext] || 'application/octet-stream';
}

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? '/studio.html' : urlPath;
  const filePath = path.normalize(path.join(__dirname, 'web', rel.replace(/^\//, '')));
  if (!filePath.startsWith(path.join(__dirname, 'web'))) {
    sendJson(res, 403, { error: 'forbidden' });
    return true;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }
  const data = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': contentTypeFor(filePath) });
  res.end(data);
  return true;
}

function streamFile(res, absolutePath) {
  const st = fs.statSync(absolutePath);
  res.writeHead(200, {
    'Content-Type': contentTypeFor(absolutePath),
    'Content-Length': st.size,
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
  });
  fs.createReadStream(absolutePath).pipe(res);
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (pathname === '/api/health' || pathname === '/api/engines') {
    const status = await engines.getEnginesStatus();
    sendJson(res, 200, {
      ...status,
      log: engines.formatStatusLog(status),
    });
    return;
  }

  if (pathname === '/api/media/scan' && req.method === 'POST') {
    const body = await readBody(req);
    const result = mediaLibrary.scanMediaLibrary({
      roots: body.roots,
      maxFiles: body.maxFiles,
      maxDepth: body.maxDepth,
    });
    sendJson(res, 200, { success: true, ...result });
    return;
  }

  if (pathname === '/api/media/library' && req.method === 'GET') {
    sendJson(res, 200, mediaLibrary.getLibrary({
      kind: url.searchParams.get('kind') || 'all',
      limit: url.searchParams.get('limit') || 300,
      q: url.searchParams.get('q') || '',
    }));
    return;
  }

  if (pathname === '/api/media/stream' && req.method === 'GET') {
    const byId = url.searchParams.get('id');
    const byPath = url.searchParams.get('path');
    let absolute = null;
    if (byId) {
      const item = mediaLibrary.resolveMediaById(byId);
      absolute = item?.path || null;
    } else if (byPath) {
      absolute = mediaLibrary.resolveSafePath(byPath);
    }
    if (!absolute) {
      sendJson(res, 404, { error: 'media not found or path not allowed' });
      return;
    }
    streamFile(res, absolute);
    return;
  }

  if (pathname === '/api/render/reel' && req.method === 'POST') {
    const body = await readBody(req);
    const result = await renderEngine.renderReel(body);
    sendJson(res, result.success ? 200 : 500, result);
    return;
  }

  if (pathname === '/api/hooks/generate' && req.method === 'POST') {
    const body = await readBody(req);
    const result = await hookGenerator.generateHooks(body);
    sendJson(res, 200, result);
    return;
  }

  if (pathname === '/api/radar/trends' && req.method === 'GET') {
    sendJson(res, 200, await radar.getTopTrendingContent());
    return;
  }

  if (pathname === '/api/radar/scan' && req.method === 'POST') {
    sendJson(res, 200, await radar.scanWatchlist());
    return;
  }

  if (pathname === '/api/approval/pending' && req.method === 'GET') {
    sendJson(res, 200, approvalEngine.getPendingQueue());
    return;
  }

  if (pathname === '/api/approval/history' && req.method === 'GET') {
    sendJson(res, 200, approvalEngine.getPublishHistory());
    return;
  }

  if (pathname === '/api/connections' && req.method === 'GET') {
    sendJson(res, 200, approvalEngine.getConnectionHealth());
    return;
  }

  if (pathname === '/api/create/campaign' && req.method === 'POST') {
    const body = await readBody(req);
    const result = await createCampaignFromRender(body);
    sendJson(res, result.success ? 200 : 400, result);
    return;
  }

  if (pathname === '/api/line/status' && req.method === 'GET') {
    sendJson(res, 200, await getLineStatus());
    return;
  }

  if (pathname === '/api/psy/generate' && req.method === 'POST') {
    const body = await readBody(req);
    sendJson(res, 200, generatePsyPack(body));
    return;
  }

  if (pathname === '/api/pack/build' && req.method === 'POST') {
    const body = await readBody(req);
    sendJson(res, 200, buildProducerPack(body));
    return;
  }

  if (pathname === '/api/epk/build' && req.method === 'POST') {
    const body = await readBody(req);
    sendJson(res, 200, buildEpk(body));
    return;
  }

  if (pathname === '/api/guides' && req.method === 'GET') {
    sendJson(res, 200, transcriber.listGuides());
    return;
  }

  if (pathname === '/api/guides' && req.method === 'POST') {
    const body = await readBody(req);
    sendJson(res, 200, transcriber.createGuide(body));
    return;
  }

  if (pathname === '/api/guides/ingest' && req.method === 'POST') {
    const body = await readBody(req);
    sendJson(res, body.filePath ? 200 : 400, transcriber.ingestFile(body));
    return;
  }

  if (pathname === '/api/sprint' && req.method === 'GET') {
    sendJson(res, 200, getSprint());
    return;
  }

  if (pathname === '/api/sprint/toggle' && req.method === 'POST') {
    const body = await readBody(req);
    sendJson(res, 200, toggleCell(body.id, body.done));
    return;
  }

  if (pathname === '/api/ladder' && req.method === 'GET') {
    sendJson(res, 200, getLadder());
    return;
  }

  if (pathname === '/api/wave1' && req.method === 'GET') {
    sendJson(res, 200, getWave1());
    return;
  }

  if (pathname === '/api/ads/evaluate' && req.method === 'POST') {
    const body = await readBody(req);
    if (body.filePath) {
      sendJson(res, 200, evaluateCsvFile(body.filePath));
      return;
    }
    if (body.csv) {
      sendJson(res, 200, evaluateCsv(body.csv));
      return;
    }
    sendJson(res, 400, { success: false, error: 'csv or filePath required' });
    return;
  }

  if (pathname === '/api/ops' && req.method === 'GET') {
    const report = await probeOps();
    sendJson(res, 200, { ...report, log: formatOpsLog(report) });
    return;
  }

  sendJson(res, 404, { error: 'not_found', path: pathname });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (serveStatic(req, res, url.pathname)) {
      return;
    }
    sendJson(res, 404, { error: 'not_found' });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
});

ensureDir(OUTPUT_DIR);
ensureDir(path.join(ROOT, 'web'));

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`ShiBass Studio API  http://${HOST}:${PORT}`);
    console.log(`Health              http://${HOST}:${PORT}/api/health`);
    console.log(`Studio UI           http://${HOST}:${PORT}/`);
  });
}

module.exports = {
  server,
  HOST,
  PORT,
  handleApi,
  createCampaignFromRender,
};
