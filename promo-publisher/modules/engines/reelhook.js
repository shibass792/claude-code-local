const axios = require('axios');
const { appendLog } = require('./creation-log');

function getOllamaConfig() {
  return {
    host: (process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434').replace(/\/$/, ''),
    model: process.env.OLLAMA_MODEL ?? 'myllama',
  };
}

function localHooks(input) {
  const title = (input.title ?? 'ShiBass').trim() || 'ShiBass';
  const bpm = Number(input.bpm) || 142;
  const style = (input.style ?? 'Progressive Psytrance').trim();
  const key = (input.key ?? '').trim();
  const keyBit = key ? ` ${key}` : '';

  return [
    {
      lang: 'he',
      text: `הסוד לקיק ובס של ${bpm} BPM שלא תמצא בשום קורס — ${title}`,
    },
    {
      lang: 'he',
      text: `3 טעויות שכולם עושים במיקס של בס ${style}${keyBit} 🎹`,
    },
    {
      lang: 'en',
      text: `Heard this drop? ${title} is out now — ${style} ${bpm} BPM 🚀`,
    },
  ];
}

function parseHooksFromModel(text, fallbackInput) {
  if (!text || typeof text !== 'string') {
    return localHooks(fallbackInput);
  }

  const lines = text
    .split('\n')
    .map((line) => line.replace(/^\s*\d+[\).:-]\s*/, '').trim())
    .filter((line) => line.length >= 8)
    .slice(0, 3);

  if (lines.length < 2) {
    return localHooks(fallbackInput);
  }

  return lines.map((line, index) => ({
    lang: index < 2 ? 'he' : 'en',
    text: line,
  }));
}

async function pingOllama() {
  const { host } = getOllamaConfig();
  try {
    const res = await axios.get(`${host}/api/tags`, { timeout: 4000 });
    return {
      ok: true,
      host,
      models: (res.data?.models ?? []).map((model) => model.name),
    };
  } catch (error) {
    return {
      ok: false,
      host,
      error: error.message,
    };
  }
}

async function generateHooks(input = {}) {
  const cfg = getOllamaConfig();
  const prompt = [
    'Write exactly 3 short viral social-video hooks for a psytrance producer.',
    `Title: ${input.title ?? 'ShiBass'}`,
    `BPM: ${input.bpm ?? 142}`,
    `Style: ${input.style ?? 'Progressive Psytrance'}`,
    `Key: ${input.key ?? 'unknown'}`,
    'Return only the 3 hooks, numbered 1-3. Mix Hebrew and English.',
  ].join('\n');

  const ollama = await pingOllama();
  if (!ollama.ok) {
    const hooks = localHooks(input);
    appendLog({
      engine: 'reelhook',
      event: 'generate',
      level: 'warn',
      message: `Ollama unreachable (${ollama.error}) — local metadata hooks`,
      data: { source: 'local-metadata', title: input.title ?? null, bpm: input.bpm ?? null },
    });
    return {
      ok: true,
      source: 'local-metadata',
      ollama,
      hooks,
    };
  }

  try {
    const res = await axios.post(
      `${cfg.host}/api/generate`,
      {
        model: cfg.model,
        prompt,
        stream: false,
      },
      { timeout: 45000 },
    );

    const hooks = parseHooksFromModel(res.data?.response, input);
    appendLog({
      engine: 'reelhook',
      event: 'generate',
      message: `Ollama ${cfg.model} generated ${hooks.length} hooks`,
      data: { source: 'ollama', model: cfg.model, title: input.title ?? null },
    });
    return {
      ok: true,
      source: 'ollama',
      model: cfg.model,
      ollama,
      hooks,
    };
  } catch (error) {
    const hooks = localHooks(input);
    appendLog({
      engine: 'reelhook',
      event: 'generate',
      level: 'warn',
      message: `Ollama generate failed (${error.message}) — local metadata hooks`,
      data: { source: 'local-metadata', error: error.message },
    });
    return {
      ok: true,
      source: 'local-metadata',
      ollama: { ok: false, host: cfg.host, error: error.message },
      hooks,
    };
  }
}

module.exports = {
  getOllamaConfig,
  localHooks,
  parseHooksFromModel,
  pingOllama,
  generateHooks,
};
