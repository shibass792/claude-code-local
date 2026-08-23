'use strict';

const API = '';

const state = {
  library: [],
  index: -1,
  sequential: true,
  selectedAudioPath: null,
  kind: 'all',
  query: '',
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

function formatSize(n) {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function renderLibrary() {
  const body = $('track-body');
  body.innerHTML = '';
  if (!state.library.length) {
    body.innerHTML = '<tr><td colspan="5">אין קבצים — Reload / סרוק</td></tr>';
    return;
  }
  state.library.forEach((item, i) => {
    const tr = document.createElement('tr');
    if (i === state.index) tr.classList.add('active');
    tr.innerHTML = `<td>${item.name}</td><td>${item.kind}</td><td>${item.bpm || '—'}</td><td>${item.key || '—'}</td><td>${formatSize(item.size)}</td>`;
    tr.addEventListener('click', () => playIndex(i));
    body.appendChild(tr);
  });
}

async function scanLibrary() {
  $('index-status').textContent = 'סורק…';
  const result = await api('/api/media/scan', { method: 'POST', body: '{}' });
  appendLog(
    `[SCAN] roots=${(result.roots || []).join(' | ') || 'none'}\n` +
      `[SCAN] audio=${result.counts?.audio || 0} midi=${result.counts?.midi || 0} video=${result.counts?.video || 0} daw=${result.counts?.daw || 0}`,
  );
  await loadLibrary();
}

async function loadLibrary() {
  const params = new URLSearchParams({
    limit: '400',
    kind: state.kind,
    q: state.query,
  });
  const data = await api(`/api/media/library?${params.toString()}`);
  state.library = data.items || [];
  $('index-status').textContent = data.hasIndex
    ? `אינדקס · ${data.counts?.total || 0} קבצים · ${data.scannedAt}`
    : '⚠️ אין אינדקס מוזיקה — הרץ סריקה';
  $('lib-source').textContent = `📂 ${state.kind} · Studio API :4051 · roots=${(data.roots || []).length}`;
  const firstAudio = state.library.find((x) => x.kind === 'audio');
  state.selectedAudioPath = firstAudio?.path || state.selectedAudioPath;
  renderLibrary();
}

async function refreshLine() {
  const line = await api('/api/line/status');
  const ide = line.services?.mainIde || {};
  const tr = line.services?.transcriber || {};
  const banner = $('line-banner');
  if (!ide.ok) {
    banner.className = 'line-banner warn';
    banner.textContent = ide.hint || 'API 4000 not reachable: Failed to fetch — הספרייה כאן רצה על :4051';
  } else {
    banner.className = 'line-banner ok';
    banner.textContent = `IDE :4000 OK · Transcriber :4340 ${tr.ok ? 'OK' : 'OFF'} · יעד 14 יום: ${line.goal14}`;
  }
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
  audio.volume = Number($('volume').value) / 100;
  const byId = `/api/media/stream?id=${encodeURIComponent(item.id)}`;
  const byPath = item.path
    ? `/api/media/stream?path=${encodeURIComponent(item.path)}`
    : null;
  audio.src = byId;
  const retryFromPath = () => {
    if (!byPath || audio.dataset.retried === item.id) return;
    audio.dataset.retried = item.id;
    appendLog('[PLAYER] stream by id failed — retrying with disk path');
    audio.src = byPath;
    audio.play().catch((err) => appendLog(`[PLAYER] play error: ${err.message}`));
  };
  audio.onerror = retryFromPath;
  audio.play().catch(retryFromPath);
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
    const dur = Number.isFinite(audio.duration) ? formatTime(audio.duration) : '--:--';
    $('time-label').textContent = `${formatTime(audio.currentTime)} / ${dur}`;
  });
  audio.addEventListener('ended', () => {
    if (!state.sequential) return;
    if (state.index + 1 < state.library.length) playIndex(state.index + 1);
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  wirePlayer();
  $('btn-quality').addEventListener('click', () => {
    appendLog('[QUALITY] סורק קבצים אמיתיים במחשב (node --check / py_compile)…');
    api('/api/quality')
      .then((data) => appendLog(data.log || JSON.stringify(data, null, 2)))
      .catch((e) => appendLog(String(e)));
  });
  $('btn-status').addEventListener('click', () => refreshStatus().catch((e) => appendLog(String(e))));
  $('btn-hooks').addEventListener('click', () => generateHooks().catch((e) => appendLog(String(e))));
  $('btn-render').addEventListener('click', () => renderReel().catch((e) => appendLog(String(e))));
  $('btn-campaign').addEventListener('click', () => createCampaign().catch((e) => appendLog(String(e))));
  $('btn-scan').addEventListener('click', () => scanLibrary().catch((e) => appendLog(String(e))));
  $('btn-psy').addEventListener('click', async () => {
    const data = await api('/api/psy/generate', {
      method: 'POST',
      body: JSON.stringify({ count: 10, root: 'E', bpm: 142 }),
    });
    appendLog(`[PSY_PACK] ${data.count} MIDI · ${data.scale} · ${data.dirs?.local}\n${data.route}`);
    await scanLibrary();
  });
  $('btn-pack').addEventListener('click', async () => {
    const data = await api('/api/pack/build', {
      method: 'POST',
      body: JSON.stringify({ count: 50, root: 'E', bpm: 142 }),
    });
    appendLog(`[PACK] ${data.midiCount} MIDI → ${data.zipPath}\n${data.listingHint}`);
  });
  $('btn-guide').addEventListener('click', async () => {
    const data = await api('/api/guides', {
      method: 'POST',
      body: JSON.stringify({
        title: $('track-input').value || 'studio note',
        notes: $('guide-notes').value,
        source: 'studio-ui',
      }),
    });
    appendLog(`[GUIDE] ${data.guide?.path}\n${data.preview || ''}`);
  });
  $('btn-epk').addEventListener('click', async () => {
    const data = await api('/api/epk/build', {
      method: 'POST',
      body: JSON.stringify({
        artist: 'ShiBass',
        latestSet: 'Shiva Mangala remix / edits',
        label: 'Audix Records',
      }),
    });
    appendLog(`[EPK] ${data.emailPath}\n\n${data.promoterEmail}`);
  });
  $('lib-filter').addEventListener('input', (e) => {
    state.query = e.target.value.trim();
    loadLibrary().catch((err) => appendLog(String(err)));
  });
  document.querySelectorAll('#kind-tabs [data-kind]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.kind = btn.getAttribute('data-kind');
      document.querySelectorAll('#kind-tabs [data-kind]').forEach((b) => {
        b.classList.toggle('primary', b === btn);
      });
      loadLibrary().catch((err) => appendLog(String(err)));
    });
  });

  try {
    await refreshStatus();
    await refreshLine();
    await loadLibrary();
  } catch (err) {
    appendLog(`[BOOT] ${err.message}`);
    const banner = $('line-banner');
    banner.className = 'line-banner warn';
    banner.textContent = 'API offline — הרץ START-DAILY-LINE.cmd או promo-publisher\\START-API.cmd (:4051)';
  }
});
