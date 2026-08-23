let currentCampaign = null;
let hasWatchedCurrent = false;
let libraryItems = [];
let libraryIndex = 0;
let selectedHook = '';

const player = document.getElementById('main-player');
const publishBtn = document.getElementById('btn-publish');
const watchHint = document.getElementById('watch-hint');
const universal = document.getElementById('universal-player');

async function httpJson(pathname, options) {
  const res = await fetch(pathname, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? res.statusText);
  }
  return data;
}

const httpApi = {
  getTrends: () => httpJson('/api/radar'),
  scanRadar: () => httpJson('/api/radar/scan', { method: 'POST' }),
  getTemplate: async (templateId) => {
    const items = await httpJson('/api/radar');
    return (items ?? []).find((item) => item.id === templateId) ?? null;
  },
  getPendingApproval: async () => [],
  rejectCampaign: async () => ({ success: true }),
  markWatched: async () => null,
  getPublishHistory: async () => [],
  getConnectionHealth: () => httpJson('/api/health'),
  resolveMediaPath: async (relativePath) => ({
    exists: Boolean(relativePath),
    path: relativePath ? `/${relativePath}` : null,
  }),
  approveAndPublish: async () => ({ success: false, error: 'Publish requires the Electron desktop app' }),
  openExternal: (url) => window.open(url, '_blank'),
  getCreationLog: () => httpJson('/api/log'),
  clearCreationLog: () => httpJson('/api/log/clear', { method: 'POST' }),
  generateHooks: (payload) => httpJson('/api/hooks', { method: 'POST', body: JSON.stringify(payload) }),
  getLibrary: () => httpJson('/api/library'),
  scanLibrary: () => httpJson('/api/library/scan', { method: 'POST' }),
  renderAudio: (payload) => httpJson('/api/render', { method: 'POST', body: JSON.stringify(payload) }),
};

const api = window.api ?? httpApi;

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3200);
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((el) => el.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  document.querySelector(`[data-tab="${tabId}"]`)?.classList.add('active');

  if (tabId === 'radar-tab') loadRadarData();
  if (tabId === 'approval-tab') loadApprovalQueue();
  if (tabId === 'history-tab') loadHistory();
  if (tabId === 'connections-tab') loadConnections();
  if (tabId === 'create-tab') loadCreationLog();
  if (tabId === 'player-tab') loadLibrary();
}

function updatePublishButtonState() {
  const canPublish = Boolean(currentCampaign) && hasWatchedCurrent;
  publishBtn.disabled = !canPublish;
  watchHint.textContent = canPublish
    ? '✅ צפית בסרטון — ניתן לפרסם'
    : '▶ לחץ Play כדי לאפשר פרסום';
}

async function loadApprovalQueue() {
  const queue = await api.getPendingApproval();
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
  document.getElementById('video-duration').textContent = `${currentCampaign.duration} | ${currentCampaign.format}`;
  document.getElementById('caption-he').value = currentCampaign.captionHe ?? '';
  document.getElementById('caption-en').value = currentCampaign.captionEn ?? '';
  document.getElementById('post-hashtags').value = currentCampaign.hashtags ?? '';

  const media = currentCampaign.videoPath
    ? await api.resolveMediaPath(currentCampaign.videoPath)
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
  const trends = await api.getTrends();
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
  const template = await api.getTemplate(templateId);
  if (!template) {
    showToast('תבנית לא נמצאה');
    return;
  }
  switchTab('approval-tab');
  document.getElementById('caption-en').value = template.hookText;
  showToast(`הוחלה תבנית: ${template.style}`);
}

