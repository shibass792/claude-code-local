const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');

const { parseHooksFromText, buildPrompt } = require('../modules/engines/ollama-hooks');
const { quoteDrawtext, probeFfmpeg, renderVerticalReel } = require('../modules/engines/ffmpeg-render');
const { classify, fileId, scanLibrary } = require('../modules/engines/library-index');
const { appendLog, getFormattedLog, clearLog, readLog } = require('../modules/creation-log');
const approval = require('../modules/approval-publisher');
const { createStudioApiServer } = require('../modules/api-server');
const { OUTPUT_DIR, ensureDir } = require('../modules/store');

function writeSilentWav(filePath, seconds = 1) {
  const sampleRate = 8000;
  const samples = sampleRate * seconds;
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(filePath, buffer);
}

test('parseHooksFromText keeps three unique lines', () => {
  const hooks = parseHooksFromText('1. first hook here\n2. second hook here\n3. third hook here\n2. second hook here');
  assert.equal(hooks.length, 3);
  assert.equal(hooks[0], 'first hook here');
});

test('buildPrompt includes title and bpm', () => {
  const prompt = buildPrompt({ title: 'Dextamine', bpm: 143, language: 'he' });
  assert.match(prompt, /Dextamine/);
  assert.match(prompt, /143/);
});

test('quoteDrawtext escapes ffmpeg specials', () => {
  assert.equal(quoteDrawtext("A:B'C"), "A\\:B\\'C");
});

test('library classify and scan find fixture wav', () => {
  const libDir = path.join(OUTPUT_DIR, 'library-fixtures');
  ensureDir(libDir);
  const wav = path.join(libDir, 'fixture_scan.wav');
  writeSilentWav(wav);
  assert.equal(classify('.wav'), 'audio');
  assert.equal(fileId(wav).length, 16);
  const result = scanLibrary([libDir]);
  assert.equal(result.live, true);
  assert.ok(result.items.some((item) => item.name === 'fixture_scan.wav'));
});

test('creation log appends live lines', () => {
  clearLog();
  appendLog('info', 'test', 'hello engine');
  const text = getFormattedLog();
  assert.match(text, /hello engine/);
  assert.equal(readLog().length, 1);
});

test('publishCampaign refuses missing video instead of mock', async () => {
  const result = await approval.publishCampaign({
    id: 'no_video',
    title: 'None',
    watched: true,
    videoPath: 'output/does-not-exist.mp4',
    platforms: ['instagram'],
  });
  assert.equal(result.success, false);
  assert.equal(result.mock, false);
  assert.match(result.error, /וידאו/);
});

test('health API reports real engine probes', async () => {
  const server = createStudioApiServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const payload = await new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/api/health`, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', reject);
  });
  server.close();
  assert.ok(payload.instagram);
  assert.ok(payload.ffmpeg);
  assert.ok(payload.ollama);
  assert.ok(payload.library);
  assert.equal(payload.instagram.engine, 'meta-graph');
});

test('ffmpeg render writes a real 9:16 mp4 when ffmpeg exists', async (t) => {
  const probe = await probeFfmpeg();
  if (!probe.live) {
    t.skip('ffmpeg is not installed in this environment');
    return;
  }
  const wav = path.join(OUTPUT_DIR, 'fixture_render.wav');
  ensureDir(OUTPUT_DIR);
  writeSilentWav(wav, 1);
  const rendered = await renderVerticalReel({
    audioPath: wav,
    hook: 'ShiBass test hook',
    title: 'Fixture',
  });
  assert.equal(rendered.live, true);
  assert.ok(fs.existsSync(rendered.outputPath));
  assert.ok(fs.statSync(rendered.outputPath).size > 1024);
});
