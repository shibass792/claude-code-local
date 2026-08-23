'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { classifyPath, isStudioProxyPath, STUDIO_PREFIXES } = require('./routes');
const { extractApiPaths, collectEndpoints, buildScanReport } = require('./scan');
const { tryHandleOsBridge } = require('./proxy');
const { patchServerSource, patchServerFile } = require('./patch-server');
const { applyOsBridge } = require('./apply');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function request(server, method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request({
      hostname: '127.0.0.1',
      port: address.port,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = raw ? JSON.parse(raw) : null;
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode, json, raw });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('classify studio, local, ollama, and unknown paths', () => {
  assert.equal(classifyPath('/api/engines').kind, 'studio-proxy');
  assert.equal(classifyPath('/api/approval/publish').kind, 'studio-proxy');
  assert.equal(classifyPath('/api/os/health').kind, 'os-bridge');
  assert.equal(classifyPath('/api/sb-daw/jobs/').kind, 'sb-daw');
  assert.equal(classifyPath('/api/health').kind, 'local-ide');
  assert.equal(classifyPath('/api/tags').kind, 'ollama');
  assert.equal(classifyPath('/api/generate').kind, 'ollama');
  assert.equal(classifyPath('/api/mystery').kind, 'unknown');
  assert.equal(isStudioProxyPath('/api/health'), false);
  assert.equal(isStudioProxyPath('/api/sb-daw/jobs/'), false);
  assert.equal(isStudioProxyPath('/api/engines'), true);
  assert.ok(STUDIO_PREFIXES.includes('/api/scan'));
});

test('extract matches the interactive PowerShell fetch/axios regex plus json()', () => {
  const source = [
    "fetch('/api/radar')",
    "axios.get('/api/engines')",
    "axios.post(window.__getApiBase() + '/api/render')",
    "json('GET', '/api/approval/pending')",
    "fetch(`/api/music/stream/${track.id}`)",
  ].join('\n');
  const found = extractApiPaths(source);
  assert.ok(found.includes('/api/radar'));
  assert.ok(found.includes('/api/engines'));
  assert.ok(found.includes('/api/render'));
  assert.ok(found.includes('/api/approval/pending'));
  assert.ok(found.includes('/api/music/stream'));
});

test('scan classifies promo-publisher UI calls as studio-proxy', () => {
  const root = path.join(__dirname, '..', '..', 'promo-publisher', 'ui');
  const rows = collectEndpoints(root);
  const engines = rows.find((row) => row.endpoint === '/api/engines');
  assert.ok(engines);
  assert.equal(engines.kind, 'studio-proxy');
  assert.equal(engines.host, 4052);
  const report = buildScanReport({ root });
  assert.equal(report.mock, false);
  assert.ok(report.summary.counts.studioProxy >= 8);
});

test('OPTIONS on studio routes is 204 even when Studio API is down', async () => {
  const prev = process.env.STUDIO_API_ORIGIN;
  process.env.STUDIO_API_ORIGIN = 'http://127.0.0.1:9';
  const server = await listen((req, res) => {
    if (!tryHandleOsBridge(req, res)) {
      res.writeHead(404);
      res.end('nope');
    }
  });
  try {
    const options = await request(server, 'OPTIONS', '/api/engines');
    assert.equal(options.status, 204);

    const proxied = await request(server, 'GET', '/api/engines');
    assert.equal(proxied.status, 502);
    assert.equal(proxied.json.mock, false);
    assert.match(proxied.json.error, /Studio API not running/);

    const skipped = await request(server, 'GET', '/api/health');
    assert.equal(skipped.status, 404);
    const jobs = await request(server, 'GET', '/api/sb-daw/jobs/');
    assert.equal(jobs.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (prev === undefined) {
      delete process.env.STUDIO_API_ORIGIN;
    } else {
      process.env.STUDIO_API_ORIGIN = prev;
    }
  }
});

test('GET /api/os/health reports studio down without faking success', async () => {
  const prev = process.env.STUDIO_API_ORIGIN;
  process.env.STUDIO_API_ORIGIN = 'http://127.0.0.1:9';
  const server = await listen((req, res) => {
    if (!tryHandleOsBridge(req, res)) {
      res.writeHead(404);
      res.end('nope');
    }
  });
  try {
    const health = await request(server, 'GET', '/api/os/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.ok, true);
    assert.equal(health.json.mock, false);
    assert.equal(health.json.studio.up, false);
    assert.ok(health.json.proxied.includes('/api/engines'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (prev === undefined) {
      delete process.env.STUDIO_API_ORIGIN;
    } else {
      process.env.STUDIO_API_ORIGIN = prev;
    }
  }
});

test('GET /api/engines proxies to a live Studio API', async () => {
  const studio = await listen((req, res) => {
    if (req.url.startsWith('/api/engines')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, mock: false, engines: ['ffmpeg'] }));
      return;
    }
    if (req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const prev = process.env.STUDIO_API_ORIGIN;
  process.env.STUDIO_API_ORIGIN = `http://127.0.0.1:${studio.address().port}`;
  const osServer = await listen((req, res) => {
    if (!tryHandleOsBridge(req, res)) {
      res.writeHead(404);
      res.end('nope');
    }
  });
  try {
    const engines = await request(osServer, 'GET', '/api/engines');
    assert.equal(engines.status, 200);
    assert.equal(engines.json.mock, false);
    assert.deepEqual(engines.json.engines, ['ffmpeg']);

    const health = await request(osServer, 'GET', '/api/os/health');
    assert.equal(health.json.studio.up, true);
  } finally {
    await new Promise((resolve) => osServer.close(resolve));
    await new Promise((resolve) => studio.close(resolve));
    if (prev === undefined) {
      delete process.env.STUDIO_API_ORIGIN;
    } else {
      process.env.STUDIO_API_ORIGIN = prev;
    }
  }
});

test('POST body is forwarded to Studio API', async () => {
  let received = '';
  const studio = await listen((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received = Buffer.concat(chunks).toString('utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, mock: false, echo: JSON.parse(received) }));
    });
  });
  const prev = process.env.STUDIO_API_ORIGIN;
  process.env.STUDIO_API_ORIGIN = `http://127.0.0.1:${studio.address().port}`;
  const osServer = await listen((req, res) => {
    if (!tryHandleOsBridge(req, res)) {
      res.writeHead(404);
      res.end('nope');
    }
  });
  try {
    const posted = await request(osServer, 'POST', '/api/hooks', { topic: 'drop' });
    assert.equal(posted.status, 200);
    assert.equal(posted.json.echo.topic, 'drop');
    assert.match(received, /drop/);
  } finally {
    await new Promise((resolve) => osServer.close(resolve));
    await new Promise((resolve) => studio.close(resolve));
    if (prev === undefined) {
      delete process.env.STUDIO_API_ORIGIN;
    } else {
      process.env.STUDIO_API_ORIGIN = prev;
    }
  }
});

test('patcher inserts the OS bridge after the sb-daw mount', () => {
  const source = [
    "const http = require('http');",
    'function onRequest(req, res) {',
    '  // shibass-sb-daw-jobs-mount',
    "  if (require('./tools/sb-daw/mount').tryHandleSbDaw(req, res)) return;",
    '  // explicit health-check path: /api/sb-daw/jobs/',
    "  res.end('legacy');",
    '}',
    'http.createServer(onRequest).listen(4000);',
    '',
  ].join('\n');
  const patched = patchServerSource(source, path.join('/tmp/fake-os', 'server.js'));
  assert.equal(patched.changed, true);
  const jobsAt = patched.source.indexOf('tryHandleSbDaw');
  const bridgeAt = patched.source.indexOf('tryHandleOsBridge');
  assert.ok(jobsAt >= 0 && bridgeAt > jobsAt);
  assert.match(patched.source, /\/api\/os\/health/);
});

test('applyOsBridge patches a fixture server.js', () => {
  const root = tempDir('os-bridge-root-');
  fs.writeFileSync(path.join(root, 'server.js'), [
    "const http = require('http');",
    'function onRequest(req, res) {',
    "  res.end('legacy');",
    '}',
    'http.createServer(onRequest).listen(4000);',
    '',
  ].join('\n'));
  const report = applyOsBridge(root);
  assert.equal(report.ok, true);
  assert.equal(report.mock, false);
  const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(serverSource, /tryHandleOsBridge/);
  assert.match(serverSource, /\/api\/os\/health/);
  const again = patchServerFile(path.join(root, 'server.js'));
  assert.equal(again.changed, false);
});

test('Windows installer scripts are ASCII so PowerShell 5.1 does not eat quotes', () => {
  const files = [
    path.join(__dirname, 'Patch-OsBridge.ps1'),
    path.join(__dirname, '..', '..', 'INSTALL-OS-BRIDGE.ps1'),
    path.join(__dirname, '..', '..', 'Scan-ShiBassApis.ps1'),
  ];
  for (const filePath of files) {
    const bytes = fs.readFileSync(filePath);
    for (let i = 0; i < bytes.length; i += 1) {
      assert.ok(bytes[i] <= 127, `${path.basename(filePath)} has non-ASCII at byte ${i}`);
    }
  }
});
