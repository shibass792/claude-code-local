let currentCampaign = null;
let hasWatchedCurrent = false;

const player = document.getElementById('main-player');
const publishBtn = document.getElementById('btn-publish');
const watchHint = document.getElementById('watch-hint');

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
    refreshCreationLog();
  }
  if (tabId === 'player-tab') {
    loadMusicIndex();
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
  if (!window.api) {
    return;
  }

  const queue = await window.api.getPendingApproval();
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
    ? await window.api.resolveMediaPath(currentCampaign.videoPath)
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
      const templateId = button.getAttribute('data-template');
      await useTemplate(templateId);
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
  if (!window.api) {
    return;
  }

  const history = await window.api.getPublishHistory();
  const body = document.getElementById('history-body');
  body.innerHTML = '';

  if (!history?.length) {
    body.innerHTML = '<tr><td colspan="4">אין פרסומים עדיין</td></tr>';
    return;
  }

  history.forEach((entry) => {
    const row = document.createElement('tr');
    const statusClass = entry.mock ? 'badge-mock' : 'badge-ok';
    const statusText = entry.mock ? 'סימולציה' : 'פורסם';
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
  if (!window.api) {
    return;
  }

  const health = await window.api.getConnectionHealth();
  const grid = document.getElementById('connections-grid');
  grid.innerHTML = '';

  Object.entries(health).forEach(([_key, item]) => {
    if (!item || typeof item !== 'object' || !item.label) {
      return;
    }
    const configured = item.configured ?? item.cloudflared ?? item.available;
    const card = document.createElement('div');
    card.className = 'connection-card';
    card.innerHTML = `
      <h3>${item.label}</h3>
      <div class="connection-status">
        <div class="status-indicator ${configured ? 'online' : ''}" style="${configured ? '' : 'background:#ef4444'}"></div>
        <span>${configured ? 'מחובר / מוגדר' : 'דורש הגדרה ב-.env'}</span>
      </div>
      ${item.mode ? `<p class="muted">מצב TikTok: ${item.mode}</p>` : ''}
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
  const result = await window.api.approveAndPublish(payload);

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

  await window.api.rejectCampaign(currentCampaign.id);
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
    await window.api.markWatched(currentCampaign.id);
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
    if (window.api?.scanRadar) {
      await window.api.scanRadar();
      await loadRadarData();
      showToast('סריקת רדאר הושלמה');
    }
  });
  document.getElementById('btn-remix-hook').addEventListener('click', async () => {
    if (!window.api?.generateHooks) {
      return;
    }
    const result = await window.api.generateHooks({
      title: currentCampaign?.title || document.getElementById('video-title').textContent,
    });
    if (result?.hooks?.length) {
      document.getElementById('caption-he').value = result.hooks[0];
      document.getElementById('caption-en').value = result.hooks[1] ?? result.hooks[0];
      showToast(`הוקים מ-${result.engine}`);
    } else {
      showToast(result?.error ?? 'יצירת הוקים נכשלה');
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
  zone.addEventListener('drop', async (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }
    await renderDroppedFile(file);
  });
  document.getElementById('audio-file')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (file) {
      await renderDroppedFile(file);
    }
  });
}

async function renderDroppedFile(file) {
  showToast(`מרנדר ${file.name}...`);
  let result;
  if (file.path && window.api?.renderReel) {
    result = await window.api.renderReel({ audioPath: file.path, title: file.name });
  } else if (window.api?.uploadAndRender) {
    result = await window.api.uploadAndRender(file);
  } else {
    showToast('API רינדור לא זמין');
    return;
  }
  await refreshCreationLog();
  if (result?.success) {
    showToast(`רונדר ${result.relativePath}`);
    await loadApprovalQueue();
  } else {
    showToast(result?.error ?? 'הרינדור נכשל');
  }
}

function renderLogText(payload) {
  const box = document.getElementById('creation-log');
  if (!box) {
    return;
  }
  if (!payload?.entries?.length) {
    box.textContent = 'אין לוג עדיין — לחץ "בדוק מנועים" או רנדר טראק.';
    return;
  }
  box.textContent = payload.text;
  box.scrollTop = box.scrollHeight;
}

async function refreshCreationLog() {
  if (!window.api?.getLog) {
    return;
  }
  renderLogText(await window.api.getLog());
}

async function refreshSystemStatus() {
  if (!window.api?.getEngines) {
    return;
  }
  const status = await window.api.getEngines();
  const label = document.querySelector('#system-status span');
  const dot = document.querySelector('#system-status .status-indicator');
  if (!label || !dot) {
    return;
  }
  label.textContent = status.ok ? 'FFmpeg + Studio API פעילים' : 'מנועים חסרים — ראה לוג';
  dot.classList.toggle('online', Boolean(status.ok));
}

let playlist = [];
let playlistIndex = -1;

function currentTrack() {
  return playlist[playlistIndex] ?? null;
}

function streamUrl(track) {
  if (!track) {
    return '';
  }
  if (location.protocol === 'file:') {
    return `file://${track.path.replace(/\\/g, '/')}`;
  }
  return `/api/music/stream/${track.id}`;
}

function renderTrackList() {
  const list = document.getElementById('track-list');
  const status = document.getElementById('player-index-status');
  if (!list) {
    return;
  }
  list.innerHTML = '';
  if (!playlist.length) {
    if (status) {
      status.textContent = 'אין אינדקס מוזיקה — הרץ סריקה';
    }
    return;
  }
  if (status) {
    status.textContent = `${playlist.length} קבצים באינדקס`;
  }
  playlist.forEach((track, index) => {
    const item = document.createElement('li');
    item.className = index === playlistIndex ? 'active' : '';
    item.textContent = `${track.kind === 'midi' ? '🎹' : '🎵'} ${track.name}`;
    item.addEventListener('click', () => playAt(index));
    list.appendChild(item);
  });
}

async function loadMusicIndex() {
  if (!window.api?.getMusicIndex) {
    return;
  }
  const index = await window.api.getMusicIndex();
  playlist = index.tracks ?? [];
  renderTrackList();
}

function playAt(index) {
  const audio = document.getElementById('universal-audio');
  const track = playlist[index];
  if (!audio || !track) {
    return;
  }
  if (track.kind === 'midi') {
    showToast('MIDI מאונדקס — נגן אודיו דורש WAV/MP3. בחר טראק אודיו או רנדר.');
    playlistIndex = index;
    document.getElementById('now-playing').textContent = track.name;
    renderTrackList();
    return;
  }
  playlistIndex = index;
  audio.src = streamUrl(track);
  audio.play().catch((error) => showToast(error.message));
  document.getElementById('now-playing').textContent = track.name;
  renderTrackList();
}

function setupPlayerControls() {
  const audio = document.getElementById('universal-audio');
  if (!audio) {
    return;
  }
  document.getElementById('btn-scan-music')?.addEventListener('click', async () => {
    showToast('סורק ספריית מוזיקה...');
    await window.api.scanMusic({});
    await loadMusicIndex();
    await refreshCreationLog();
    showToast('הסריקה הושלמה');
  });
  document.getElementById('btn-play')?.addEventListener('click', () => {
    if (playlistIndex < 0 && playlist.length) {
      playAt(0);
      return;
    }
    audio.play().catch((error) => showToast(error.message));
  });
  document.getElementById('btn-stop')?.addEventListener('click', () => {
    audio.pause();
    audio.currentTime = 0;
  });
  document.getElementById('btn-fwd')?.addEventListener('click', () => {
    audio.currentTime = Math.min((audio.duration || 0), audio.currentTime + 5);
  });
  document.getElementById('btn-prev')?.addEventListener('click', () => {
    if (playlist.length) {
      playAt((playlistIndex - 1 + playlist.length) % playlist.length);
    }
  });
  document.getElementById('btn-next')?.addEventListener('click', () => {
    if (playlist.length) {
      playAt((playlistIndex + 1) % playlist.length);
    }
  });
  document.getElementById('volume')?.addEventListener('input', (event) => {
    const value = Number(event.target.value);
    audio.volume = value / 100;
    document.getElementById('volume-label').textContent = `${value}%`;
  });
  audio.volume = 0.75;
  audio.addEventListener('timeupdate', () => {
    const clock = document.getElementById('player-clock');
    if (clock) {
      const cur = Math.floor(audio.currentTime || 0);
      clock.textContent = `${String(Math.floor(cur / 60)).padStart(2, '0')}:${String(cur % 60).padStart(2, '0')}`;
    }
  });
  audio.addEventListener('ended', () => {
    if (document.getElementById('chk-loop')?.checked && playlist.length) {
      playAt((playlistIndex + 1) % playlist.length);
    }
  });
}

function setupStudioActions() {
  document.getElementById('btn-probe-engines')?.addEventListener('click', async () => {
    await window.api.getEngines();
    await refreshCreationLog();
    await refreshSystemStatus();
    showToast('בדיקת מנועים הושלמה');
  });
  document.getElementById('btn-ig-session')?.addEventListener('click', async () => {
    const result = await window.api.instagramSession();
    await refreshCreationLog();
    showToast(result.success ? `Instagram: ${result.engine}` : result.error);
  });
  document.getElementById('btn-generate-hooks')?.addEventListener('click', async () => {
    const track = currentTrack();
    const result = await window.api.generateHooks({
      title: track?.name || 'ShiBass Progressive Psytrance',
      bpm: 142,
    });
    await refreshCreationLog();
    showToast(result.success ? `${result.hooks.length} הוקים מ-${result.engine}` : result.error);
  });
  document.getElementById('btn-render-selected')?.addEventListener('click', async () => {
    const track = currentTrack() || playlist.find((item) => item.kind === 'audio');
    if (!track) {
      showToast('אין טראק אודיו — סרוק או גרור קובץ');
      return;
    }
    const result = await window.api.renderReel({
      audioPath: track.path,
      title: track.name,
    });
    await refreshCreationLog();
    if (result.success) {
      showToast(`רונדר ${result.relativePath}`);
      await loadApprovalQueue();
    } else {
      showToast(result.error ?? 'הרינדור נכשל');
    }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupActions();
  setupPlayerWatchGate();
  setupDropZone();
  setupPlayerControls();
  setupStudioActions();
  loadApprovalQueue();
  refreshSystemStatus();
  refreshCreationLog();
  loadMusicIndex();
});
