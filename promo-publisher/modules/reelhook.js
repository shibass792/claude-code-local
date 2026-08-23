const DEFAULT_OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

function extractBpm(text) {
  const match = String(text ?? '').match(/(\d{2,3})\s*bpm/i);
  return match ? Number(match[1]) : null;
}

function buildPrompt({ title, trackName, bpm, language }) {
  const bpmLabel = bpm ? `${bpm} BPM` : 'unknown BPM';
  const lang = language === 'he' ? 'Hebrew' : 'English and Hebrew';
  return [
    `You write Instagram Reel hooks for ShiBass, a psytrance producer.`,
    `Track: ${trackName || title || 'Untitled'}`,
    `Tempo: ${bpmLabel}`,
    `Return exactly 3 hooks in ${lang}.`,
    `Each hook is one line, under 90 characters, no numbering.`,
    `Do not mention that you are an AI.`,
  ].join('\n');
}

function parseHookLines(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:\d+[\).:-]|[-*])\s*/, '').trim())
    .filter((line) => line.length >= 8 && line.length <= 140)
    .slice(0, 3);
}

function localHooks({ title, trackName, bpm, language = 'he' }) {
  const name = trackName || title || 'ShiBass';
  const tempo = bpm ?? extractBpm(name) ?? 142;
  if (language === 'en') {
    return [
      `${name} — ${tempo} BPM drop you feel in the chest`,
      `The kick/bass stack on ${name} is the move`,
      `New cut: ${name}. Wait for bar 32.`,
    ];
  }
  return [
    `${name} — הדרופ של ${tempo} BPM שמרגישים בחזה`,
    `3 טעויות במיקס בס על ${name}`,
    `שמעתם את הדרופ? ${name} בחוץ עכשיו!`,
  ];
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callOllama({ host, model, prompt }) {
  const response = await fetchWithTimeout(
    `${host.replace(/\/$/, '')}/api/chat`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: 'You output only the three hook lines.' },
          { role: 'user', content: prompt },
        ],
      }),
    },
    20000,
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data?.message?.content ?? data?.response ?? '';
  const hooks = parseHookLines(content);
  if (hooks.length < 3) {
    throw new Error('Ollama returned fewer than 3 usable hooks');
  }
  return hooks;
}

async function generateHooks({
  title = '',
  trackName = '',
  bpm = null,
  language = 'he',
  host = DEFAULT_OLLAMA_HOST,
  model = DEFAULT_OLLAMA_MODEL,
} = {}) {
  const resolvedBpm = bpm ?? extractBpm(`${trackName} ${title}`);
  const prompt = buildPrompt({ title, trackName, bpm: resolvedBpm, language });

  try {
    const hooks = await callOllama({ host, model, prompt });
    return {
      success: true,
      mock: false,
      source: 'ollama',
      model,
      host,
      bpm: resolvedBpm,
      hooks,
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      success: true,
      mock: false,
      source: 'local-fallback',
      model,
      host,
      bpm: resolvedBpm,
      hooks: localHooks({ title, trackName, bpm: resolvedBpm, language }),
      warning: error instanceof Error ? error.message : 'Ollama unavailable',
      createdAt: new Date().toISOString(),
    };
  }
}

async function getEngineHealth() {
  const host = DEFAULT_OLLAMA_HOST;
  const model = DEFAULT_OLLAMA_MODEL;

  try {
    const response = await fetchWithTimeout(`${host.replace(/\/$/, '')}/api/tags`, {
      method: 'GET',
    });
    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}`);
    }
    const data = await response.json();
    const names = (data.models ?? []).map((item) => item.name);
    return {
      configured: true,
      live: true,
      mock: false,
      label: 'ReelHook AI (Ollama)',
      host,
      model,
      models: names,
    };
  } catch (error) {
    return {
      configured: Boolean(host),
      live: false,
      mock: false,
      label: 'ReelHook AI (Ollama)',
      host,
      model,
      error: error instanceof Error ? error.message : 'Ollama unreachable',
    };
  }
}

module.exports = {
  extractBpm,
  buildPrompt,
  parseHookLines,
  localHooks,
  generateHooks,
  getEngineHealth,
  fetchWithTimeout,
};
