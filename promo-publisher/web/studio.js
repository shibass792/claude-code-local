'use strict';

const API = '';

const state = {
  library: [],
  index: -1,
  sequential: true,
  selectedAudioPath: null,
};

const $ = (id) => document.getElementById(id);

function appendLog(text) {
  const el = $('live-log');
  const stamp = new Date().toISOString().slice(11, 19);
  el.textContent = `[${stamp}]\n${text}\n\n${el.textContent}`.slice(0, 12000);
}

async function api(path, options) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.detail || res.statusText || 'request failed');
  }
  return data;
}

function renderPills(status) {
  const host = $('engine-pills');
  host.innerHTML = '';
  Object.entries(status.engines || {}).forEach(([key, info]) => {
    const span = document.createElement('span');
    span.className = `pill ${info.ok ? 'ok' : 'bad'}`;
    span.textContent = `${key}: ${info.ok ? 'OK' : 'OFF'}`;
    span.title = info.detail || '';
    host.appendChild(span);
  });
}

async function refreshStatus() {
  const status = await api('/api/health');
  renderPills(status);
  appendLog(status.log || JSON.stringify(status, null, 2));
  if (status.policy?.instapy === 'disabled') {
    appendLog(`[POLICY] ${status.policy.reason}`);
  }
  return status;
}

