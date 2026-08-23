let currentCampaign = null;
let hasWatchedCurrent = false;
let selectedAudioPath = null;
let musicTracks = [];
let currentTrackIndex = -1;

const player = document.getElementById('main-player');
const publishBtn = document.getElementById('btn-publish');
const watchHint = document.getElementById('watch-hint');
const engineLog = document.getElementById('engine-log');
const universalAudio = document.getElementById('universal-audio');

function apiBase() {
  if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    return window.location.origin;
  }
  return 'http://127.0.0.1:4050';
}

async function httpJson(method, pathname, body) {
  const response = await fetch(`${apiBase()}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok && !data.error) {
    throw new Error(`HTTP ${response.status}`);
  }
  return data;
}

const studio = {
  getTrends: () =>
    window.api?.getTrends ? window.api.getTrends() : httpJson('GET', '/api/health').then(() => []),
  scanRadar: () => (window.api?.scanRadar ? window.api.scanRadar() : Promise.resolve(null)),
  getTemplate: (id) => (window.api?.getTemplate ? window.api.getTemplate(id) : Promise.resolve(null)),
  getPendingApproval: () =>
    window.api?.getPendingApproval
      ? window.api.getPendingApproval()
      : httpJson('GET', '/api/approval/pending'),
  rejectCampaign: (id) =>
    window.api?.rejectCampaign
      ? window.api.rejectCampaign(id)
      : httpJson('POST', '/api/approval/reject', { id }),
  markWatched: (id) =>
    window.api?.markWatched
      ? window.api.markWatched(id)
      : httpJson('POST', '/api/approval/mark-watched', { id }),
  getPublishHistory: () =>
    window.api?.getPublishHistory
      ? window.api.getPublishHistory()
      : httpJson('GET', '/api/approval/history'),
  getConnectionHealth: () =>
    window.api?.getConnectionHealth
      ? window.api.getConnectionHealth()
      : httpJson('GET', '/api/health'),
  resolveMediaPath: async (relativePath) => {
    if (window.api?.resolveMediaPath) {
      return window.api.resolveMediaPath(relativePath);
    }
    const url = `${apiBase()}/api/media?rel=${encodeURIComponent(relativePath)}`;
    const response = await fetch(url);
    return { exists: response.ok, path: response.ok ? url : null };
  },
  approveAndPublish: (campaignData) =>
    window.api?.approveAndPublish
      ? window.api.approveAndPublish(campaignData)
      : httpJson('POST', '/api/approval/publish', campaignData),
  renderReel: (payload) =>
    window.api?.renderReel ? window.api.renderReel(payload) : httpJson('POST', '/api/render', payload),
  generateHooks: (payload) =>
    window.api?.generateHooks
      ? window.api.generateHooks(payload)
      : httpJson('POST', '/api/hooks', payload),
  getInstagramHealth: () =>
    window.api?.getInstagramHealth
      ? window.api.getInstagramHealth()
      : httpJson('GET', '/api/instagram/health'),
  scanLibrary: (payload) =>
    window.api?.scanLibrary
      ? window.api.scanLibrary(payload)
      : httpJson('POST', '/api/player/scan', payload ?? {}),
  getMusicIndex: () =>
    window.api?.getMusicIndex
      ? window.api.getMusicIndex()
      : httpJson('GET', '/api/player/index'),
  createCampaign: (payload) =>
    window.api?.createCampaign
      ? window.api.createCampaign(payload)
      : httpJson('POST', '/api/create-campaign', payload),
};

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3200);
}

function appendLog(line) {
  const stamp = new Date().toISOString();
  engineLog.textContent += `[${stamp}] ${line}\n`;
  engineLog.scrollTop = engineLog.scrollHeight;
}

function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const secs = String(total % 60).padStart(2, '0');
  return `${minutes}:${secs}`;
}

function flattenHealth(health) {
  const cards = [];
  Object.entries(health ?? {}).forEach(([key, value]) => {
    if (key === 'mock' || key === 'checkedAt') {
      return;
    }
    if (value && typeof value === 'object' && value.label) {
      cards.push([key, value]);
      return;
    }
    if (value && typeof value === 'object') {
      Object.entries(value).forEach(([innerKey, inner]) => {
        if (inner && typeof inner === 'object' && inner.label) {
          cards.push([innerKey, inner]);
        }
      });
    }
  });
  return cards;
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
  if (tabId === 'create-tab') {
    refreshEngineLogFromHealth();
    refreshPlayerIndex();
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
  const queue = await studio.getPendingApproval();
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
    ? await studio.resolveMediaPath(currentCampaign.videoPath)
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
  const trends = await studio.getTrends();
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
      const templateId = button.getAttribute('data-template');
      await useTemplate(templateId);
    });
  });
}

async function useTemplate(templateId) {
  const template = await studio.getTemplate(templateId);
  if (!template) {
    showToast('תבנית לא נמצאה');
    return;
  }

  switchTab('approval-tab');
  document.getElementById('caption-en').value = template.hookText;
  showToast(`הוחלה תבנית: ${template.style}`);
}

async function loadHistory() {
  const history = await studio.getPublishHistory();
  const body = document.getElementById('history-body');
  body.innerHTML = '';

  if (!history?.length) {
    body.innerHTML = '<tr><td colspan="4">אין פרסומים עדיין</td></tr>';
    return;
  }

  history.forEach((entry) => {
    const row = document.createElement('tr');
    const failed = (entry.results ?? []).some((item) => item.success === false);
    const statusClass = failed ? 'badge-fail' : entry.mock ? 'badge-mock' : 'badge-ok';
    const statusText = failed ? 'נכשל' : entry.mock ? 'סימולציה' : 'פורסם';
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
  const health = await studio.getConnectionHealth();
  const grid = document.getElementById('connections-grid');
  grid.innerHTML = '';

  flattenHealth(health).forEach(([, item]) => {
    const live = Boolean(item.live ?? item.configured ?? item.cloudflared);
    const card = document.createElement('div');
    card.className = 'connection-card';
    card.innerHTML = `
      <h3>${item.label}</h3>
      <div class="connection-status">
        <div class="status-indicator ${live ? 'online' : ''}" style="${live ? '' : 'background:#ef4444'}"></div>
        <span>${live ? 'חי / מוגדר' : item.error || 'דורש הגדרה ב-.env'}</span>
      </div>
      ${item.mode ? `<p class="muted">מצב: ${item.mode}</p>` : ''}
      ${item.version ? `<p class="muted" dir="ltr">${item.version}</p>` : ''}
      ${item.status ? `<p class="muted">HTTP ${item.status}</p>` : ''}
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
  const result = await studio.approveAndPublish(payload);

  if (result.success) {
    showToast(result.mock ? 'סימולציית פרסום הושלמה' : 'הסרטון פורסם בהצלחה!');
    await loadApprovalQueue();
    await loadHistory();
  } else {
    showToast(result.error ?? 'הפרסום נכשל');
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

  await studio.rejectCampaign(currentCampaign.id);
  showToast('הסרטון הוסר מהתור');
  await loadApprovalQueue();
}

function setSelectedAudio(filePath, displayName) {
  selectedAudioPath = filePath;
  const pathInput = document.getElementById('audio-path-input');
  if (pathInput && filePath) {
    pathInput.value = filePath;
  }
  appendLog(`AUDIO selected: ${filePath}`);
  if (displayName) {
    document.getElementById('player-track-name').textContent = displayName;
  }
}

async function refreshEngineLogFromHealth() {
  const health = await studio.getConnectionHealth();
  engineLog.textContent = '';
  appendLog(`[SYSTEM] ShiBass real API server ${apiBase()}`);
  flattenHealth(health).forEach(([, item]) => {
    const state = item.live ? 'LIVE' : 'DOWN';
    const extra = item.error ? ` — ${item.error}` : item.version ? ` — ${item.version}` : '';
    appendLog(`[${state}] ${item.label}${extra}`);
  });
}

async function runRender() {
  if (!selectedAudioPath) {
    showToast('בחר קובץ אודיו קודם');
    return;
  }
  appendLog(`[RENDER] FFmpeg 9:16 starting for ${selectedAudioPath}`);
  const result = await studio.renderReel({ audioPath: selectedAudioPath });
  appendLog(
    `[SUCCESS] ${result.relativePath} (${result.width}x${result.height} ${result.fps}fps, ${result.sizeBytes} bytes)`,
  );
  showToast('הרינדור הושלם');
  return result;
}

async function runHooks() {
  const trackName = pathBasename(selectedAudioPath || 'ShiBass');
  appendLog(`[REELHOOK] requesting hooks for ${trackName}`);
  const result = await studio.generateHooks({ trackName, title: trackName });
  appendLog(`[REELHOOK] source=${result.source}${result.warning ? ` warning=${result.warning}` : ''}`);
  result.hooks.forEach((hook, index) => appendLog(`${index + 1}. ${hook}`));
  if (currentCampaign) {
    document.getElementById('caption-he').value = result.hooks[0] ?? '';
    document.getElementById('caption-en').value = result.hooks[1] ?? '';
  }
  showToast('הוקים נוצרו');
  return result;
}

async function runInstagramHealth() {
  appendLog('[INSTAGRAM] probing Graph API…');
  const result = await studio.getInstagramHealth();
  appendLog(
    `[INSTAGRAM] live=${result.live} status=${result.status ?? 'n/a'} ${result.error ?? result.accountName ?? ''}`,
  );
  showToast(result.live ? 'Instagram Graph API חי' : 'Instagram API לא מחובר');
}

async function runCreateCampaign() {
  if (!selectedAudioPath) {
    showToast('בחר קובץ אודיו קודם');
    return;
  }
  appendLog(`[CAMPAIGN] render + enqueue ${selectedAudioPath}`);
  const result = await studio.createCampaign({ audioPath: selectedAudioPath });
  appendLog(`[CAMPAIGN] queued ${result.campaign.id} → ${result.render.relativePath}`);
  showToast('הקמפיין נכנס לתור האישור');
  await loadApprovalQueue();
}

function pathBasename(filePath) {
  return String(filePath || '').split(/[\\/]/).pop();
}

function renderTrackList() {
  const select = document.getElementById('player-track-list');
  select.innerHTML = '';
  musicTracks.forEach((track, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${track.playable ? '▶' : '🎹'} ${track.name}`;
    select.appendChild(option);
  });
}

async function refreshPlayerIndex() {
  const index = await studio.getMusicIndex();
  musicTracks = index.tracks ?? [];
  const label = document.getElementById('player-track-name');
  if (!musicTracks.length) {
    label.textContent = 'אין אינדקס מוזיקה — הרץ סריקה';
  } else if (currentTrackIndex < 0) {
    label.textContent = `${musicTracks.length} טראקים באינדקס`;
  }
  renderTrackList();
}

async function scanAndLoadLibrary() {
  appendLog('[PLAYER] scanning music roots…');
  const index = await studio.scanLibrary({});
  musicTracks = index.tracks ?? [];
  appendLog(`[PLAYER] indexed ${index.count} files from ${index.roots.join(', ') || '(no roots)'}`);
  renderTrackList();
  document.getElementById('player-track-name').textContent = `${index.count} טראקים באינדקס`;
  showToast(`נסרקו ${index.count} קבצים`);
}

function loadTrackAt(index) {
  const track = musicTracks[index];
  if (!track) {
    return;
  }
  currentTrackIndex = index;
  document.getElementById('player-track-name').textContent = track.name;
  document.getElementById('player-track-list').value = String(index);
  selectedAudioPath = track.path;
  if (!track.playable) {
    appendLog(`[PLAYER] ${track.name} is MIDI — listed, not HTML-playable`);
    showToast('MIDI מופיע באינדקס אבל צריך WAV/MP3 לניגון');
    return;
  }
  universalAudio.src = `${apiBase()}/api/player/file?id=${encodeURIComponent(track.id)}`;
  universalAudio.play().catch(() => {
    showToast('לא ניתן לנגן את הקובץ');
  });
}

function setupUniversalPlayer() {
  const volume = document.getElementById('vol-slider');
  universalAudio.volume = Number(volume.value) / 100;
  universalAudio.loop = document.getElementById('chk-loop').checked;

  document.getElementById('btn-play').addEventListener('click', () => {
    if (currentTrackIndex < 0 && musicTracks.length) {
      loadTrackAt(0);
      return;
    }
    universalAudio.play();
  });
  document.getElementById('btn-stop').addEventListener('click', () => {
    universalAudio.pause();
    universalAudio.currentTime = 0;
  });
  document.getElementById('btn-plus5').addEventListener('click', () => {
    universalAudio.currentTime += 5;
  });
  document.getElementById('btn-prev').addEventListener('click', () => {
    if (currentTrackIndex > 0) {
      loadTrackAt(currentTrackIndex - 1);
    }
  });
  document.getElementById('btn-next').addEventListener('click', () => {
    if (currentTrackIndex + 1 < musicTracks.length) {
      loadTrackAt(currentTrackIndex + 1);
    }
  });
  document.getElementById('chk-loop').addEventListener('change', (event) => {
    universalAudio.loop = event.target.checked;
  });
  volume.addEventListener('input', () => {
    universalAudio.volume = Number(volume.value) / 100;
    document.getElementById('vol-label').textContent = `${volume.value}%`;
  });
  universalAudio.addEventListener('timeupdate', () => {
    document.getElementById('player-time').textContent = formatClock(universalAudio.currentTime);
  });
  document.getElementById('player-track-list').addEventListener('change', (event) => {
    loadTrackAt(Number(event.target.value));
  });
}

function setupPlayerWatchGate() {
  player.addEventListener('play', async () => {
    if (!currentCampaign || hasWatchedCurrent) {
      return;
    }

    hasWatchedCurrent = true;
    currentCampaign.watched = true;
    await studio.markWatched(currentCampaign.id);
    updatePublishButtonState();
  });
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
    await studio.scanRadar();
    await loadRadarData();
    showToast('סריקת רדאר הושלמה');
  });
  document.getElementById('btn-remix-hook').addEventListener('click', async () => {
    const title = currentCampaign?.title || pathBasename(selectedAudioPath || 'ShiBass');
    const result = await studio.generateHooks({ trackName: title, title });
    document.getElementById('caption-he').value = result.hooks[0] ?? '';
    document.getElementById('caption-en').value = result.hooks[1] ?? '';
    showToast(`הוק מ-${result.source}`);
  });
  document.getElementById('audio-path-input').addEventListener('change', (event) => {
    const value = event.target.value.trim();
    if (value) {
      setSelectedAudio(value, pathBasename(value));
    }
  });
  document.getElementById('btn-pick-audio').addEventListener('click', () => {
    document.getElementById('audio-file-input').click();
  });
  document.getElementById('audio-file-input').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setSelectedAudio(file.path || file.name, file.name);
    if (!file.path) {
      appendLog('[WARN] Browser file input has no absolute path — drop from Electron or paste a full path');
    }
  });
  document.getElementById('btn-render').addEventListener('click', () => {
    runRender().catch((error) => appendLog(`[ERROR] ${error.message}`));
  });
  document.getElementById('btn-hooks').addEventListener('click', () => {
    runHooks().catch((error) => appendLog(`[ERROR] ${error.message}`));
  });
  document.getElementById('btn-ig-health').addEventListener('click', () => {
    runInstagramHealth().catch((error) => appendLog(`[ERROR] ${error.message}`));
  });
  document.getElementById('btn-create-campaign').addEventListener('click', () => {
    runCreateCampaign().catch((error) => appendLog(`[ERROR] ${error.message}`));
  });
  document.getElementById('btn-refresh-health').addEventListener('click', () => {
    refreshEngineLogFromHealth().catch((error) => appendLog(`[ERROR] ${error.message}`));
  });
  document.getElementById('btn-scan-library').addEventListener('click', () => {
    scanAndLoadLibrary().catch((error) => appendLog(`[ERROR] ${error.message}`));
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
    if (!file) {
      return;
    }
    const absolute = file.path || null;
    setSelectedAudio(absolute || file.name, file.name);
    if (absolute) {
      runCreateCampaign().catch((error) => appendLog(`[ERROR] ${error.message}`));
    } else {
      showToast('יש צורך בנתיב מלא — הפעל מדסקטופ Electron או הזן נתיב');
    }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupActions();
  setupPlayerWatchGate();
  setupDropZone();
  setupUniversalPlayer();
  loadApprovalQueue();
  refreshEngineLogFromHealth().catch(() => {
    appendLog('[SYSTEM] API server is not reachable yet — start with npm run api');
  });
  refreshPlayerIndex().catch(() => undefined);
});
