'use strict';

/**
 * Real local-LLM client for ShiBass Social Studio.
 *
 * Talks to the stack's actual AI services — no canned strings:
 *   - Ollama native API  (tier1 always-on service, port 11434)
 *   - any OpenAI-compatible endpoint (proxy/server.py, smart-router/router.py)
 *
 * When no engine answers, callers get a thrown AiUnavailableError so the UI can
 * say "engine down" instead of inventing content.
 */

const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434';
const DEFAULT_TIMEOUT_MS = 120000;

class AiUnavailableError extends Error {
  constructor(message, { endpoint, cause } = {}) {
    super(message);
    this.name = 'AiUnavailableError';
    this.endpoint = endpoint;
    if (cause) {
      this.cause = cause;
    }
  }
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function getAiConfig() {
  const openAiBase = process.env.AI_BASE_URL ?? '';

  if (openAiBase) {
    return {
      provider: 'openai-compatible',
      baseUrl: stripTrailingSlash(openAiBase),
      apiKey: process.env.AI_API_KEY ?? '',
      model: process.env.AI_MODEL ?? '',
      timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    };
  }

  return {
    provider: 'ollama',
    baseUrl: stripTrailingSlash(process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST),
    apiKey: '',
    model: process.env.OLLAMA_MODEL ?? '',
    timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  };
}

async function requestJson(url, { method = 'GET', body, headers = {}, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const text = await response.text();

    if (!response.ok) {
      throw new AiUnavailableError(
        `AI engine returned HTTP ${response.status}: ${text.slice(0, 300)}`,
        { endpoint: url },
      );
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      throw new AiUnavailableError(`AI engine returned non-JSON payload: ${text.slice(0, 200)}`, {
        endpoint: url,
        cause: error,
      });
    }
  } catch (error) {
    if (error instanceof AiUnavailableError) {
      throw error;
    }
    if (error.name === 'AbortError') {
      throw new AiUnavailableError(`AI engine timed out after ${timeoutMs}ms`, { endpoint: url });
    }
    throw new AiUnavailableError(`Cannot reach AI engine at ${url}: ${error.message}`, {
      endpoint: url,
      cause: error,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function listModels() {
  const cfg = getAiConfig();

  if (cfg.provider === 'ollama') {
    const data = await requestJson(`${cfg.baseUrl}/api/tags`, { timeoutMs: 8000 });
    return (data.models ?? []).map((item) => item.name).filter(Boolean);
  }

  const data = await requestJson(`${cfg.baseUrl}/models`, {
    timeoutMs: 8000,
    headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
  });
  return (data.data ?? []).map((item) => item.id).filter(Boolean);
}

/**
 * Resolve which model to use. An explicit env value wins; otherwise we ask the
 * engine what it actually has loaded so a fresh install works untouched.
 */
async function resolveModel() {
  const cfg = getAiConfig();
  if (cfg.model) {
    return cfg.model;
  }

  const models = await listModels();
  if (!models.length) {
    throw new AiUnavailableError(
      `AI engine at ${cfg.baseUrl} has no models installed. Run: ollama pull llama3.1`,
      { endpoint: cfg.baseUrl },
    );
  }
  return models[0];
}

async function checkHealth() {
  const cfg = getAiConfig();
  try {
    const models = await listModels();
    return {
      ok: true,
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      model: cfg.model || models[0] || null,
      models,
    };
  } catch (error) {
    return {
      ok: false,
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      model: cfg.model || null,
      models: [],
      error: error.message,
    };
  }
}

/**
 * Send a real chat completion request and return the assistant text.
 */
async function chat({ system, prompt, json = false, temperature = 0.9, model } = {}) {
  if (!prompt) {
    throw new Error('chat() requires a prompt');
  }

  const cfg = getAiConfig();
  const chosenModel = model || (await resolveModel());
  const messages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: prompt },
  ];

  if (cfg.provider === 'ollama') {
    const data = await requestJson(`${cfg.baseUrl}/api/chat`, {
      method: 'POST',
      timeoutMs: cfg.timeoutMs,
      body: {
        model: chosenModel,
        messages,
        stream: false,
        ...(json ? { format: 'json' } : {}),
        options: { temperature },
      },
    });

    const content = data?.message?.content;
    if (!content) {
      throw new AiUnavailableError('Ollama returned an empty completion', {
        endpoint: cfg.baseUrl,
      });
    }
    return { text: content, model: chosenModel, provider: cfg.provider };
  }

  const data = await requestJson(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    timeoutMs: cfg.timeoutMs,
    headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
    body: {
      model: chosenModel,
      messages,
      stream: false,
      temperature,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    },
  });

  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new AiUnavailableError('AI engine returned an empty completion', {
      endpoint: cfg.baseUrl,
    });
  }
  return { text: content, model: chosenModel, provider: cfg.provider };
}

/**
 * Local models often wrap JSON in prose or fences. Recover the first JSON value
 * rather than failing the whole generation.
 */
function extractJson(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) {
    throw new Error('Empty AI response');
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], trimmed].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      const start = candidate.search(/[[{]/);
      if (start === -1) {
        continue;
      }
      const opener = candidate[start];
      const closer = opener === '[' ? ']' : '}';
      const end = candidate.lastIndexOf(closer);
      if (end > start) {
        try {
          return JSON.parse(candidate.slice(start, end + 1));
        } catch {
          // fall through to next candidate
        }
      }
    }
  }

  throw new Error(`AI response is not valid JSON: ${trimmed.slice(0, 200)}`);
}

async function chatJson(options) {
  const result = await chat({ ...options, json: true });
  return { ...result, data: extractJson(result.text) };
}

module.exports = {
  AiUnavailableError,
  DEFAULT_OLLAMA_HOST,
  getAiConfig,
  listModels,
  resolveModel,
  checkHealth,
  chat,
  chatJson,
  extractJson,
};
