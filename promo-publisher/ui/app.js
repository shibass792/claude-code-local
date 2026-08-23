let currentCampaign = null;
let hasWatchedCurrent = false;
let playerTracks = [];
let playerIndex = -1;
let playerLoop = true;

const player = document.getElementById('main-player');
const publishBtn = document.getElementById('btn-publish');
const watchHint = document.getElementById('watch-hint');
const libraryAudio = document.getElementById('library-audio');

function apiBase() {
  if (window.location.protocol === 'file:') {
    return 'http://127.0.0.1:4051';
  }
  if (window.location.port && window.location.port !== '4051') {
    return 'http://127.0.0.1:4051';
  }
  return '';
}

async function httpJson(pathname, options = {}) {
  const res = await fetch(`${apiBase()}${pathname}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });
  const data = await res.json();
  if (!res.ok && data?.error) {
    throw new Error(data.error);
  }
  return data;
}

const httpApi = {
  getTrends: () => httpJson('/api/health').then(() => []),
  scanRadar: () => httpJson('/api/health'),
  getTemplate: () => null,
  getPendingApproval: () => httpJson('/api/approval/pending'),
  rejectCampaign: (campaignId) =>
    httpJson('/api/approval/reject', { method: 'POST', body: JSON.stringify({ campaignId }) }),
  markWatched: (campaignId) =>
    httpJson('/api/approval/mark-watched', { method: 'POST', body: JSON.stringify({ campaignId }) }),
  getPublishHistory: () => httpJson('/api/approval/history'),
  getConnectionHealth: () => httpJson('/api/connections'),
  resolveMediaPath: async (relativePath) => {
    if (!relativePath) {
      return { exists: false, path: null };
    }
    return { exists: true, path: `${apiBase()}/${relativePath.replace(/^\//, '')}` };
  },
  approveAndPublish: (campaignData) =>
    httpJson('/api/approval/publish', { method: 'POST', body: JSON.stringify(campaignData) }),
  enginesStatus: () => httpJson('/api/health'),
  getCreationLog: (limit) => httpJson(`/api/log?limit=${limit ?? 80}`).then((data) => data.entries),
  clearCreationLog: () => httpJson('/api/log/clear', { method: 'POST' }),
  instagramStatus: () => httpJson('/api/instagram/status'),
  generateHooks: (input) => httpJson('/api/hooks', { method: 'POST', body: JSON.stringify(input) }),
  renderReel: (input) => httpJson('/api/render', { method: 'POST', body: JSON.stringify(input) }),
  playerIndex: () => httpJson('/api/player/index'),
  playerScan: (roots) =>
    httpJson('/api/player/scan', { method: 'POST', body: JSON.stringify({ roots }) }),
  playerStreamUrl: async (id) => `${apiBase()}/api/player/stream/${encodeURIComponent(id)}`,
};

function client() {
  return window.api ?? httpApi;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3200);
}

function formatLogEntries(entries) {
  if (!entries?.length) {
    return 'אין רשומות עדיין — לחץ על כפתור מנוע כדי לכתוב לוג אמיתי.';
  }
  return entries
    .map((entry) => {
      const stamp = entry.ts ?? '';
      const tag = `[${String(entry.engine ?? 'sys').toUpperCase()}]`;
      return `${stamp} ${tag} ${entry.event}: ${entry.message}`;
    })
    .join('\n');
}

async function refreshCreationLog() {
  const entries = await client().getCreationLog(120);
  document.getElementById('creation-log').textContent = formatLogEntries(entries);
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((el) => el.classList.remove('active'));

  document.getElementById(tabId).classList.add('active');
  document.querySelector(`[data-tab="${tabId}"]`)?.classList.add('active');

  if (tabId === 'radar-tab') {
    loadRadarData();
  }
  if (tabId === 'approval-tab') {
    loadApprovalQueue();
  }
  if (tabId === 'history-tab') {
    loadHistory();
  }
  if (tabId === 'connections-tab') {
    loadConnections();
  }
  if (tabId === 'engines-tab') {
    refreshCreationLog();
    loadPlayerIndex();
  }
}

function updatePublishButtonState() {
  const canPublish = Boolean(currentCampaign) && hasWatchedCurrent;
  publishBtn.disabled = !canPublish;
  watchHint.textContent = canPublish
    ? '✅ צפית בסרטון — ניתן לפרסם'
    : '▶ לחץ Play כדי לאפשר פרסום';
}

async function loadApprovalQueue() {
  const queue = await client().getPendingApproval();
  const empty = document.getElementById('approval-empty');
  const workspace = document.getElementById('approval-workspace');

  if (!queue?.length) {
    currentCampaign = null;
    hasWatchedCurrent = false;
    empty.classList.remove('hidden');
    workspace.classList.add('hidden');
    updatePublishButtonState();
    return;
  }

  empty.classList.add('hidden');
  workspace.classList.remove('hidden');

  currentCampaign = queue[0];
  hasWatchedCurrent = Boolean(currentCampaign.watched);

  document.getElementById('video-title').textContent = currentCampaign.title;
  document.getElementById('video-duration').textContent =
    `${currentCampaign.duration} | ${currentCampaign.format}`;
  document.getElementById('caption-he').value = currentCampaign.captionHe ?? '';
  document.getElementById('caption-en').value = currentCampaign.captionEn ?? '';
  document.getElementById('post-hashtags').value = currentCampaign.hashtags ?? '';

  const media = currentCampaign.videoPath
    ? await client().resolveMediaPath(currentCampaign.videoPath)
    : { exists: false };
  const placeholder = document.getElementById('video-placeholder');

  if (media.exists) {
    player.src = media.path;
    placeholder.classList.add('hidden');
  } else {
    player.removeAttribute('src');
    player.load();
    placeholder.classList.remove('hidden');
  }

  updatePublishButtonState();
}

async function loadRadarData() {
  if (!window.api) {
    document.getElementById('radar-list').innerHTML =
      '<p class="muted">רדאר זמין באפליקציית Electron. המנועים האמיתיים רצים בטאב מנועים.</p>';
    return;
  }

  const trends = await window.api.getTrends();
  const container = document.getElementById('radar-list');
  container.innerHTML = '';

  if (!trends?.length) {
    container.innerHTML = '<p class="muted">לא נמצאו פוסטים ויראליים — לחץ סרוק מחדש</p>';
    return;
  }

  trends.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'radar-card';
    card.innerHTML = `
      <div class="radar-badge">🔥 חריגה: ${item.outlierLabel} (${Number(item.views).toLocaleString()} צפיות)</div>
      <h3>${item.artist}</h3>
      <p><strong>💡 הוק:</strong> "${item.hookText}"</p>
      <p class="muted">🎨 סגנון: ${item.style}</p>
      <p class="strategy-box">📌 אסטרטגיה: ${item.keyStrategy}</p>
      <button class="btn btn-primary" data-template="${item.id}" type="button">✨ השתמש במבנה הזה</button>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll('[data-template]').forEach((button) => {
    button.addEventListener('click', async () => {
      await useTemplate(button.getAttribute('data-template'));
    });
  });
}

async function useTemplate(templateId) {
  if (!window.api) {
    return;
  }

  const template = await window.api.getTemplate(templateId);
  if (!template) {
    showToast('תבנית לא נמצאה');
    return;
  }

  switchTab('approval-tab');
  document.getElementById('caption-en').value = template.hookText;
  showToast(`הוחלה תבנית: ${template.style}`);
}

async function loadHistory() {
  const history = await client().getPublishHistory();
  const body = document.getElementById('history-body');
  body.innerHTML = '';

  if (!history?.length) {
    body.innerHTML = '<tr><td colspan="4">אין פרסומים עדיין</td></tr>';
    return;
  }

  history.forEach((entry) => {
    const row = document.createElement('tr');
    const failed = entry.results?.some((item) => item.success === false);
    const statusClass = failed ? 'badge-fail' : 'badge-ok';
    const statusText = failed ? 'נכשל' : 'פורסם';
    row.innerHTML = `
      <td>${new Date(entry.publishedAt).toLocaleString('he-IL')}</td>
      <td>${entry.campaignId}</td>
      <td>${(entry.platforms ?? []).join(', ')}</td>
      <td class="${statusClass}">${statusText}</td>
    `;
    body.appendChild(row);
  });
}

async function loadConnections() {
  const [health, live] = await Promise.all([
    client().getConnectionHealth(),
    client().enginesStatus().catch(() => null),
  ]);
  const grid = document.getElementById('connections-grid');
  grid.innerHTML = '';

  const cards = [
    ...Object.entries(health).map(([key, item]) => ({
      title: item.label,
      ok: Boolean(item.configured ?? item.cloudflared),
      detail: item.mode ? `מצב TikTok: ${item.mode}` : key,
    })),
  ];

  if (live) {
    cards.push(
      {
        title: 'Instagram Graph',
        ok: Boolean(live.instagram?.ok),
        detail: live.instagram?.error ?? live.instagram?.account?.username ?? 'לא הוגדר',
      },
      {
        title: 'FFmpeg',
        ok: Boolean(live.ffmpeg?.ok),
        detail: live.ffmpeg?.version ?? live.ffmpeg?.error,
      },
      {
        title: 'Ollama / ReelHook',
        ok: Boolean(live.ollama?.ok),
        detail: live.ollama?.error ?? (live.ollama?.models ?? []).join(', ') ?? live.ollama?.host,
      },
      {
        title: 'Universal Player',
        ok: Boolean(live.player?.indexed && live.player.count > 0),
        detail: live.player?.indexed
          ? `${live.player.count} קבצים באינדקס`
          : 'אין אינדקס — הרץ סריקה',
      },
    );
  }

  cards.forEach((cardData) => {
    const card = document.createElement('div');
    card.className = 'connection-card';
    card.innerHTML = `
      <h3>${cardData.title}</h3>
      <div class="connection-status">
        <div class="status-indicator ${cardData.ok ? 'online' : ''}" style="${cardData.ok ? '' : 'background:#ef4444'}"></div>
        <span>${cardData.ok ? 'חי' : 'לא מחובר / חסר'}</span>
      </div>
      <p class="muted">${cardData.detail ?? ''}</p>
    `;
    grid.appendChild(card);
  });
}

async function approveCurrent() {
  if (!currentCampaign || !hasWatchedCurrent) {
    showToast('יש לצפות בסרטון לפני פרסום');
    return;
  }

  const platforms = [];
  if (document.getElementById('chk-ig').checked) platforms.push('instagram');
  if (document.getElementById('chk-tt').checked) platforms.push('tiktok');
  if (document.getElementById('chk-fb').checked) platforms.push('facebook');

  const payload = {
    ...currentCampaign,
    watched: true,
    captionHe: document.getElementById('caption-he').value,
    captionEn: document.getElementById('caption-en').value,
    hashtags: document.getElementById('post-hashtags').value,
    platforms,
  };

  publishBtn.disabled = true;
  const result = await client().approveAndPublish(payload);

  if (result.success) {
    showToast('הסרטון פורסם בהצלחה!');
    await loadApprovalQueue();
    await loadHistory();
  } else {
    showToast(result.error ?? 'הפרסום נכשל — אין סימולציה');
    updatePublishButtonState();
  }
}

async function rejectCurrent() {
  if (!currentCampaign) {
    return;
  }

  if (!confirm('לדחות ולהסיר את הסרטון מתור האישורים?')) {
    return;
  }

  await client().rejectCampaign(currentCampaign.id);
  showToast('הסרטון הוסר מהתור');
  await loadApprovalQueue();
}

function setupPlayerWatchGate() {
  player.addEventListener('play', async () => {
    if (!currentCampaign || hasWatchedCurrent) {
      return;
    }

    hasWatchedCurrent = true;
    currentCampaign.watched = true;
    await client().markWatched(currentCampaign.id);
    updatePublishButtonState();
  });
}

function renderTrackSelect() {
  const select = document.getElementById('track-select');
  select.innerHTML = '';
  playerTracks.forEach((track, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${track.playable ? '▶' : 'MIDI'} ${track.name}`;
    select.appendChild(option);
  });
  if (playerIndex >= 0) {
    select.selectedIndex = playerIndex;
  }
}

