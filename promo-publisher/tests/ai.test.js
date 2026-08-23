'use strict';

/**
 * The AI client is tested against a stub server that speaks the real Ollama and
 * OpenAI-compatible wire formats, so a protocol regression fails here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const ai = require('../modules/ai');

function startStub(handler) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => handler(req, res, body ? JSON.parse(body) : null));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

function clearAiEnv() {
  delete process.env.AI_BASE_URL;
  delete process.env.AI_API_KEY;
  delete process.env.AI_MODEL;
  delete process.env.OLLAMA_HOST;
  delete process.env.OLLAMA_MODEL;
}

test('getAiConfig defaults to Ollama and switches on AI_BASE_URL', () => {
  clearAiEnv();
  assert.equal(ai.getAiConfig().provider, 'ollama');
  assert.equal(ai.getAiConfig().baseUrl, ai.DEFAULT_OLLAMA_HOST);

  process.env.AI_BASE_URL = 'http://127.0.0.1:8080/v1/';
  const cfg = ai.getAiConfig();
  assert.equal(cfg.provider, 'openai-compatible');
  assert.equal(cfg.baseUrl, 'http://127.0.0.1:8080/v1', 'trailing slash is trimmed');

  clearAiEnv();
});

test('extractJson survives prose and code fences', () => {
  assert.deepEqual(ai.extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(ai.extractJson('```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(ai.extractJson('Sure! Here you go:\n{"a":3}\nHope that helps.'), { a: 3 });
  assert.deepEqual(ai.extractJson('[{"b":4}]'), [{ b: 4 }]);
  assert.throws(() => ai.extractJson('no json at all'), /not valid JSON/);
});

test('listModels reads the real /api/tags shape', async () => {
  clearAiEnv();
  const stub = await startStub((req, res) => {
    assert.equal(req.url, '/api/tags');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ models: [{ name: 'llama3.1:8b' }, { name: 'qwen2.5:7b' }] }));
  });

  process.env.OLLAMA_HOST = stub.url;
  try {
    assert.deepEqual(await ai.listModels(), ['llama3.1:8b', 'qwen2.5:7b']);
    const health = await ai.checkHealth();
    assert.equal(health.ok, true);
    assert.equal(health.model, 'llama3.1:8b', 'falls back to the first installed model');
  } finally {
    await stub.close();
    clearAiEnv();
  }
});

test('chat posts to /api/chat and returns the assistant text', async () => {
  clearAiEnv();
  let received = null;
  const stub = await startStub((req, res, body) => {
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'test-model' }] }));
      return;
    }
    received = { url: req.url, body };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: { role: 'assistant', content: '{"hooks":[]}' } }));
  });

  process.env.OLLAMA_HOST = stub.url;
  try {
    const result = await ai.chat({ system: 'sys', prompt: 'hi', json: true });
    assert.equal(result.text, '{"hooks":[]}');
    assert.equal(result.model, 'test-model');
    assert.equal(received.url, '/api/chat');
    assert.equal(received.body.stream, false);
    assert.equal(received.body.format, 'json');
    assert.deepEqual(received.body.messages, [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]);
  } finally {
    await stub.close();
    clearAiEnv();
  }
});

test('chat speaks the OpenAI-compatible shape when AI_BASE_URL is set', async () => {
  clearAiEnv();
  let received = null;
  const stub = await startStub((req, res, body) => {
    received = { url: req.url, body, auth: req.headers.authorization };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'hello there' } }] }));
  });

  process.env.AI_BASE_URL = `${stub.url}/v1`;
  process.env.AI_API_KEY = 'secret-key';
  process.env.AI_MODEL = 'local-mlx';
  try {
    const result = await ai.chat({ prompt: 'hi' });
    assert.equal(result.text, 'hello there');
    assert.equal(received.url, '/v1/chat/completions');
    assert.equal(received.auth, 'Bearer secret-key');
    assert.equal(received.body.model, 'local-mlx');
  } finally {
    await stub.close();
    clearAiEnv();
  }
});

test('an unreachable engine raises AiUnavailableError instead of inventing output', async () => {
  clearAiEnv();
  // Port 1 is reserved and never listening.
  process.env.OLLAMA_HOST = 'http://127.0.0.1:1';
  process.env.OLLAMA_MODEL = 'whatever';
  try {
    await assert.rejects(
      () => ai.chat({ prompt: 'hi' }),
      (error) => error instanceof ai.AiUnavailableError,
    );

    const health = await ai.checkHealth();
    assert.equal(health.ok, false);
    assert.match(health.error, /Cannot reach AI engine/);
  } finally {
    clearAiEnv();
  }
});

test('HTTP errors from the engine are surfaced, not swallowed', async () => {
  clearAiEnv();
  const stub = await startStub((req, res) => {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('model exploded');
  });

  process.env.OLLAMA_HOST = stub.url;
  process.env.OLLAMA_MODEL = 'm';
  try {
    await assert.rejects(() => ai.chat({ prompt: 'hi' }), /HTTP 500.*model exploded/s);
  } finally {
    await stub.close();
    clearAiEnv();
  }
});
