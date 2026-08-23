'use strict';

/**
 * Viral hook generator — real Ollama when available.
 * Falls back to structured local templates (labeled), never silent fake "AI" logs.
 */

const DEFAULT_OLLAMA = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || process.env.SHIBASS_HOOK_MODEL || 'llama3.2';

async function probeOllama(baseUrl = DEFAULT_OLLAMA) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${baseUrl}/api/tags`, { signal: ctrl.signal });
    clearTimeout(timer);
    const json = await res.json().catch(() => ({}));
    const models = (json.models || []).map((m) => m.name);
    return {
      ok: res.ok,
      url: baseUrl,
      models,
      hasModel: models.some((n) => String(n).startsWith(DEFAULT_MODEL.split(':')[0])),
    };
  } catch (err) {
    return { ok: false, url: baseUrl, models: [], error: String(err.message || err) };
  }
}

function localHooks({ track = 'ShiBass', bpm = 142, genre = 'Psytrance' } = {}) {
  return [
    {
      text: `הסוד לקיק ובס של ${bpm} BPM שלא תמצא בשום קורס...`,
      lang: 'he',
      style: 'educational-tease',
    },
    {
      text: `3 טעויות שכולם עושים במיקס של בס ${genre} 🎹`,
      lang: 'he',
      style: 'listicle',
    },
    {
      text: `שמעתם את הדרופ הזה? ${track} בחוץ עכשיו! 🚀`,
      lang: 'he',
      style: 'drop-hype',
    },
  ];
}

function parseHooksFromModel(raw) {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[\d]+[.)\-:\s]+/, '').replace(/^["']|["']$/g, '').trim())
    .filter((line) => line.length >= 8 && line.length <= 140);

  const unique = [];
  for (const line of lines) {
    if (!unique.includes(line)) {
      unique.push(line);
    }
    if (unique.length >= 3) {
      break;
    }
  }
  return unique.map((text) => ({ text, lang: 'he', style: 'ollama' }));
}

async function generateHooks(options = {}) {
  const track = String(options.track || 'ShiBass').slice(0, 80);
  const bpm = Number(options.bpm || 142);
  const genre = String(options.genre || 'Psytrance').slice(0, 40);
  const count = Math.min(Math.max(Number(options.count || 3), 1), 5);
  const ollama = await probeOllama();

  if (!ollama.ok) {
    return {
      success: true,
      source: 'local-templates',
      note: 'Ollama לא זמין — הוקים מתבניות מקומיות (לא סימולציית AI). הפעל Ollama ל-ReelHook חי.',
      hooks: localHooks({ track, bpm, genre }).slice(0, count),
      ollama,
    };
  }

  const prompt = `You write viral Instagram Reel hooks for electronic music producer "${track}".
Genre: ${genre}. BPM: ${bpm}.
Return exactly ${count} hooks in Hebrew (can mix short English brand words).
One hook per line. No numbering. No quotes. Max 90 chars each.
Focus on drop tease, mixing secrets, or festival energy.`;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    const res = await fetch(`${ollama.url}/api/generate`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.85 },
      }),
    });
    clearTimeout(timer);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error || `Ollama HTTP ${res.status}`);
    }

    let hooks = parseHooksFromModel(json.response);
    if (hooks.length < count) {
      hooks = [...hooks, ...localHooks({ track, bpm, genre })].slice(0, count);
    }

    return {
      success: true,
      source: 'ollama-live',
      model: json.model || DEFAULT_MODEL,
      hooks,
      ollama,
    };
  } catch (err) {
    return {
      success: true,
      source: 'local-templates',
      note: `Ollama generate נכשל (${err.message}) — fallback לתבניות מקומיות`,
      hooks: localHooks({ track, bpm, genre }).slice(0, count),
      ollama,
    };
  }
}

module.exports = {
  DEFAULT_OLLAMA,
  DEFAULT_MODEL,
  probeOllama,
  localHooks,
  generateHooks,
};