function updatePlayerClock() {
  const current = Number.isFinite(libraryAudio.currentTime) ? libraryAudio.currentTime : 0;
  const mins = String(Math.floor(current / 60)).padStart(2, '0');
  const secs = String(Math.floor(current % 60)).padStart(2, '0');
  document.getElementById('player-clock').textContent = `${mins}:${secs}`;
}

async function selectTrack(index, autoplay) {
  if (!playerTracks.length) {
    showToast('אין אינדקס מוזיקה — הרץ סריקה');
    return;
  }

  playerIndex = (index + playerTracks.length) % playerTracks.length;
  const track = playerTracks[playerIndex];
  document.getElementById('now-playing').textContent = track.name;
  document.getElementById('track-select').selectedIndex = playerIndex;

  if (!track.playable) {
    libraryAudio.removeAttribute('src');
    showToast('MIDI מאונדקס אבל לא מתנגן בדפדפן');
    return;
  }

  const url = await client().playerStreamUrl(track.id);
  libraryAudio.src = url;
  libraryAudio.loop = playerLoop;
  if (autoplay) {
    await libraryAudio.play();
  }
}

async function loadPlayerIndex() {
  const index = await client().playerIndex();
  playerTracks = index.tracks ?? [];
  const status = document.getElementById('player-index-status');
  if (!index.scannedAt) {
    status.textContent = 'אין אינדקס מוזיקה — הרץ סריקה';
  } else {
    status.textContent = `${index.count} קבצים · ${index.audioCount} אודיו · ${index.midiCount} MIDI · ${index.scannedAt}`;
  }
  renderTrackSelect();
  if (playerTracks.length && playerIndex < 0) {
    playerIndex = 0;
    document.getElementById('now-playing').textContent = playerTracks[0].name;
  }
}

