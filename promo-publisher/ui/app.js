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
  if (tabId === 'player-tab') {
    refreshPlayerLibrary();
  }
  if (tabId === 'create-tab') {
    // keep log
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

  Object.entries(health).forEach(([key, item]) => {
    const configured = item.configured ?? item.cloudflared;
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
  document.getElementById('btn-remix-hook').addEventListener('click', () => {
    const en = document.getElementById('caption-en').value;
    document.getElementById('caption-he').value = en ? `גרסה חדשה: ${en}` : 'הוק חדש — חכו לדרופ...';
    showToast('הוק עודכן — ערוך לפני פרסום');
  });
}

function setupDropZone() {
  // legacy drop zone removed — create tab uses live APIs
}

function appendCreateLog(text) {
  const el = document.getElementById('create-log');
  if (!el) return;
  const stamp = new Date().toISOString().slice(11, 19);
  el.textContent = `[${stamp}]\n${text}\n\n${el.textContent}`.slice(0, 12000);
}

const playerState = { items: [], index: -1 };

async function refreshPlayerLibrary() {
  if (!window.api?.getLibrary) return;
  const data = await window.api.getLibrary({ limit: 400 });
  playerState.items = data.items || [];
  const status = document.getElementById('player-index-status');
  if (status) {
    status.textContent = data.hasIndex
      ? `אינדקס · ${data.counts?.total || 0} קבצים · ${data.scannedAt}`
      : '⚠️ אין אינדקס מוזיקה — הרץ סריקה';
  }
  const list = document.getElementById('player-list');
  if (!list) return;
  list.innerHTML = '';
  playerState.items.forEach((item, i) => {
    const li = document.createElement('li');
    li.textContent = `${item.name} · ${item.kind}`;
    li.addEventListener('click', () => {
      playerState.index = i;
      document.getElementById('create-audio').value = item.path;
      document.getElementById('player-now').textContent = item.name;
      if (item.kind === 'audio') {
        const audio = document.getElementById('library-audio');
        audio.src = `file://${item.path.replace(/\\/g, '/')}`;
        audio.play().catch(() => {});
      }
    });
    list.appendChild(li);
  });
}

function setupLiveApis() {
  document.getElementById('btn-engine-status')?.addEventListener('click', async () => {
    const status = await window.api.getEnginesStatus();
    appendCreateLog(status.log || JSON.stringify(status, null, 2));
  });

  document.getElementById('btn-gen-hooks')?.addEventListener('click', async () => {
    const data = await window.api.generateHooks({
      track: document.getElementById('create-track').value,
      bpm: 142,
      genre: 'Psytrance',
    });
    const lines = (data.hooks || []).map((h, i) => `${i + 1}. "${h.text}"`).join('\n');
    appendCreateLog(`[REELHOOK] source=${data.source}\n${lines}`);
    if (data.hooks?.[0]?.text) {
      document.getElementById('create-hook').value = data.hooks[0].text;
    }
  });

  document.getElementById('btn-render-live')?.addEventListener('click', async () => {
    const audioPath = document.getElementById('create-audio').value.trim();
    if (!audioPath) {
      appendCreateLog('[RENDER] בחר קובץ אודיו ב-Player או הדבק path');
      return;
    }
    appendCreateLog(`[RENDER] FFmpeg starting…\n${audioPath}`);
    const data = await window.api.renderReel({
      audioPath,
      hook: document.getElementById('create-hook').value,
      durationSec: 8,
      fps: 30,
    });
    appendCreateLog(
      data.success
        ? `[SUCCESS] ${data.relativePath} ${data.width}x${data.height}`
        : `[ERROR] ${data.error}\n${data.detail || ''}`,
    );
  });

  document.getElementById('btn-create-campaign')?.addEventListener('click', async () => {
    const data = await window.api.createCampaign({
      track: document.getElementById('create-track').value,
      audioPath: document.getElementById('create-audio').value.trim(),
      hook: document.getElementById('create-hook').value,
      bpm: 142,
      genre: 'Psytrance',
      durationSec: 8,
      fps: 30,
    });
    appendCreateLog(data.log || JSON.stringify(data, null, 2));
    if (data.success) {
      showToast('נוסף לתור אישור');
      await loadApprovalQueue();
    }
  });

  document.getElementById('btn-media-scan')?.addEventListener('click', async () => {
    await window.api.scanMedia({});
    await refreshPlayerLibrary();
    showToast('סריקת מדיה הושלמה');
  });

  document.getElementById('btn-media-play')?.addEventListener('click', () => {
    const audio = document.getElementById('library-audio');
    if (!audio.src && playerState.items.length) {
      const audioItem = playerState.items.find((x) => x.kind === 'audio');
      if (audioItem) {
        document.getElementById('create-audio').value = audioItem.path;
        audio.src = `file://${audioItem.path.replace(/\\/g, '/')}`;
      }
    }
    audio.play().catch(() => showToast('אין אודיו לנגן'));
  });

  document.getElementById('btn-media-stop')?.addEventListener('click', () => {
    const audio = document.getElementById('library-audio');
    audio.pause();
    audio.currentTime = 0;
  });
}

window.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupActions();
  setupPlayerWatchGate();
  setupDropZone();
  setupLiveApis();
  loadApprovalQueue();
});
