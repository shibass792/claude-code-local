#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, 'config/.env') });

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const radar = require('./modules/radar');
const approval = require('./modules/approval-publisher');
const { getEngineStatus } = require('./modules/engines');
const { renderVerticalReel, writeUploadedAudio } = require('./modules/render');
const { generateViralHooks } = require('./modules/hooks');
const instagram = require('./modules/instagram-engine');
const music = require('./modules/music-library');
const backgrounds = require('./modules/backgrounds');
const { readLog, clearLog, formatLogText, readState } = require('./modules/creation-log');
const { MEDIA_DIR, OUTPUT_DIR, ROOT, ensureDir, resolveFromRoot } = require('./modules/store');
const { runCommand } = require('./modules/engines');
const career = require('./modules/career-ladder');
const psyPack = require('./modules/psy-pack');

async function careerDashboard() {
  const engines = await getEngineStatus();
  const inventory = music.getIndex();
  const pending = approval.getPendingQueue();
  return career.buildCareerBoard({
    engines: engines.engines ?? engines,
    inventory,
    pending: pending.length,
  });
}

const PORT = Number(process.env.STUDIO_API_PORT || 4052);
const UI_DIR = path.join(__dirname, 'ui');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
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

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(text);
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

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') {
    pathname = '/index.html';
  }
  const filePath = path.normalize(path.join(UI_DIR, pathname.replace(/^\/+/, '')));
  if (!filePath.startsWith(UI_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendText(res, 404, 'Not found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

function serveFile(res, filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    sendText(res, 404, 'File not found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': fs.statSync(filePath).size,
  });
  fs.createReadStream(filePath).pipe(res);
}

async function ensureFixtureAudio() {
  ensureDir(MEDIA_DIR);
  const dest = path.join(MEDIA_DIR, '01_ShiBass_Psytrance_Full_Pack_142BPM.wav');
  if (fs.existsSync(dest)) {
    return dest;
  }
  const result = await runCommand('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=110:sample_rate=44100:duration=6',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=220:sample_rate=44100:duration=6',
    '-filter_complex',
    'amix=inputs=2:duration=longest',
    dest,
  ]);
  return result.ok ? dest : null;
}

async function handleApi(req, res, url) {
  const route = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'GET' && route === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      mock: false,
      service: 'ShiBass Studio API',
      port: PORT,
    });
    return;
  }

  if (req.method === 'GET' && route === '/api/engines') {
    sendJson(res, 200, await getEngineStatus({ log: true }));
    return;
  }

  if (req.method === 'GET' && route === '/api/log') {
    const entries = readLog(Number(url.searchParams.get('limit') || 160));
    sendJson(res, 200, {
      mock: false,
      entries,
      text: formatLogText(entries),
      state: readState(),
    });
    return;
  }

  if (req.method === 'POST' && route === '/api/log/clear') {
    sendJson(res, 200, clearLog());
    return;
  }

  if (req.method === 'POST' && (route === '/api/render' || route === '/api/render/reel')) {
    const body = await readJsonBody(req);
    sendJson(res, 200, await renderVerticalReel({ ...body, enqueue: true }));
    return;
  }

  if (req.method === 'POST' && route === '/api/render/upload') {
    const buffer = await readBody(req);
    const fileName = req.headers['x-filename'] || `upload_${Date.now()}.wav`;
    const audioPath = await writeUploadedAudio(buffer, String(fileName));
    const title = path.parse(String(fileName)).name;
    const backgroundId = req.headers['x-background-id'] || undefined;
    sendJson(res, 200, await renderVerticalReel({ audioPath, title, backgroundId, enqueue: true }));
    return;
  }

  if (req.method === 'POST' && route === '/api/hooks') {
    sendJson(res, 200, await generateViralHooks(await readJsonBody(req)));
    return;
  }

  if (req.method === 'POST' && route === '/api/instagram/session') {
    sendJson(res, 200, await instagram.startSession());
    return;
  }

  if (req.method === 'POST' && route === '/api/instagram/publish') {
    sendJson(res, 200, await instagram.publishReel(await readJsonBody(req)));
    return;
  }

  if (req.method === 'GET' && route === '/api/music/index') {
    sendJson(res, 200, music.getIndex());
    return;
  }

  if (req.method === 'POST' && route === '/api/music/scan') {
    const body = await readJsonBody(req).catch(() => ({}));
    sendJson(res, 200, await music.scanLibrary(body));
    return;
  }

  if (req.method === 'GET' && route === '/api/backgrounds') {
    sendJson(res, 200, backgrounds.getIndex());
    return;
  }

  if (req.method === 'POST' && route === '/api/backgrounds/scan') {
    const body = await readJsonBody(req).catch(() => ({}));
    sendJson(res, 200, await backgrounds.scanBackgrounds(body));
    return;
  }

  if (req.method === 'POST' && route === '/api/backgrounds/upload') {
    const buffer = await readBody(req);
    const fileName = req.headers['x-filename'] || `upload_${Date.now()}.png`;
    const dest = backgrounds.writeUploadedBackground(buffer, String(fileName));
    const index = await backgrounds.scanBackgrounds({
      roots: [...new Set([...(backgrounds.getIndex().roots ?? []), path.dirname(dest)])],
    });
    const image = index.images.find((item) => item.path === dest) ?? null;
    sendJson(res, 200, { success: true, mock: false, path: dest, image, index });
    return;
  }

  if (req.method === 'GET' && route.startsWith('/api/backgrounds/file/')) {
    const id = route.slice('/api/backgrounds/file/'.length);
    const image = backgrounds.getBackground(id);
    if (!image) {
      sendJson(res, 404, { success: false, error: 'Background not found' });
      return;
    }
    serveFile(res, image.path);
    return;
  }

  if (req.method === 'GET' && route.startsWith('/api/music/stream/')) {
    const id = route.slice('/api/music/stream/'.length);
    const track = music.getTrack(id);
    if (!track) {
      sendJson(res, 404, { success: false, error: 'Track not found' });
      return;
    }
    serveFile(res, track.path);
    return;
  }

  if (req.method === 'GET' && route === '/api/radar') {
    sendJson(res, 200, await radar.getTopTrendingContent());
    return;
  }

  if (req.method === 'POST' && route === '/api/radar/scan') {
    sendJson(res, 200, await radar.scanWatchlist());
    return;
  }

  if (req.method === 'GET' && route === '/api/approval/pending') {
    sendJson(res, 200, approval.getPendingQueue());
    return;
  }

  if (req.method === 'POST' && route === '/api/approval/mark-watched') {
    const body = await readJsonBody(req);
    sendJson(res, 200, approval.markWatched(body.campaignId));
    return;
  }

  if (req.method === 'POST' && route === '/api/approval/reject') {
    const body = await readJsonBody(req);
    sendJson(res, 200, approval.rejectCampaign(body.campaignId));
    return;
  }

  if (req.method === 'POST' && route === '/api/approval/publish') {
    sendJson(res, 200, await approval.publishCampaign(await readJsonBody(req)));
    return;
  }

  if (req.method === 'GET' && route === '/api/approval/history') {
    sendJson(res, 200, approval.getPublishHistory());
    return;
  }

  if (req.method === 'GET' && route === '/api/career') {
    sendJson(res, 200, await careerDashboard());
    return;
  }

  if (req.method === 'POST' && route === '/api/career/epk') {
    const engines = await getEngineStatus();
    const inventory = music.getIndex();
    const pending = approval.getPendingQueue();
    const body = await readJsonBody(req).catch(() => ({}));
    sendJson(res, 200, career.writeEpk({
      engines: engines.engines ?? engines,
      inventory,
      pending: pending.length,
      links: body.links ?? {},
    }));
    return;
  }

  if (req.method === 'GET' && route === '/api/pack') {
    sendJson(res, 200, psyPack.getPackStatus());
    return;
  }

  if (req.method === 'POST' && route === '/api/pack/generate') {
    sendJson(res, 200, psyPack.generatePack());
    return;
  }

  if (req.method === 'GET' && route === '/api/connections') {
    sendJson(res, 200, {
      ...approval.getConnectionHealth(),
      engines: await getEngineStatus(),
    });
    return;
  }

  if (req.method === 'GET' && route === '/api/media') {
    const relative = url.searchParams.get('path');
    const absolute = resolveFromRoot(relative);
    if (!absolute || !fs.existsSync(absolute)) {
      sendJson(res, 200, { exists: false, path: null });
      return;
    }
    sendJson(res, 200, {
      exists: true,
      path: `/api/file?path=${encodeURIComponent(relative)}`,
    });
    return;
  }

  if (req.method === 'GET' && route === '/api/file') {
    const relative = url.searchParams.get('path');
    const absolute = resolveFromRoot(relative);
    serveFile(res, absolute);
    return;
  }

  sendJson(res, 404, { error: `Unknown API route ${route}` });
}

async function onRequest(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,X-Filename,X-Background-Id',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { success: false, mock: false, error: error.message });
  }
}

async function start(port = PORT) {
  ensureDir(MEDIA_DIR);
  ensureDir(OUTPUT_DIR);
  await ensureFixtureAudio();
  const index = music.getIndex();
  if (!index.tracks.length) {
    await music.scanLibrary();
  }

  const server = http.createServer(onRequest);
  await new Promise((resolve) => {
    server.listen(port, '0.0.0.0', resolve);
  });
  return server;
}

if (require.main === module) {
  start()
    .then((server) => {
      const address = server.address();
      console.log(`ShiBass Studio API listening on http://127.0.0.1:${address.port}`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { start, PORT, ROOT, ensureFixtureAudio };