async function scanMusicLibrary() {
  showToast('סורק קבצים...');
  const index = await client().playerScan();
  playerTracks = index.tracks ?? [];
  playerIndex = playerTracks.length ? 0 : -1;
  await loadPlayerIndex();
  await refreshCreationLog();
  showToast(`נסרקו ${index.count} קבצים`);
}

async function renderReelFromUi(audioPath) {
  const hook = document.getElementById('render-hook').value;
  const status = document.getElementById('create-status');
  status.textContent = 'מרנדר עם FFmpeg...';
  const result = await client().renderReel({
    hook,
    audioPath: audioPath ?? null,
    durationSeconds: 8,
  });
  await refreshCreationLog();
  if (!result.ok) {
    status.textContent = `רינדור נכשל: ${result.error}`;
    showToast(result.error);
    return;
  }
  status.textContent = `נוצר ${result.relativePath} (${result.bytes} bytes)`;
  showToast('הרינדור נכנס לתור האישורים');
  await loadApprovalQueue();
}

async function importAndRender(file) {
  if (window.api?.pathForDroppedFile) {
    const resolved = await window.api.pathForDroppedFile(file);
    if (resolved.exists) {
      await renderReelFromUi(resolved.path);
      return;
    }
  }

  const res = await fetch(`${apiBase()}/api/render/import`, {
    method: 'POST',
    headers: { 'X-Filename': file.name },
    body: file,
  });
  const imported = await res.json();
  if (!imported.ok) {
    showToast(imported.error ?? 'ייבוא הקובץ נכשל');
    return;
  }
  await renderReelFromUi(imported.audioPath);
}

