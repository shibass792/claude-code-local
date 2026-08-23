'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const hooks = require('../modules/hooks');

function startOllamaStub(reply) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: [{ name: 'stub-model' }] }));
        return;
      }
      const prompt = JSON.parse(body).messages.at(-1).content;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: { content: reply(prompt) } }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

test('normalizeHashtags dedupes, prefixes and caps the list', () => {
  assert.equal(hooks.normalizeHashtags('psytrance, #bass psytrance'), '#psytrance #bass');
  assert.equal(hooks.normalizeHashtags(['a', '#b']), '#a #b');
  assert.equal(hooks.normalizeHashtags(''), '');
  assert.equal(hooks.normalizeHashtags(Array.from({ length: 30 }, (_, i) => `t${i}`)).split(' ').length, 12);
});

test('truncate keeps hooks short enough to read in 3 seconds', () => {
  const long = 'x'.repeat(hooks.MAX_HOOK_LENGTH + 40);
  const result = hooks.truncate(long);
  assert.equal(result.length, hooks.MAX_HOOK_LENGTH);
  assert.match(result, /…$/);
});

test('normalizeHooks accepts strings, objects and aliased keys', () => {
  const fromStrings = hooks.normalizeHooks(['first', 'second'], 5);
  assert.equal(fromStrings.length, 2);
  assert.equal(fromStrings[0].he, 'first');

  const aliased = hooks.normalizeHooks(
    { hooks: [{ hebrew: 'עברית', english: 'english', reason: 'why' }] },
    5,
  );
  assert.deepEqual(aliased[0], { he: 'עברית', en: 'english', why: 'why' });

  assert.throws(() => hooks.normalizeHooks({}, 3), /hooks" array/);
  assert.throws(() => hooks.normalizeHooks({ hooks: [{ he: '' }] }, 3), /no usable hook/);
});

test('describeTrends grounds the prompt in real radar numbers', () => {
  const text = hooks.describeTrends([
    { artist: 'Astrix', outlierLabel: '3.2x', hookText: 'listen', keyStrategy: 'mystery' },
  ]);
  assert.match(text, /Astrix/);
  assert.match(text, /3\.2x/);
  assert.match(text, /mystery/);
  assert.equal(hooks.describeTrends([]), '');
});

test('describeTrack includes the real probed metadata', () => {
  const text = hooks.describeTrack({ title: 'Dextamine', bpm: 143, key: 'G' });
  assert.match(text, /Dextamine/);
  assert.match(text, /143/);
  assert.match(text, /G/);
});

test('generateHooks returns model output and passes track context in the prompt', async () => {
  let seenPrompt = '';
  const stub = await startOllamaStub((prompt) => {
    seenPrompt = prompt;
    return JSON.stringify({
      hooks: [
        { he: 'הוק ראשון', en: 'first hook', why: 'curiosity' },
        { he: 'הוק שני', en: 'second hook', why: 'tension' },
        { he: 'הוק שלישי', en: 'third hook', why: 'payoff' },
      ],
    });
  });

  process.env.OLLAMA_HOST = stub.url;
  delete process.env.AI_BASE_URL;
  try {
    const result = await hooks.generateHooks({
      track: { title: 'Dextamine', bpm: 143 },
      trends: [{ artist: 'Astrix', outlierLabel: '3.2x', hookText: 'drop' }],
      count: 3,
    });

    assert.equal(result.hooks.length, 3);
    assert.equal(result.hooks[0].he, 'הוק ראשון');
    assert.equal(result.model, 'stub-model');
    assert.match(seenPrompt, /Dextamine/);
    assert.match(seenPrompt, /143/);
    assert.match(seenPrompt, /Astrix/, 'real competitor data reaches the model');
  } finally {
    await stub.close();
    delete process.env.OLLAMA_HOST;
  }
});

test('generateHooks caps the requested count', async () => {
  const stub = await startOllamaStub(() =>
    JSON.stringify({ hooks: Array.from({ length: 10 }, (_, i) => ({ he: `h${i}` })) }),
  );

  process.env.OLLAMA_HOST = stub.url;
  try {
    const result = await hooks.generateHooks({ count: 99 });
    assert.equal(result.hooks.length, 6, 'hard cap of 6');
  } finally {
    await stub.close();
    delete process.env.OLLAMA_HOST;
  }
});

test('generateCaptions normalizes hashtags from the model', async () => {
  const stub = await startOllamaStub(() =>
    JSON.stringify({
      captionHe: '  כיתוב עברי  ',
      captionEn: 'English caption',
      hashtags: 'psytrance, #bass, psytrance',
    }),
  );

  process.env.OLLAMA_HOST = stub.url;
  try {
    const result = await hooks.generateCaptions({ track: { title: 'T' }, hook: 'h' });
    assert.equal(result.captionHe, 'כיתוב עברי');
    assert.equal(result.captionEn, 'English caption');
    assert.equal(result.hashtags, '#psytrance #bass');
  } finally {
    await stub.close();
    delete process.env.OLLAMA_HOST;
  }
});

test('remixHook returns a single rewritten hook', async () => {
  const stub = await startOllamaStub((prompt) => {
    assert.match(prompt, /old hook/);
    return JSON.stringify({ hooks: [{ he: 'חדש', en: 'new', why: 'changed opener' }] });
  });

  process.env.OLLAMA_HOST = stub.url;
  try {
    const result = await hooks.remixHook({ currentHook: 'old hook' });
    assert.equal(result.he, 'חדש');
    assert.equal(result.why, 'changed opener');
  } finally {
    await stub.close();
    delete process.env.OLLAMA_HOST;
  }
});

test('a malformed model reply fails loudly rather than returning canned text', async () => {
  const stub = await startOllamaStub(() => 'I am not JSON');

  process.env.OLLAMA_HOST = stub.url;
  try {
    await assert.rejects(() => hooks.generateHooks({}), /not valid JSON/);
  } finally {
    await stub.close();
    delete process.env.OLLAMA_HOST;
  }
});