async function loadHistory() {
  const history = await api.getPublishHistory();
  const body = document.getElementById('history-body');
  body.innerHTML = '';

  if (!history?.length) {
    body.innerHTML = '<tr><td colspan="4">אין פרסומים עדיין</td></tr>';
    return;
  }

  history.forEach((entry) => {
    const row = document.createElement('tr');
    const live = entry.live && !entry.mock;
    row.innerHTML = `
      <td>${new Date(entry.publishedAt).toLocaleString('he-IL')}</td>
      <td>${entry.campaignId}</td>
      <td>${(entry.platforms ?? []).join(', ')}</td>
      <td class="${live ? 'badge-ok' : 'badge-fail'}">${live ? 'API חי' : 'נכשל / חסר טוקן'}</td>
    `;
    body.appendChild(row);
  });
}

async function loadConnections() {
  const health = await api.getConnectionHealth();
  const grid = document.getElementById('connections-grid');
  grid.innerHTML = '';

  Object.entries(health).forEach(([, item]) => {
    const live = Boolean(item.live ?? item.configured ?? item.cloudflared);
    const card = document.createElement('div');
    card.className = 'connection-card';
    card.innerHTML = `
      <h3>${item.label}</h3>
      <div class="connection-status">
        <div class="status-indicator ${live ? 'online' : ''}" style="${live ? '' : 'background:#ef4444'}"></div>
        <span>${live ? 'חי / מוכן' : item.error ?? 'דורש הגדרה'}</span>
      </div>
      ${item.username ? `<p class="muted">@${item.username}</p>` : ''}
      ${item.version ? `<p class="muted">${item.version}</p>` : ''}
      ${item.host ? `<p class="muted">${item.host} · ${item.model ?? ''}</p>` : ''}
      ${item.count != null ? `<p class="muted">${item.count} קבצים באינדקס</p>` : ''}
      ${item.mode ? `<p class="muted">מצב TikTok: ${item.mode}</p>` : ''}
    `;
    grid.appendChild(card);
  });
}

async function loadCreationLog() {
  const log = await api.getCreationLog();
  document.getElementById('creation-log').textContent = log.text || 'הלוג ריק — הרץ רינדור / הוקים / סריקה';
}