function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach((button) => {
    button.addEventListener('click', () => {
      switchTab(button.getAttribute('data-tab'));
    });
  });
}

function setupActions() {
  document.getElementById('btn-publish').addEventListener('click', approveCurrent);
  document.getElementById('btn-reject').addEventListener('click', rejectCurrent);
  document.getElementById('btn-scan-radar').addEventListener('click', async () => {
    if (window.api?.scanRadar) {
      await window.api.scanRadar();
      await loadRadarData();
      showToast('סריקת רדאר הושלמה');
    }
  });
  document.getElementById('btn-remix-hook').addEventListener('click', async () => {
    const result = await client().generateHooks({
      title: currentCampaign?.title ?? document.getElementById('render-hook').value,
      bpm: 142,
      style: 'Progressive Psytrance',
    });
    if (result.hooks?.[0]) {
      document.getElementById('caption-he').value = result.hooks[0].text;
    }
    if (result.hooks?.[2]) {
      document.getElementById('caption-en').value = result.hooks[2].text;
    }
    await refreshCreationLog();
    showToast(`הוקים מ-${result.source}`);
  });

  document.getElementById('btn-ping-instagram').addEventListener('click', async () => {
    const status = await client().instagramStatus();
    await refreshCreationLog();
    showToast(status.ok ? `Graph ${status.httpStatus} @${status.account.username}` : status.error);
  });
  document.getElementById('btn-generate-hooks').addEventListener('click', async () => {
    const result = await client().generateHooks({
      title: document.getElementById('render-hook').value,
      bpm: 142,
      style: 'Progressive Psytrance',
    });
    await refreshCreationLog();
    showToast(`${result.hooks.length} הוקים מ-${result.source}`);
  });
  document.getElementById('btn-refresh-log').addEventListener('click', refreshCreationLog);
  document.getElementById('btn-clear-log').addEventListener('click', async () => {
    await client().clearCreationLog();
    await refreshCreationLog();
  });
  document.getElementById('btn-render-tone').addEventListener('click', () => renderReelFromUi(null));
  document.getElementById('btn-render-audio').addEventListener('click', async () => {
    const file = document.getElementById('audio-file').files[0];
    if (!file) {
      showToast('בחר קובץ אודיו או גרור לתיבה');
      return;
    }
    await importAndRender(file);
  });

  document.getElementById('btn-scan-music').addEventListener('click', scanMusicLibrary);
  document.getElementById('btn-play-track').addEventListener('click', () => selectTrack(playerIndex < 0 ? 0 : playerIndex, true));
  document.getElementById('btn-stop-track').addEventListener('click', () => {
    libraryAudio.pause();
    libraryAudio.currentTime = 0;
  });
  document.getElementById('btn-skip-5').addEventListener('click', () => {
    libraryAudio.currentTime += 5;
  });
  document.getElementById('btn-prev-track').addEventListener('click', () =>
    selectTrack(playerIndex - 1, true),
  );
  document.getElementById('btn-next-track').addEventListener('click', () =>
    selectTrack(playerIndex + 1, true),
  );
  document.getElementById('btn-loop-track').addEventListener('click', () => {
    playerLoop = !playerLoop;
    libraryAudio.loop = playerLoop;
    document.getElementById('btn-loop-track').textContent = playerLoop
      ? '🔁 ברצף: פעיל'
      : '🔁 ברצף: כבוי';
  });
  document.getElementById('player-volume').addEventListener('input', (event) => {
    const value = Number(event.target.value);
    libraryAudio.volume = value / 100;
    document.getElementById('volume-label').textContent = `${value}%`;
  });
  document.getElementById('track-select').addEventListener('change', (event) => {
    selectTrack(Number(event.target.value), false);
  });
  libraryAudio.addEventListener('timeupdate', updatePlayerClock);
  libraryAudio.addEventListener('ended', () => {
    if (playerLoop) {
      return;
    }
    selectTrack(playerIndex + 1, true);
  });
  libraryAudio.volume = 0.75;
  document.getElementById('btn-loop-track').textContent = '🔁 ברצף: פעיל';
}

function setupDropZone() {
  const zone = document.getElementById('drop-zone');
  ['dragenter', 'dragover'].forEach((eventName) => {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((eventName) => {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.remove('dragover');
    });
  });
  zone.addEventListener('drop', async (event) => {
    const file = event.dataTransfer.files[0];
    if (!file) {
      return;
    }
    await importAndRender(file);
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupActions();
  setupPlayerWatchGate();
  setupDropZone();
  await loadApprovalQueue();
  await refreshCreationLog();
  await loadPlayerIndex();
});
