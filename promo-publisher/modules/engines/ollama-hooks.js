const axios = require('axios');
const { appendLog } = require('../creation-log');

function getOllamaConfig() {
  return {
    host: (process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434').replace(/\/$/, ''),
    model: process.env.OLLAMA_MODEL ?? 'myllama',
  };
}

function parseHooksFromText(text) {
  if (typeof text !== 'string') {
    return [];
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter((line) => line.length >= 8 && line.length <= 180);

  const unique = [];
  for (const line of lines) {
    if (!unique.includes(line)) {
      unique.push(line);
    }
    if (unique.length >= 3) {
      break;
    }
  }
  return unique;
}

function buildPrompt({ title, bpm, key, language }) {
  const lang = language === 'en' ? 'English' : 'Hebrew';
  return [
    `Write exactly 3 viral Instagram Reel hooks for a psytrance producer.`,
    `Track: ${title ?? 'ShiBass track'}`,
    bpm ? `BPM: ${bpm}` : '',
    key ? `Key: ${key}` : '',
    `Language: ${lang}. One line each. No numbering preamble. No quotes.`,
    `Focus on kick/bass, drop, and a call to listen now.`,
  ]
    .filter(Boolean)
    .join('\n');
}

async function generateViralHooks(options = {}) {
  const cfg = getOllamaConfig();
  const prompt = buildPrompt(options);

  appendLog('info', 'reelhook', `Calling Ollama ${cfg.model} at ${cfg.host}`);

  try {
    const response = await axios.post(
      `${cfg.host}/api/generate`,
      {
        model: cfg.model,
        prompt,
        stream: false,
      },
      { timeout: 45000 },
    );

    const text = response.data?.response ?? '';
    const hooks = parseHooksFromText(text);
    if (hooks.length < 3) {
      throw new Error('Ollama returned fewer than 3 usable hooks');
    }

    appendLog('success', 'reelhook', 'Generated 3 viral hooks from Ollama', {
      model: cfg.model,
    });

    return {
      live: true,
      engine: 'ollama',
      model: cfg.model,
      hooks,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendLog('error', 'reelhook', `Ollama call failed: ${message}`);
    throw new Error(`Ollama hook generation failed: ${message}`);
  }
}

async function probeOllama() {
  const cfg = getOllamaConfig();
  try {
    const response = await axios.get(`${cfg.host}/api/tags`, { timeout: 4000 });
    const models = (response.data?.models ?? []).map((item) => item.name);
    return {
      configured: true,
      live: true,
      host: cfg.host,
      model: cfg.model,
      models,
    };
  } catch (error) {
    return {
      configured: Boolean(cfg.host),
      live: false,
      host: cfg.host,
      model: cfg.model,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

module.exports = {
  getOllamaConfig,
  parseHooksFromText,
  buildPrompt,
  generateViralHooks,
  probeOllama,
};