function formatTime(sec) {
  if (!Number.isFinite(sec)) return '00:00';
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function renderLibrary() {
  const list = $('track-list');
  list.innerHTML = '';
  if (!state.library.length) {
    list.innerHTML = '<li><span>אין קבצים — סרוק מדיה</span></li>';
    return;
  }
  state.library.forEach((item, i) => {
    const li = document.createElement('li');
    if (i === state.index) li.classList.add('active');
    li.innerHTML = `<span>${item.name}</span><span class="kind">${item.kind}</span>`;
    li.addEventListener('click', () => playIndex(i));
    list.appendChild(li);
  });
}

async function scanLibrary() {
  $('index-status').textContent = 'סורק…';
  const result = await api('/api/media/scan', { method: 'POST', body: '{}' });
  state.library = result.items || [];
  $('index-status').textContent =
    `אינדקס חי · ${result.counts?.total || 0} קבצים · ${result.scannedAt}`;
  appendLog(
    `[SCAN] roots=${(result.roots || []).join(' | ') || 'none'}\n` +
      `[SCAN] audio=${result.counts?.audio || 0} midi=${result.counts?.midi || 0} video=${result.counts?.video || 0}`,
  );
  const firstAudio = state.library.find((x) => x.kind === 'audio');
  state.selectedAudioPath = firstAudio?.path || null;
  renderLibrary();
}

async function loadLibrary() {
  const data = await api('/api/media/library?limit=400');
  state.library = data.items || [];
  $('index-status').textContent = data.hasIndex
    ? `אינדקס · ${data.counts?.total || 0} קבצים · ${data.scannedAt}`
    : '⚠️ אין אינדקס מוזיקה — הרץ סריקה';
  const firstAudio = state.library.find((x) => x.kind === 'audio');
  state.selectedAudioPath = firstAudio?.path || state.selectedAudioPath;
  renderLibrary();
}

function playIndex(i) {
  const item = state.library[i];
  if (!item) return;
  state.index = i;
  $('now-playing').textContent = item.name;
  renderLibrary();

  if (item.kind === 'midi') {
    appendLog(`[PLAYER] MIDI נבחר: ${item.name} — נגן אודיו דורש WAV/MP3 (MIDI מוצג באינדקס בלבד)`);
    state.selectedAudioPath = null;
    return;
  }

  state.selectedAudioPath = item.path;
  const audio = $('audio');
  audio.src = `/api/media/stream?id=${encodeURIComponent(item.id)}`;
  audio.volume = Number($('volume').value) / 100;
  audio.play().catch((err) => appendLog(`[PLAYER] play error: ${err.message}`));
}

function playCurrent() {
  if (state.index < 0) {
    const i = state.library.findIndex((x) => x.kind === 'audio');
    if (i >= 0) playIndex(i);
    else appendLog('[PLAYER] אין אודיו באינדקס');
    return;
  }
  playIndex(state.index);
}

async function generateHooks() {
  const track = $('track-input').value.trim();
  const data = await api('/api/hooks/generate', {
    method: 'POST',
    body: JSON.stringify({ track, bpm: 142, genre: 'Psytrance', count: 3 }),
  });
  const lines = (data.hooks || []).map((h, i) => `${i + 1}. "${h.text}"`).join('\n');
  appendLog(
    `[REELHOOK] source=${data.source}${data.model ? ` model=${data.model}` : ''}\n${lines}` +
      (data.note ? `\n[NOTE] ${data.note}` : ''),
  );
  if (data.hooks?.[0]?.text) {
    $('hook-input').value = data.hooks[0].text;
  }
}

async function renderReel() {
  if (!state.selectedAudioPath) {
    const audio = state.library.find((x) => x.kind === 'audio');
    state.selectedAudioPath = audio?.path || null;
  }
  if (!state.selectedAudioPath) {
    appendLog('[RENDER] אין קובץ אודיו — סרוק קודם או שים WAV תחת fixtures/media');
    return;
  }
  appendLog(`[RENDER] starting FFmpeg 9:16 for\n${state.selectedAudioPath}`);
  const data = await api('/api/render/reel', {
    method: 'POST',
    body: JSON.stringify({
      audioPath: state.selectedAudioPath,
      hook: $('hook-input').value,
      durationSec: 8,
      fps: 30,
    }),
  });
  if (!data.success) {
    appendLog(`[ERROR] ${data.error}\n${data.detail || ''}`);
    return;
  }
  appendLog(
    `[SUCCESS] Rendered ${data.relativePath} (${data.width}x${data.height} ${data.fps}fps)\n` +
      `[SIZE] ${data.size} bytes · ${data.elapsedMs}ms · source=${data.source}`,
  );
  return data;
}

async function createCampaign() {
  if (!state.selectedAudioPath) {
    await scanLibrary();
  }
  const data = await api('/api/create/campaign', {
    method: 'POST',
    body: JSON.stringify({
      track: $('track-input').value.trim(),
      audioPath: state.selectedAudioPath,
      hook: $('hook-input').value,
      bpm: 142,
      genre: 'Psytrance',
      durationSec: 8,
      fps: 30,
      platforms: ['instagram', 'tiktok'],
    }),
  });
  appendLog(data.log || JSON.stringify(data, null, 2));
}

function wirePlayer() {
  const audio = $('audio');
  $('btn-play').addEventListener('click', playCurrent);
  $('btn-stop').addEventListener('click', () => {
    audio.pause();
    audio.currentTime = 0;
  });
  $('btn-fwd').addEventListener('click', () => {
    audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
  });
  $('btn-prev').addEventListener('click', () => {
    if (state.index > 0) playIndex(state.index - 1);
  });
  $('btn-next').addEventListener('click', () => {
    if (state.index + 1 < state.library.length) playIndex(state.index + 1);
  });
  $('btn-seq').addEventListener('click', (e) => {
    state.sequential = !state.sequential;
    e.currentTarget.dataset.on = state.sequential ? '1' : '0';
    e.currentTarget.textContent = state.sequential ? '🔁 ברצף: פעיל' : '🔁 ברצף: כבוי';
  });
  $('volume').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    audio.volume = v / 100;
    $('vol-label').textContent = `${v}%`;
  });
  audio.addEventListener('timeupdate', () => {
    $('time-label').textContent = formatTime(audio.currentTime);
  });
  audio.addEventListener('ended', () => {
    if (!state.sequential) return;
    if (state.index + 1 < state.library.length) playIndex(state.index + 1);
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  wirePlayer();
  $('btn-status').addEventListener('click', () => refreshStatus().catch((e) => appendLog(String(e))));
  $('btn-hooks').addEventListener('click', () => generateHooks().catch((e) => appendLog(String(e))));
  $('btn-render').addEventListener('click', () => renderReel().catch((e) => appendLog(String(e))));
  $('btn-campaign').addEventListener('click', () => createCampaign().catch((e) => appendLog(String(e))));
  $('btn-scan').addEventListener('click', () => scanLibrary().catch((e) => appendLog(String(e))));

  try {
    await refreshStatus();
    await loadLibrary();
  } catch (err) {
    appendLog(`[BOOT] ${err.message}`);
  }
});
