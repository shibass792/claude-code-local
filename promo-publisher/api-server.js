const http = require('http');
const path = require('path');
const fs = require('fs');
const { route } = require('./modules/api-router');

const DEFAULT_PORT = Number(process.env.SHIBASS_API_PORT || 4050);
const UI_DIR = path.join(__dirname, 'ui');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function send(res, result) {
  const headers = { ...CORS, ...(result.headers ?? {}) };
  res.writeHead(result.status, headers);
  res.end(result.body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
  });
}

function serveUi(reqUrl, res) {
  const parsed = new URL(reqUrl, 'http://127.0.0.1');
  const rel = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  const filePath = path.normalize(path.join(UI_DIR, rel));
  if (!filePath.startsWith(UI_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }
  const ext = path.extname(filePath);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
  };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', ...CORS });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function createServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    try {
      if (req.url && !req.url.startsWith('/api/') && serveUi(req.url, res)) {
        return;
      }

      const body = req.method === 'POST' ? await readBody(req) : {};
      const result = await route({
        method: req.method,
        url: req.url,
        body,
      });
      send(res, result);
    } catch (error) {
      send(res, {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          success: false,
          mock: false,
          error: error instanceof Error ? error.message : 'Server error',
        }),
      });
    }
  });
}

function startServer(port = DEFAULT_PORT) {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        port: address.port,
        url: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

if (require.main === module) {
  startServer()
    .then(({ url }) => {
      console.log(`[shibass-api] listening on ${url}`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  DEFAULT_PORT,
  createServer,
  startServer,
};
