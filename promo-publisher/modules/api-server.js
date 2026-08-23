const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { ROOT } = require('./store');
const { readLog, getFormattedLog, clearLog, appendLog } = require('./creation-log');
const { generateViralHooks, probeOllama } = require('./engines/ollama-hooks');
const { renderVerticalReel, probeFfmpeg } = require('./engines/ffmpeg-render');
const { probeInstagram } = require('./engines/instagram-graph');
const { scanLibrary, getLibrary, getLibraryItem } = require('./engines/library-index');
const radar = require('./radar');
const approval = require('./approval-publisher');

const DEFAULT_PORT = Number(process.env.SHIBASS_STUDIO_API_PORT ?? 17891);
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
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, url) {
  const relative = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(UI_DIR, relative));
  if (!filePath.startsWith(UI_DIR)) {
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

function streamLibraryFile(res, id) {
  const item = getLibraryItem(id);
  if (!item || !fs.existsSync(item.path)) {
    sendJson(res, 404, { error: 'Library item not found' });
    return;
  }
  const ext = path.extname(item.path).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Disposition': `inline; filename="${item.name}"`,
  });
  fs.createReadStream(item.path).pipe(res);
}

async function handleApi(req, res, url) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, await approval.getConnectionHealth());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/log') {
    sendJson(res, 200, { entries: readLog(), text: getFormattedLog() });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/log/clear') {
    sendJson(res, 200, clearLog());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/instagram/health') {
    sendJson(res, 200, await probeInstagram());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/ollama/health') {
    sendJson(res, 200, await probeOllama());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/ffmpeg/health') {
    sendJson(res, 200, await probeFfmpeg());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/library') {
    sendJson(res, 200, getLibrary());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/library/scan') {
    sendJson(res, 200, scanLibrary());
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/library/file/')) {
    streamLibraryFile(res, url.pathname.split('/').pop());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/hooks') {
    const body = await readBody(req);
    sendJson(res, 200, await generateViralHooks(body));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/render') {
    const body = await readBody(req);
    const audioPath = body.audioPath;
    const rendered = await renderVerticalReel({
      audioPath,
      hook: body.hook,
      title: body.title,
    });
    const campaign = approval.enqueueRenderedCampaign({
      id: `camp_${Date.now()}`,
      title: body.title || path.basename(audioPath),
      videoPath: rendered.relativePath,
      duration: 'render',
      captionHe: body.captionHe ?? '',
      captionEn: body.hook ?? '',
      hashtags: body.hashtags ?? '#Psytrance #ShiBass',
    });
    sendJson(res, 200, { ...rendered, campaign });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/radar/scan') {
    sendJson(res, 200, await radar.scanWatchlist());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/radar') {
    sendJson(res, 200, await radar.getTopTrendingContent());
    return;
  }

  sendJson(res, 404, { error: `Unknown route ${req.method} ${url.pathname}` });
}

function createStudioApiServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }
      if (!serveStatic(req, res, url)) {
        sendJson(res, 404, { error: 'Not found' });
      }
    } catch (error) {
      appendLog('error', 'api', error.message);
      sendJson(res, 500, { error: error.message });
    }
  });
}

function startStudioApiServer(port = DEFAULT_PORT) {
  const server = createStudioApiServer();
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '0.0.0.0', () => {
      appendLog('success', 'api', `Studio API listening on http://127.0.0.1:${port}`);
      resolve({ server, port, url: `http://127.0.0.1:${port}` });
    });
  });
}

if (require.main === module) {
  startStudioApiServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_PORT,
  createStudioApiServer,
  startStudioApiServer,
};
