const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createJob, listJobs, patchJob } = require('./jobs');
const { tryHandleSbDaw } = require('./http');
const { patchServerSource, patchServerFile } = require('./patch-server');
const { patchFastapiSource } = require('./patch-fastapi');
const { rewriteSbDawHtml } = require('./patch-html');
const { healthReport, missingApiPaths } = require('./health-scan');
const { applySbDaw } = require('./apply');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function withJobsFile(fn) {
  const dir = tempDir('sb-daw-jobs-');
  const prev = process.env.SB_DAW_JOBS_PATH;
  process.env.SB_DAW_JOBS_PATH = path.join(dir, 'jobs.json');
  try {
    return await fn(dir);
  } finally {
    if (prev === undefined) {
      delete process.env.SB_DAW_JOBS_PATH;
    } else {
      process.env.SB_DAW_JOBS_PATH = prev;
    }
  }
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
        resolve({
          status: res.statusCode,
          json: raw ? JSON.parse(raw) : null,
        });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

test('createJob queues a real record job without faking a bounce', async () => {
  await withJobsFile(() => {
    const created = createJob({ type: 'record', title: 'Take 1' });
    assert.equal(created.mock, false);
    assert.equal(created.job.status, 'queued');
    assert.equal(created.job.type, 'record');
    assert.match(created.job.note, /does not fake/i);

    const listed = listJobs();
    assert.equal(listed.path, '/api/sb-daw/jobs/');
    assert.equal(listed.count, 1);
    assert.equal(listed.io.probed, false);
    assert.equal(listed.io.sampleRate, 44100);
    assert.equal(listed.io.bitDepth, 24);
  });
});

test('createJob rejects unknown types', async () => {
  await withJobsFile(() => {
    assert.throws(() => createJob({ type: 'teleport' }), /Unsupported job type/);
  });
});

test('raw HTTP server serves /api/sb-daw/jobs/', async () => {
  await withJobsFile(async () => {
    const server = http.createServer((req, res) => {
      if (!tryHandleSbDaw(req, res)) {
        res.writeHead(404);
        res.end('nope');
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const empty = await request(server, 'GET', '/api/sb-daw/jobs/');
      assert.equal(empty.status, 200);
      assert.equal(empty.json.mock, false);
      assert.equal(empty.json.path, '/api/sb-daw/jobs/');
      assert.deepEqual(empty.json.jobs, []);

      const created = await request(server, 'POST', '/api/sb-daw/jobs/', {
        type: 'preview',
        title: 'CR check',
      });
      assert.equal(created.status, 201);
      assert.equal(created.json.job.status, 'queued');

      const one = await request(server, 'GET', `/api/sb-daw/jobs/${created.json.job.id}`);
      assert.equal(one.status, 200);
      assert.equal(one.json.job.title, 'CR check');

      const patched = await request(server, 'POST', `/api/sb-daw/jobs/${created.json.job.id}`, {
        status: 'running',
      });
      assert.equal(patched.status, 200);
      assert.equal(patched.json.job.status, 'running');
      assert.equal(patchJob(created.json.job.id, { status: 'done' }).job.status, 'done');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test('panel health scan flags missing /api/sb-daw/jobs/ then clears after patch', () => {
  const html = `<script>fetch('/api/sb-daw/jobs/')</script>`;
  const before = [
    "const http = require('http');",
    'const server = http.createServer((req, res) => {',
    "  res.end('ok');",
    '});',
    'server.listen(4000);',
    '',
  ].join('\n');

  const missing = missingApiPaths(html, before);
  assert.deepEqual(missing, ['/api/sb-daw/jobs/']);
  assert.equal(healthReport(html, before).ok, false);

  const patched = patchServerSource(before, path.join('/tmp/fake-root', 'server.js'));
  assert.equal(patched.changed, true);
  assert.match(patched.source, /\/api\/sb-daw\/jobs\//);
  assert.equal(healthReport(html, patched.source).ok, true);
  assert.deepEqual(healthReport(html, patched.source).missing, []);
});

test('patcher injects mount before app.listen', () => {
  const source = [
    "const express = require('express');",
    'const app = express();',
    "app.get('/health', (req, res) => res.json({ ok: true }));",
    'app.listen(4000);',
    '',
  ].join('\n');
  const patched = patchServerSource(source, '/tmp/app/server.js');
  const listenAt = patched.source.indexOf('app.listen(4000)');
  const routeAt = patched.source.indexOf('/api/sb-daw/jobs/');
  assert.ok(routeAt >= 0 && routeAt < listenAt);
  assert.match(patched.source, /mountSbDawJobs\(app\)/);
});

test('applySbDaw patches a fixture tree so the health check passes', () => {
  const root = tempDir('sb-daw-root-');
  fs.writeFileSync(path.join(root, 'server.js'), [
    "const http = require('http');",
    'function onRequest(req, res) {',
    "  res.end('legacy');",
    '}',
    'http.createServer(onRequest).listen(4000);',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'sb-daw.html'), [
    '<!doctype html><html><body>',
    "<script>fetch('/api/sb-daw/jobs/')</script>",
    '</body></html>',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'synth_studio.py'), [
    'from fastapi import FastAPI',
    'app = FastAPI()',
    'if __name__ == "__main__":',
    '    pass',
    '',
  ].join('\n'));

  const report = applySbDaw(root);
  assert.equal(report.ok, true);
  assert.equal(report.route, '/api/sb-daw/jobs/');
  assert.equal(report.servers[0].containsRoute, true);
  assert.equal(report.fastapi[0].changed, true);
  assert.ok(fs.existsSync(path.join(root, '_shibass_sb_daw_jobs.py')));

  const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'sb-daw.html'), 'utf8');
  assert.equal(healthReport(html, serverSource).ok, true);
});

test('FastAPI patcher inserts the jobs route before uvicorn', () => {
  const source = [
    'from fastapi import FastAPI',
    'app = FastAPI()',
    'uvicorn.run(app, host="127.0.0.1", port=8788)',
    '',
  ].join('\n');
  const patched = patchFastapiSource(source);
  assert.equal(patched.changed, true);
  assert.match(patched.source, /\/api\/sb-daw\/jobs\//);
  assert.ok(patched.source.indexOf('install_sb_daw_jobs(app)') < patched.source.indexOf('uvicorn.run'));
});

test('HTML rewriter keeps the jobs path while pointing at port 4000', () => {
  const html = "<script>fetch('/api/sb-daw/jobs/')</script>";
  const rewritten = rewriteSbDawHtml(html);
  assert.equal(rewritten.changed, true);
  assert.match(rewritten.source, /http:\/\/127\.0\.0\.1:4000\/api\/sb-daw\/jobs\//);
  assert.match(rewritten.source, /shibass-sb-daw-jobs-html/);
  assert.deepEqual(require('./health-scan').extractApiPaths(rewritten.source), ['/api/sb-daw/jobs/']);
});

test('Windows installer scripts are ASCII so PowerShell 5.1 does not eat quotes', () => {
  const files = [
    path.join(__dirname, 'Patch-SbDawJobs.ps1'),
    path.join(__dirname, '..', '..', 'INSTALL-SB-DAW-JOBS.ps1'),
  ];
  for (const filePath of files) {
    const bytes = fs.readFileSync(filePath);
    for (let i = 0; i < bytes.length; i += 1) {
      assert.ok(bytes[i] <= 127, `${path.basename(filePath)} has non-ASCII at byte ${i}`);
    }
  }
});
