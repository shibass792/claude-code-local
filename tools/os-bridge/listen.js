'use strict';

const http = require('http');
const { sendJson, sendCors204, tryHandleOsBridge } = require('./proxy');
const { pathnameOf } = require('./routes');

const DEFAULT_PORT = Number(process.env.OS_PORT || 4000);

function createOsServer() {
  return http.createServer((req, res) => {
    if (tryHandleOsBridge(req, res)) {
      return;
    }

    const pathname = pathnameOf(req.url);
    const method = String(req.method || 'GET').toUpperCase();

    if (method === 'OPTIONS') {
      sendCors204(res);
      return;
    }

    if (pathname === '/api/health' && method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        mock: false,
        service: 'shibass-os',
        port: DEFAULT_PORT,
        note: 'Standalone OS listener. Studio /api prefixes proxy to 4052.',
      });
      return;
    }

    sendJson(res, 404, {
      ok: false,
      mock: false,
      error: `Unknown route ${method} ${pathname}`,
    });
  });
}

function listenOsBridge(port = DEFAULT_PORT) {
  const server = createOsServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      const address = server.address();
      console.log(`[os-bridge] listening on http://127.0.0.1:${address.port}`);
      resolve(server);
    });
  });
}

module.exports = {
  createOsServer,
  listenOsBridge,
};

if (require.main === module) {
  listenOsBridge().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
