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
  if (tabId === 'sprint-tab') {
    loadSprint();
  }
  if (tabId === 'ladder-tab') {
    loadLadder();
  }
  if (tabId === 'ops-tab') {
    loadOps();
  }
  if (tabId === 'ads-tab') {
    loadWave1();
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

const playerState = { items: [], index: -1, sequential: true };

function toFileUrl(absPath) {
  if (!absPath) return null;
  const p = String(absPath).replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(p)) return `file:///${p}`;
  if (p.startsWith('/')) return `file://${p}`;
  return `file:///${p}`;
}

function studioStream(item) {
  if (item?.id) {
    return `http://127.0.0.1:4051/api/media/stream?id=${encodeURIComponent(item.id)}`;
  }
  if (item?.path) {
    return `http://127.0.0.1:4051/api/media/stream?path=${encodeURIComponent(item.path)}`;
  }
  return null;
}

async function playLibraryItem(item, index) {
  if (!item) return;
  playerState.index = index;
  const now = document.getElementById('player-now');
  const audio = document.getElementById('library-audio');
  if (now) now.textContent = `${item.name} · ${item.kind}`;
  const create = document.getElementById('create-audio');
  if (create) create.value = item.path || '';
  if (item.kind !== 'audio') {
    showToast('MIDI/DAW באינדקס — נגן אודיו דורש WAV/MP3');
    return;
  }
  const stream = studioStream(item);
  const fileUrl = toFileUrl(item.path);
  const vol = document.getElementById('player-volume');
  if (vol) audio.volume = Number(vol.value) / 100;
  audio.src = stream || fileUrl;
  try {
    await audio.play();
  } catch (err) {
    if (fileUrl && !String(audio.src || '').startsWith('file:')) {
      audio.src = fileUrl;
      try {
        await audio.play();
      } catch (err2) {
        showToast(`נגן: ${err2.message}`);
      }
      return;
    }
    showToast(`נגן: ${err.message}`);
  }
}

