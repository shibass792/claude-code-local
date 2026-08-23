'use strict';

let currentCampaign = null;
let selectedMediaPath = null;

function $(id) {
  return document.getElementById(id);
}

function setMessage(el, text, kind) {
  el.textContent = text || '';
  el.classList.remove('error', 'ok');
  if (kind) {
    el.classList.add(kind);
  }
}

function switchTab(tabId, navBtn) {
  document.querySelectorAll('.tab').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((el) => el.classList.remove('active'));
  $(tabId).classList.add('active');
  if (navBtn) {
    navBtn.classList.add('active');
  }

  if (tabId === 'radar-tab') {
    loadRadar();
  } else if (tabId === 'approval-tab') {
    loadApprovalQueue();
  } else if (tabId === 'create-tab') {
    loadTemplates();
  } else if (tabId === 'connections-tab') {
    loadConnections();
  }
}

function selectedPlatforms() {
  const platforms = [];
  if ($('chk-ig').checked) platforms.push('instagram');
  if ($('chk-tt').checked) platforms.push('tiktok');
  if ($('chk-fb').checked) platforms.push('facebook');
  return platforms;
}

function syncApproveButton() {
  const btn = $('btn-approve');
  const markBtn = $('btn-mark-watched');
  const canPublish = Boolean(currentCampaign && currentCampaign.watchedOnce);
  btn.disabled = !canPublish;
  if (markBtn) {
    markBtn.disabled = !currentCampaign || canPublish;
  }
  $('watch-hint').textContent = canPublish
    ? 'הצפייה אושרה — אפשר לפרסם.'
    : 'נגן את הסרטון לפחות פעם אחת (או סמן צפייה) כדי לפתוח פרסום.';
}

async function markCurrentWatched() {
  if (!currentCampaign || currentCampaign.watchedOnce || !window.api) return;
  const res = await window.api.markWatched(currentCampaign.id);
  if (res.success) {
    currentCampaign = res.campaign;
    syncApproveButton();
    setMessage($('action-message'), 'אושרה צפייה בתצוגה המקדימה.', 'ok');
  }
}

function fillCampaignForm(campaign) {
  currentCampaign = campaign;
  $('video-title').textContent = campaign.title;
  $('video-meta').textContent = `${campaign.duration || '—'} · ${campaign.format || '9:16'} · ${campaign.style || ''}`;
  $('caption-he').value = campaign.captionHe || '';
  $('caption-en').value = campaign.captionEn || '';
  $('post-hashtags').value = campaign.hashtags || '';
  $('chk-ig').checked = campaign.platforms.includes('instagram');
  $('chk-tt').checked = campaign.platforms.includes('tiktok');
  $('chk-fb').checked = campaign.platforms.includes('facebook');

  const player = $('main-player');
  if (campaign.videoPath) {
    player.src = `file://${campaign.videoPath}`;
  } else {
    player.removeAttribute('src');
    player.load();
  }
  syncApproveButton();
}

async function loadApprovalQueue() {
  if (!window.api) return;
  const queue = await window.api.getPendingApproval();
  $('queue-count').textContent = `${queue.length} בתור`;

  const empty = $('approval-empty');
  const workspace = $('approval-workspace');

  if (!queue.length) {
    empty.classList.remove('hidden');
    workspace.classList.add('hidden');
    currentCampaign = null;
    return;
  }

  empty.classList.add('hidden');
  workspace.classList.remove('hidden');
  fillCampaignForm(queue[0]);
  setMessage($('action-message'), '');
}

async function loadRadar() {
  if (!window.api) return;
  const [trends, summary] = await Promise.all([
    window.api.getTrends({ winnersOnly: false }),
    window.api.getRadarSummary(),
  ]);

  $('radar-summary').innerHTML = `
    <span>אמנים במעקב: <strong>${summary.watchedArtists}</strong></span>
    <span>פוסטים שנסרקו: <strong>${summary.scannedPosts}</strong></span>
    <span>תבניות מנצחות (≥${summary.threshold}x): <strong>${summary.winningTemplates}</strong></span>
  `;

  const container = $('radar-list');
  container.innerHTML = '';

  trends.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'radar-card';
    card.innerHTML = `
      <div class="badge">${item.isWinningTemplate ? 'WINNING' : 'BASELINE'} · ${item.outlierLabel} · ${Number(item.views).toLocaleString()} views</div>
      <h3>${escapeHtml(item.artist)}</h3>
      <p><strong style="color:#fff">הוק:</strong> ${escapeHtml(item.hookText)}</p>
      <p>סגנון: ${escapeHtml(item.style)} · ${escapeHtml(item.platform || '')}</p>
      <div class="strategy">אסטרטגיה: ${escapeHtml(item.keyStrategy || '')}</div>
      <button type="button" class="btn primary" data-trend-id="${escapeHtml(item.id)}">השתמש במבנה הזה</button>
    `;
    card.querySelector('button').addEventListener('click', async () => {
      await window.api.createFromRadar(item);
      switchTab('approval-tab', document.querySelector('[data-tab="approval-tab"]'));
      await loadApprovalQueue();
    });
    container.appendChild(card);
  });
}

