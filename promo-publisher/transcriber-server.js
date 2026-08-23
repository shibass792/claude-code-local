'use strict';

/**
 * Learning transcriber on :4340 — writes guide_he.md while you work.
 *   node transcriber-server.js
 */

const http = require('http');
const { URL } = require('url');
const transcriber = require('./modules/transcriber');

const HOST = process.env.SHIBASS_TRANSCRIBER_HOST || '127.0.0.1';
const PORT = Number(process.env.SHIBASS_TRANSCRIBER_PORT || 4340);

function send(res, code, payload) {
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
    req.on('data', (c) => chunks.push(c));
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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    if (req.method === 'OPTIONS') {
      send(res, 204, {});
      return;
    }
    if (url.pathname === '/api/health') {
      send(res, 200, {
        ok: true,
        service: 'shibass-transcriber',
        port: PORT,
        guides: transcriber.listGuides().count,
      });
      return;
    }
    if (url.pathname === '/api/guides' && req.method === 'GET') {
      send(res, 200, transcriber.listGuides());
      return;
    }
    if ((url.pathname === '/api/guides' || url.pathname === '/api/ingest') && req.method === 'POST') {
      const body = await readBody(req);
      if (body.filePath) {
        send(res, 200, transcriber.ingestFile(body));
        return;
      }
      send(res, 200, transcriber.createGuide(body));
      return;
    }
    send(res, 404, { error: 'not_found' });
  } catch (err) {
    send(res, 500, { error: String(err.message || err) });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`ShiBass Transcriber  http://${HOST}:${PORT}`);
    console.log(`POST /api/ingest  { title, notes, url } → guide_he.md`);
  });
}

module.exports = { server, PORT, HOST };
