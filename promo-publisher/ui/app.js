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
  zone.addEventListener('drop', () => {
    showToast('שלב הבא: חיבור למנוע FFmpeg לרינדור אוטומטי');
  });
}

window.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupActions();
  setupPlayerWatchGate();
  setupDropZone();
  loadApprovalQueue();
});