async function loadTemplates() {
  if (!window.api) return;
  const templates = await window.api.listTemplates();
  const select = $('template-select');
  select.innerHTML = '';
  templates.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.label;
    select.appendChild(opt);
  });
}

async function loadConnections() {
  if (!window.api) return;
  const health = await window.api.getConnections();
  const history = await window.api.getHistory();
  const list = $('connections-list');
  list.innerHTML = '';

  Object.entries(health).forEach(([key, info]) => {
    const card = document.createElement('article');
    card.className = 'connection-card';
    const ready = Boolean(info.connected);
    card.innerHTML = `
      <div class="name">${escapeHtml(key)}</div>
      <div class="pill ${ready ? 'ready' : 'missing'}">${ready ? 'READY' : 'NEEDS SETUP'}</div>
      <p class="muted">${escapeHtml(info.label)} · ${escapeHtml(info.mode)}</p>
    `;
    list.appendChild(card);
  });

  const historyList = $('history-list');
  if (!history.length) {
    historyList.innerHTML = '<p class="muted">עדיין אין פרסומים.</p>';
    return;
  }
  historyList.innerHTML = history
    .slice(0, 12)
    .map(
      (h) => `
      <div class="history-item">
        <span>${escapeHtml(h.title || h.id)}</span>
        <span class="muted">${escapeHtml((h.platforms || []).join(', '))} · ${escapeHtml(h.publishedAt || '')}</span>
      </div>`
    )
    .join('');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function approveCurrent() {
  if (!currentCampaign || !window.api) return;
  const payload = {
    ...currentCampaign,
    captionHe: $('caption-he').value,
    captionEn: $('caption-en').value,
    hashtags: $('post-hashtags').value,
    platforms: selectedPlatforms(),
  };
  const res = await window.api.approveAndPublish(payload);
  if (res.success) {
    setMessage($('action-message'), 'נרשם לפרסום (dry-run). מנהרת HTTPS + API יחוברו בשלב הבא.', 'ok');
    await loadApprovalQueue();
  } else {
    setMessage($('action-message'), res.error || 'פרסום נכשל', 'error');
  }
}

async function rejectCurrent() {
  if (!currentCampaign || !window.api) return;
  const ok = window.confirm('לדחות את הסרטון הנוכחי מתור האישורים?');
  if (!ok) return;
  await window.api.rejectCampaign(currentCampaign.id);
  setMessage($('action-message'), 'הסרטון נדחה.', 'ok');
  await loadApprovalQueue();
}

function wireEvents() {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab, btn));
  });

  $('btn-approve').addEventListener('click', approveCurrent);
  $('btn-reject').addEventListener('click', rejectCurrent);
  $('btn-mark-watched').addEventListener('click', markCurrentWatched);

  $('main-player').addEventListener('play', async () => {
    await markCurrentWatched();
  });

  // Unlock placeholder drafts (no media file) on player click
  $('main-player').addEventListener('click', async () => {
    if (!currentCampaign || currentCampaign.videoPath) return;
    await markCurrentWatched();
  });

  $('btn-pick').addEventListener('click', async () => {
    const file = await window.api.pickMedia();
    if (!file) return;
    selectedMediaPath = file;
    $('picked-file').textContent = file;
  });

  $('btn-create').addEventListener('click', async () => {
    const campaign = await window.api.createFromTemplate({
      templateId: $('template-select').value,
      title: $('campaign-title').value || undefined,
      sourceFile: selectedMediaPath || undefined,
    });
    setMessage($('create-message'), `נוסף לתור: ${campaign.title}`, 'ok');
    switchTab('approval-tab', document.querySelector('[data-tab="approval-tab"]'));
    await loadApprovalQueue();
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  wireEvents();
  if (!window.api) {
    $('engine-status').textContent = 'API לא זמין (הרץ ב-Electron)';
    return;
  }
  await loadApprovalQueue();
  await loadTemplates();
});
