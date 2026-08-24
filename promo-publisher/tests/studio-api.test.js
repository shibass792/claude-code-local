'use strict';

process.env.SHIBASS_OUTPUT_DIR = require('fs').mkdtempSync(
  require('path').join(require('os').tmpdir(), 'shibass-studio-api-'),
);

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { createStudioApiServer } = require('../studio-api');
const library = require('../modules/library');

function listen() {
  const server = createStudioApiServer();
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function request(server, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request({
      hostname: '127.0.0.1',
      port: address.port,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' },
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
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

test('studio API answers OPTIONS so Scan.ps1 does not mark routes missing', async () => {
  const server = await listen();
  try {
    for (const pathName of ['/api/health', '/api/engines', '/api/radar', '/api/hooks', '/api/approval/pending']) {
      const res = await request(server, 'OPTIONS', pathName);
      assert.equal(res.status, 204, pathName);
    }
  } finally {
    server.close();
  }
});

test('studio API health and engines are real JSON, not 404', async () => {
  const server = await listen();
  try {
    const health = await request(server, 'GET', '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.ok, true);
    assert.equal(health.json.mock, false);

    const ops = await request(server, 'GET', '/api/ops/health');
    assert.equal(ops.status, 200);
    assert.equal(ops.json.ok, true);

    const engines = await request(server, 'GET', '/api/engines');
    assert.equal(engines.status, 200);
    assert.ok(engines.json.engines);
    assert.ok(engines.json.engines.ai);
    assert.ok(engines.json.engines.render);

    const pending = await request(server, 'GET', '/api/approval/pending');
    assert.equal(pending.status, 200);
    assert.ok(Array.isArray(pending.json.pending));

    const unknown = await request(server, 'GET', '/api/does-not-exist');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.json.ok, false);
  } finally {
    server.close();
  }
});

test('studio API implements music, connections, and honest unavailable prefixes', async () => {
  const server = await listen();
  try {
    const music = await request(server, 'GET', '/api/music/index');
    assert.equal(music.status, 200);
    assert.equal(typeof music.json.indexed, 'boolean');

    const search = await request(server, 'GET', '/api/music/search?q=test');
    assert.equal(search.status, 200);
    assert.ok(Array.isArray(search.json.tracks));

    const connections = await request(server, 'GET', '/api/connections');
    assert.equal(connections.status, 200);
    assert.ok(connections.json.ai);
    assert.ok(connections.json.renderer);

    const instagram = await request(server, 'GET', '/api/instagram/session');
    assert.equal(instagram.status, 200);
    assert.equal(instagram.json.available, false);
    assert.equal(instagram.json.mock, false);

    const missingStream = await request(server, 'GET', '/api/music/stream/does-not-exist');
    assert.equal(missingStream.status, 404);

    const escaped = await request(server, 'GET', '/api/file?path=' + encodeURIComponent('../../../etc/passwd'));
    assert.equal(escaped.json.exists, false);
  } finally {
    server.close();
  }
});

test('studio API streams an indexed audio file', async () => {
  const audioPath = path.join(process.env.SHIBASS_OUTPUT_DIR, 'clip.wav');
  fs.writeFileSync(audioPath, Buffer.from('RIFF'));
  fs.writeFileSync(library.MUSIC_INDEX, JSON.stringify({
    scannedAt: new Date().toISOString(),
    roots: [process.env.SHIBASS_OUTPUT_DIR],
    totals: { all: 1, audio: 1, midi: 0, project: 0 },
    tracks: [{
      path: audioPath,
      name: 'clip',
      fileName: 'clip.wav',
      displayName: 'clip',
      category: 'audio',
    }],
  }));

  const server = await listen();
  try {
    const res = await request(server, 'GET', '/api/music/stream/clip.wav');
    assert.equal(res.status, 200);
    assert.ok(res.json === null || res.raw);
  } finally {
    server.close();
  }
});