async function refreshPlayerLibrary() {
  if (!window.api?.getLibrary) return;
  const data = await window.api.getLibrary({ limit: 400 });
  playerState.items = data.items || [];
  const status = document.getElementById('player-index-status');
  if (status) {
    status.textContent = data.hasIndex
      ? `אינדקס חי · ${data.counts?.total || 0} קבצים · ${data.scannedAt}`
      : '⚠️ אין אינדקס מוזיקה — הרץ סריקה';
  }
  const list = document.getElementById('player-list');
  if (!list) return;
  list.innerHTML = '';
  playerState.items.forEach((item, i) => {
    const li = document.createElement('li');
    li.textContent = `${item.name} · ${item.kind}`;
    if (i === playerState.index) li.classList.add('active');
    li.addEventListener('click', () => playLibraryItem(item, i));
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

  document.getElementById('btn-media-play')?.addEventListener('click', async () => {
    const current = playerState.items[playerState.index];
    if (current) {
      await playLibraryItem(current, playerState.index);
      return;
    }
    const audioItem = playerState.items.find((x) => x.kind === 'audio');
    if (!audioItem) {
      showToast('אין אודיו באינדקס — סרוק מדיה');
      return;
    }
    await playLibraryItem(audioItem, playerState.items.indexOf(audioItem));
  });

  document.getElementById('btn-media-stop')?.addEventListener('click', () => {
    const audio = document.getElementById('library-audio');
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    const now = document.getElementById('player-now');
    if (now) now.textContent = 'עצור';
    const t = document.getElementById('player-time');
    if (t) t.textContent = '00:00 / 00:00';
  });

  document.getElementById('btn-media-fwd')?.addEventListener('click', () => {
    const audio = document.getElementById('library-audio');
    if (Number.isFinite(audio.duration)) {
      audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
    }
  });

  document.getElementById('btn-media-prev')?.addEventListener('click', () => playRelative(-1));
  document.getElementById('btn-media-next')?.addEventListener('click', () => playRelative(1));

  document.getElementById('btn-media-seq')?.addEventListener('click', (e) => {
    playerState.sequential = !playerState.sequential;
    e.currentTarget.dataset.on = playerState.sequential ? '1' : '0';
    e.currentTarget.textContent = playerState.sequential ? '🔁 ברצף: פעיל' : '🔁 ברצף: כבוי';
  });

  document.getElementById('player-volume')?.addEventListener('input', (e) => {
    const audio = document.getElementById('library-audio');
    audio.volume = Number(e.target.value) / 100;
    const lab = document.getElementById('player-vol-label');
    if (lab) lab.textContent = `${e.target.value}%`;
  });

  const libraryAudio = document.getElementById('library-audio');
  libraryAudio?.addEventListener('timeupdate', () => {
    const t = document.getElementById('player-time');
    if (!t) return;
    t.textContent = `${fmtTime(libraryAudio.currentTime)} / ${fmtTime(libraryAudio.duration)}`;
  });
  libraryAudio?.addEventListener('ended', () => {
    if (playerState.sequential) playRelative(1);
  });
}

function fmtTime(sec) {
  if (!Number.isFinite(sec)) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function playRelative(delta) {
  const list = playerState.items.filter((x) => x.kind === 'audio');
  if (!list.length) {
    showToast('אין אודיו באינדקס');
    return;
  }
  const current = playerState.items[playerState.index];
  let i = list.findIndex((x) => x.id === current?.id);
  if (i < 0) i = 0;
  else i = (i + delta + list.length) % list.length;
  const item = list[i];
  await playLibraryItem(item, playerState.items.findIndex((x) => x.id === item.id));
}

async function loadSprint() {
  if (!window.api?.getSprint) return;
  const s = await window.api.getSprint();
  const meta = document.getElementById('sprint-meta');
  if (meta) meta.textContent = `${s.start} → ${s.end} · ${s.completed}/${s.total} (${s.pct}%) · ${s.progressPath}`;
  const bar = document.getElementById('sprint-bar');
  if (bar) bar.style.width = `${s.pct || 0}%`;
  const goals = document.getElementById('sprint-goals');
  if (goals && s.goals) {
    goals.textContent = `TRACK  ${s.goals.track}\nPACK   ${s.goals.pack}\nADS    ${s.goals.marketing}`;
  }
  const list = document.getElementById('sprint-list');
  if (!list) return;
  list.innerHTML = '';
  (s.cells || []).forEach((cell) => {
    const li = document.createElement('li');
    li.className = cell.done ? 'done' : '';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = cell.done;
    box.addEventListener('change', async () => {
      await window.api.toggleSprint({ id: cell.id, done: box.checked });
      await loadSprint();
    });
    const span = document.createElement('span');
    span.textContent = ` D${cell.day} · ${cell.lane} · ${cell.title}`;
    li.appendChild(box);
    li.appendChild(span);
    list.appendChild(li);
  });
}

function formatK(n) {
  if (n == null) return 'לא נמדד';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

async function loadLadder() {
  if (!window.api?.getLadder) return;
  const data = await window.api.getLadder();
  const self = data.self || {};
  const selfEl = document.getElementById('ladder-self');
  if (selfEl) {
    selfEl.textContent = `${self.artist} · IG ${self.instagram?.followersLabel || ''} (${self.instagram?.engagementPct}% HypeAuditor) · ספוטיפיי: ${self.spotifyMonthly?.label || 'לא נמדד'} · השלב הבא: ${data.nextRung?.igFollowers || ''}`;
  }
  const body = document.getElementById('ladder-body');
  if (body) {
    body.innerHTML = '';
    (data.rungs || []).forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.name}</td><td>${r.tier}</td><td>${formatK(r.instagram)}</td><td>${formatK(r.spotifyMonthly)}</td><td>${r.why || ''}</td>`;
      body.appendChild(tr);
    });
  }
  const stages = document.getElementById('ladder-stages');
  if (stages) {
    stages.innerHTML = (data.stages || []).map((st) =>
      `<article class="stage-card"><strong>${st.when}</strong><p>${st.focus} — ${st.metric}</p></article>`
    ).join('');
  }
  const booking = document.getElementById('ladder-booking');
  if (booking) {
    booking.innerHTML = (data.booking || []).map((b) =>
      `<li>${b.name}${b.email ? ` · ${b.email}` : ''} — ${b.note || ''}</li>`
    ).join('');
  }
}

async function loadOps() {
  if (!window.api?.probeOps) return;
  const report = await window.api.probeOps();
  const log = document.getElementById('ops-log');
  if (log) log.textContent = report.log || report.summary;
  const body = document.getElementById('ops-body');
  if (!body) return;
  body.innerHTML = '';
  (report.services || []).forEach((s) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${s.port}</td><td>${s.name}</td><td class="${s.online ? 'badge-ok' : 'badge-fail'}">${s.online ? 'ONLINE' : 'OFFLINE'}</td><td>${s.online ? `HTTP ${s.statusCode}` : (s.error || 'no listener')}</td>`;
    body.appendChild(tr);
  });
}

function renderWaveRows(campaigns) {
  const body = document.getElementById('ads-body');
  if (!body) return;
  body.innerHTML = '';
  (campaigns || []).forEach((c) => {
    const tr = document.createElement('tr');
    const decision = c.action ? `${c.action} · ${c.reason || ''}` : c.status;
    tr.innerHTML = `<td>${c.code}</td><td>${c.creative}</td><td>${c.audience}</td><td dir="ltr">${c.id}</td><td>${c.status}</td><td>${decision}</td>`;
    body.appendChild(tr);
  });
}

async function loadWave1() {
  if (!window.api?.getWave1) return;
  const wave = await window.api.getWave1();
  renderWaveRows(wave.campaigns);
}

function setupSprintDesk() {
  document.getElementById('btn-psy-50')?.addEventListener('click', async () => {
    const r = await window.api.generatePsy({ count: 50, root: 'E' });
    showToast(r.success ? `${r.count} MIDI · ${r.date} · ${r.scale}` : r.error);
  });
  document.getElementById('btn-pack-build')?.addEventListener('click', async () => {
    const r = await window.api.buildPack({ count: 50 });
    showToast(r.success ? `Pack ${r.midiCount} · ${r.zipPath}` : r.error);
  });
  document.getElementById('btn-epk-build')?.addEventListener('click', async () => {
    const r = await window.api.buildEpk({});
    showToast(r.success ? `EPK → ${r.emailPath}` : r.error);
  });
  document.getElementById('btn-ops-probe')?.addEventListener('click', () => loadOps());
  document.getElementById('btn-quality-scan')?.addEventListener('click', async () => {
    const pre = document.getElementById('quality-log') || document.getElementById('ops-log');
    if (pre) pre.textContent = 'סורק קבצים אמיתיים במחשב (node --check / py_compile)…';
    try {
      const r = window.api?.scanQuality
        ? await window.api.scanQuality()
        : await fetch('http://127.0.0.1:4051/api/quality').then((x) => x.json());
      if (pre) pre.textContent = r.log || JSON.stringify(r, null, 2);
    } catch (e) {
      if (pre) pre.textContent = `שגיאה: ${e.message}`;
    }
  });
  document.getElementById('btn-ads-csv')?.addEventListener('click', async () => {
    const report = await window.api.pickAdsCsv();
    if (report.canceled) return;
    const v = document.getElementById('ads-verdict');
    if (v) {
      v.textContent = `KEEP ${report.keep?.length || 0} · KILL ${report.kill?.length || 0} · UNKNOWN ${report.unknown?.length || 0} — שאול מכבה ב-Ads Manager`;
    }
    renderWaveRows(report.campaigns);
  });
}

window.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupActions();
  setupPlayerWatchGate();
  setupDropZone();
  setupLiveApis();
  setupSprintDesk();
  loadApprovalQueue();
});
