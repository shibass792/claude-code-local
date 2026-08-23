const axios = require('axios');
const { appendLog, snapshotState } = require('./creation-log');
const { probeOllama } = require('./engines');

function buildMetadataHooks({ title, bpm, key }) {
  const track = title || 'ShiBass Progressive Psytrance';
  const pace = bpm ? `${bpm} BPM` : '142 BPM';
  const scale = key ? ` in ${key}` : '';
  return [
    `הסוד לקיק ובס של ${pace} בטראק ${track}${scale}`,
    `3 טעויות שכולם עושים במיקס בס פסיטראנס — ${track}`,
    `שמעתם את הדרופ הזה? ${track} בחוץ עכשיו! 🚀`,
  ];
}

function parseHookList(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+[\).:\-]\s*/, '').trim())
    .filter((line) => line.length > 8)
    .slice(0, 5);
}

async function generateWithOllama({ title, bpm, key, language }) {
  const status = await probeOllama();
  if (!status.available) {
    return { ok: false, error: status.error, host: status.host };
  }

  const model = process.env.OLLAMA_MODEL || status.model || 'llama3.2';
  const prompt = [
    'You write viral Instagram Reel hooks for a psytrance producer named ShiBass.',
    `Track: ${title || 'untitled'}`,
    bpm ? `BPM: ${bpm}` : '',
    key ? `Key: ${key}` : '',
    `Language mix: ${language || 'Hebrew + English'}`,
    'Return exactly 3 hooks, one per line, no numbering preamble.',
    'Each hook must be under 90 characters and mention a concrete musical detail.',
  ]
    .filter(Boolean)
    .join('\n');

  const res = await axios.post(
    `${status.host.replace(/\/$/, '')}/api/generate`,
    {
      model,
      prompt,
      stream: false,
      options: { temperature: 0.8, num_predict: 180 },
    },
    { timeout: 45000 },
  );

  const hooks = parseHookList(res.data?.response);
  if (hooks.length < 2) {
    return { ok: false, error: 'Ollama returned too few hooks', raw: res.data?.response };
  }
  return { ok: true, engine: 'ollama', model, hooks };
}

async function generateWithOpenAiCompat({ title, bpm, key, language }) {
  const base = process.env.OPENAI_BASE_URL || process.env.ANTHROPIC_BASE_URL;
  if (!base) {
    return { ok: false, error: 'No OpenAI-compatible base URL' };
  }

  const res = await axios.post(
    `${base.replace(/\/$/, '')}/chat/completions`,
    {
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Write exactly 3 viral Instagram Reel hooks. One per line.',
        },
        {
          role: 'user',
          content: `ShiBass track "${title}" ${bpm || ''} BPM ${key || ''} language=${language || 'he/en'}`,
        },
      ],
      temperature: 0.8,
    },
    {
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY || 'sk-local'}`,
        'Content-Type': 'application/json',
      },
    },
  );

  const text = res.data?.choices?.[0]?.message?.content;
  const hooks = parseHookList(text);
  if (hooks.length < 2) {
    return { ok: false, error: 'Compatible LLM returned too few hooks' };
  }
  return { ok: true, engine: 'openai_compat', hooks };
}

async function generateViralHooks(input = {}) {
  const title = input.title || input.trackTitle || 'ShiBass Progressive Psytrance';
  const bpm = input.bpm || input.tempo;
  const key = input.key;
  const language = input.language || 'he';

  let result = await generateWithOllama({ title, bpm, key, language }).catch((error) => ({
    ok: false,
    error: error.message,
  }));

  if (!result.ok) {
    result = await generateWithOpenAiCompat({ title, bpm, key, language }).catch((error) => ({
      ok: false,
      error: error.message,
    }));
  }

  if (!result.ok) {
    const hooks = buildMetadataHooks({ title, bpm, key });
    const payload = {
      success: true,
      mock: false,
      engine: 'metadata',
      fallbackReason: result.error || 'LLM unavailable',
      title,
      bpm: bpm ?? null,
      key: key ?? null,
      hooks,
    };
    appendLog({
      source: 'reelhook',
      message: `Generated ${hooks.length} hooks via metadata engine (LLM offline: ${payload.fallbackReason})`,
      hooks,
    });
    snapshotState({ lastHooks: payload });
    return payload;
  }

  const payload = {
    success: true,
    mock: false,
    engine: result.engine,
    model: result.model ?? null,
    title,
    bpm: bpm ?? null,
    key: key ?? null,
    hooks: result.hooks,
  };
  appendLog({
    source: 'reelhook',
    message: `Generated ${payload.hooks.length} viral hooks via ${payload.engine}`,
    hooks: payload.hooks,
  });
  snapshotState({ lastHooks: payload });
  return payload;
}

module.exports = {
  buildMetadataHooks,
  parseHookList,
  generateViralHooks,
};