async function loadLibrary() {
  const lib = await api.getLibrary();
  libraryItems = lib.items ?? [];
  const status = document.getElementById('library-status');
  const select = document.getElementById('library-select');
  status.textContent = libraryItems.length
    ? `${libraryItems.length} קבצים · סריקה ${lib.scannedAt ?? ''}`
    : 'אין אינדקס מוזיקה — הרץ סריקה';
  select.innerHTML = '';
  libraryItems.forEach((item, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${item.kind} · ${item.name}`;
    select.appendChild(option);
  });
}

function libraryUrl(item) {
  return `/api/library/file/${item.id}`;
}

function playLibraryAt(index) {
  if (!libraryItems.length) {
    return;
  }
  libraryIndex = (index + libraryItems.length) % libraryItems.length;
  const item = libraryItems[libraryIndex];
  document.getElementById('library-select').value = String(libraryIndex);
  if (item.kind === 'midi') {
    showToast('MIDI — נפתח רק כמטא-דאטה. בחר WAV/MP3 לניגון בדפדפן');
    return;
  }
  universal.src = libraryUrl(item);
  universal.loop = document.getElementById('chk-loop').checked;
  universal.volume = Number(document.getElementById('vol').value) / 100;
  universal.play();
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
  const result = await api.approveAndPublish(payload);

  if (result.success) {
    showToast('הסרטון פורסם דרך API חי');
    await loadApprovalQueue();
    await loadHistory();
  } else {
    showToast(result.error ?? 'הפרסום נכשל');
    updatePublishButtonState();
  }
  await loadCreationLog();
}

async function rejectCurrent() {
  if (!currentCampaign) {
    return;
  }
  if (!confirm('לדחות ולהסיר את הסרטון מתור האישורים?')) {
    return;
  }
  await api.rejectCampaign(currentCampaign.id);
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
    await api.markWatched(currentCampaign.id);
    updatePublishButtonState();
  });
}

function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach((button) => {
    button.addEventListener('click', () => switchTab(button.getAttribute('data-tab')));
  });
}

async function generateHooks() {
  const title = document.getElementById('create-title').value;
  try {
    const result = await api.generateHooks({ title, language: 'he' });
    const list = document.getElementById('hooks-list');
    list.innerHTML = '';
    result.hooks.forEach((hook) => {
      const item = document.createElement('li');
      item.textContent = hook;
      item.addEventListener('click', () => {
        selectedHook = hook;
        document.getElementById('caption-en').value = hook;
        showToast('הוק נבחר');
      });
      list.appendChild(item);
    });
    selectedHook = result.hooks[0];
    showToast(`Ollama ${result.model} — 3 הוקים`);
  } catch (error) {
    showToast(error.message);
  }
  await loadCreationLog();
}

async function renderSelected() {
  const fileInput = document.getElementById('audio-file');
  const file = fileInput.files?.[0];
  if (!file?.path && !file) {
    showToast('בחר קובץ אודיו');
    return;
  }
  const audioPath = file.path || file.name;
  if (!file.path) {
    showToast('ברינדור דסקטופ נדרש נתיב מלא (Electron). ב-API העבר audioPath.');
  }
  try {
    const result = await api.renderAudio({
      audioPath,
      title: document.getElementById('create-title').value,
      hook: selectedHook,
    });
    showToast(`רונדר: ${result.relativePath}`);
    await loadApprovalQueue();
  } catch (error) {
    showToast(error.message);
  }
  await loadCreationLog();
}

function setupActions() {
  document.getElementById('btn-publish').addEventListener('click', approveCurrent);
  document.getElementById('btn-reject').addEventListener('click', rejectCurrent);
  document.getElementById('btn-scan-radar').addEventListener('click', async () => {
    await api.scanRadar();
    await loadRadarData();
    showToast('סריקת רדאר הושלמה');
  });
  document.getElementById('btn-remix-hook').addEventListener('click', generateHooks);
  document.getElementById('btn-generate-hooks').addEventListener('click', generateHooks);
  document.getElementById('btn-render').addEventListener('click', renderSelected);
  document.getElementById('btn-refresh-log').addEventListener('click', loadCreationLog);
  document.getElementById('btn-scan-library').addEventListener('click', async () => {
    await api.scanLibrary();
    await loadLibrary();
    showToast('סריקת ספרייה הושלמה');
  });
  document.getElementById('btn-play').addEventListener('click', () => {
    const selected = Number(document.getElementById('library-select').value || libraryIndex);
    playLibraryAt(selected);
  });
  document.getElementById('btn-stop').addEventListener('click', () => {
    universal.pause();
    universal.currentTime = 0;
  });
  document.getElementById('btn-fwd').addEventListener('click', () => {
    universal.currentTime += 5;
  });
  document.getElementById('btn-prev').addEventListener('click', () => playLibraryAt(libraryIndex - 1));
  document.getElementById('btn-next').addEventListener('click', () => playLibraryAt(libraryIndex + 1));
  document.getElementById('vol').addEventListener('input', (event) => {
    universal.volume = Number(event.target.value) / 100;
  });
  document.getElementById('chk-loop').addEventListener('change', (event) => {
    universal.loop = event.target.checked;
  });
  universal.addEventListener('timeupdate', () => {
    const t = Math.floor(universal.currentTime);
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    document.getElementById('player-time').textContent = `${mm}:${ss}`;
  });
  universal.addEventListener('ended', () => {
    if (document.getElementById('chk-loop').checked) {
      playLibraryAt(libraryIndex + 1);
    }
  });
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
  zone.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      const input = document.getElementById('audio-file');
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      document.getElementById('create-title').value = file.name.replace(/\.[^.]+$/, '');
      showToast(`נבחר ${file.name} — לחץ רנדר 9:16`);
    }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupActions();
  setupPlayerWatchGate();
  setupDropZone();
  loadApprovalQueue();
  loadCreationLog();
});
