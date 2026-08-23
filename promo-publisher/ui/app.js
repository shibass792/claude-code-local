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
    loadBackgroundIndex();
    fillReelTrackSelect();
  }
  if (tabId === 'player-tab') {
    loadMusicIndex();
  }
  if (tabId === 'career-tab') {
    loadCareerBoard();
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  const scan = window.api.scanFake ? await window.api.scanFake() : { findings: [], servers: [] };
  const grid = document.getElementById('connections-grid');
  grid.innerHTML = '';

  if (scan?.mcp) {
    const mcpCard = document.createElement('div');
    mcpCard.className = 'connection-card';
    const ready = scan.mcp.isDirectory && !scan.mcp.isFile;
    mcpCard.innerHTML = `
      <h3>Claude MCP</h3>
      <div class="connection-status">
        <div class="status-indicator ${ready ? 'online' : ''}" style="${ready ? '' : 'background:#ef4444'}"></div>
        <span>${ready ? 'תיקיית ~/.claude תקינה' : (scan.mcp.error || 'MCP לא מותקן')}</span>
      </div>
      <p class="muted">${escapeHtml(scan.mcp.path || '')}</p>
    `;
    grid.appendChild(mcpCard);
  }

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

let selectedBackgroundId = null;
let backgroundCatalog = [];

function backgroundUrl(image) {
  if (!image) {
    return '';
  }
  if (location.protocol === 'file:') {
    return `file://${String(image.path).replace(/\\/g, '/')}`;
  }
  return `/api/backgrounds/file/${image.id}`;
}

function renderBackgroundGrid() {
  const grid = document.getElementById('bg-grid');
  const status = document.getElementById('bg-index-status');
  if (!grid) {
    return;
  }
  grid.innerHTML = '';
  if (status) {
    status.textContent = backgroundCatalog.length
      ? `${backgroundCatalog.length} רקעים באינדקס`
      : 'אין אינדקס רקעים — לחץ סרוק רקעים';
  }
  backgroundCatalog.forEach((image) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = image.id === selectedBackgroundId ? 'bg-tile selected' : 'bg-tile';
    tile.innerHTML = `<img alt="" src="${escapeHtml(backgroundUrl(image))}"><span>${escapeHtml(image.name)}</span>`;
    tile.addEventListener('click', () => {
      selectedBackgroundId = image.id;
      renderBackgroundGrid();
    });
    grid.appendChild(tile);
  });
}

function fillReelTrackSelect() {
  const select = document.getElementById('reel-track-select');
  if (!select) {
    return;
  }
  const audioTracks = playlist.filter((track) => track.kind === 'audio');
  const currentId = currentTrack()?.id || select.value;
  select.innerHTML = '<option value="">בחר טראק מהספרייה</option>';
  audioTracks.forEach((track) => {
    const option = document.createElement('option');
    option.value = track.id;
    option.textContent = track.name;
    select.appendChild(option);
  });
  if (currentId && audioTracks.some((track) => track.id === currentId)) {
    select.value = currentId;
  }
}

async function loadBackgroundIndex() {
  if (!window.api?.getBackgrounds) {
    return;
  }
  const index = await window.api.getBackgrounds();
  backgroundCatalog = index.images ?? [];
  renderBackgroundGrid();
}

function selectedReelTrack() {
  const select = document.getElementById('reel-track-select');
  const fromSelect = playlist.find((track) => track.id === select?.value);
  return fromSelect || currentTrack() || playlist.find((item) => item.kind === 'audio') || null;
}

async function prepareApprovedReel() {
  const track = selectedReelTrack();
  if (!track || track.kind !== 'audio') {
    showToast('בחר טראק אודיו או סרוק את הספרייה');
    return;
  }
  const title = document.getElementById('reel-title')?.value.trim() || track.name;
  const hook = document.getElementById('reel-hook')?.value.trim();
  const durationSec = Number(document.getElementById('reel-duration')?.value) || 30;
  showToast('מכין ריל לתור אישור...');
  const result = await window.api.renderReel({
    audioPath: track.path,
    title,
    hook: hook || undefined,
    backgroundId: selectedBackgroundId || undefined,
    durationSec,
  });
  await refreshCreationLog();
  if (result?.success) {
    showToast('הריל מוכן בתור אישור — צפה ואז אשר');
    await loadApprovalQueue();
    switchTab('approval-tab');
    return;
  }
  showToast(result?.error ?? 'הרינדור נכשל');
}

async function renderDroppedFile(file) {
  showToast(`מרנדר ${file.name}...`);
  let result;
  if (file.path && window.api?.renderReel) {
    result = await window.api.renderReel({
      audioPath: file.path,
      title: file.name,
      backgroundId: selectedBackgroundId || undefined,
    });
  } else if (window.api?.uploadAndRender) {
    result = await window.api.uploadAndRender(file, {
      backgroundId: selectedBackgroundId || undefined,
    });
  } else {
    showToast('API רינדור לא זמין');
    return;
  }
  await refreshCreationLog();
  if (result?.success) {
    showToast('הריל מוכן בתור אישור — צפה ואז אשר');
    await loadApprovalQueue();
    switchTab('approval-tab');
  } else {
    showToast(result?.error ?? 'הרינדור נכשל');
  }
}

function renderLogText(payload) {
  const box = document.getElementById('creation-log');
  if (!box) {
    return;
  }
  const fakeBanner = /סימולטור בלבד|אין כאן קריאה אמיתית|InstaPy Pyt/;
  if (payload?.error && !payload.entries?.length) {
    box.textContent = payload.error;
    return;
  }
  if (fakeBanner.test(String(payload?.text ?? ''))) {
    box.textContent = 'זוהה לוג מזויף — Studio API האמיתי על 4052 לא מחובר. הרץ npm run api.';
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
  const box = document.getElementById('creation-log');
  try {
    if (!window.api?.getLog) {
      if (box) {
        box.textContent = 'Studio API לא מחובר — הרץ npm run api על פורט 4052';
      }
      return;
    }
    renderLogText(await window.api.getLog());
  } catch (error) {
    if (box) {
      box.textContent = `Studio API לא רץ על 4052 — ${error.message}`;
    }
  }
}

function renderEngineChips(status) {
  const host = document.getElementById('engine-chips');
  if (!host) {
    return;
  }
  const engines = status?.engines ?? {};
  host.innerHTML = Object.values(engines).map((engine) => {
    const ok = Boolean(engine?.available);
    return `<span class="engine-chip ${ok ? 'ok' : 'off'}">${escapeHtml(engine?.id || engine?.label || '?')} ${ok ? 'ON' : 'OFF'}</span>`;
  }).join('');
}

async function refreshDbStatus() {
  const label = document.getElementById('db-status');
  if (!label || !window.api?.getDbHealth) {
    return;
  }
  const health = await window.api.getDbHealth();
  if (!health?.ok) {
    label.textContent = health?.error || 'SQLite לא מותקן';
    return;
  }
  const catalog = health.counts?.catalog_items ?? 0;
  const logs = health.counts?.creation_log ?? 0;
  label.textContent = `SQL חי · ${catalog} פריטים בקטלוג · ${logs} שורות לוג · ${health.path}`;
}

async function refreshSystemStatus() {
  if (!window.api?.getEngines) {
    return;
  }
  const status = await window.api.getEngines();
  const label = document.querySelector('#system-status span');
  const dot = document.querySelector('#system-status .status-indicator');
  if (label && dot) {
    label.textContent = status.ok ? 'FFmpeg + Studio API + SQLite' : 'מנועים חסרים — ראה לוג';
    dot.classList.toggle('online', Boolean(status.ok));
  }
  renderEngineChips(status);
  await refreshDbStatus();
}

let playlist = [];
let playlistIndex = -1;
let catalogState = { items: [], folders: [], counts: {} };
let libraryFilter = 'all';
let libraryFolder = null;
let libraryQuery = '';

function currentTrack() {
  return playlist[playlistIndex] ?? null;
}

function visibleCatalogItems() {
  const query = libraryQuery.trim().toLowerCase();
  return (catalogState.items ?? []).filter((item) => {
    if (item.excluded) {
      return false;
    }
    if (libraryFilter !== 'all' && item.role !== libraryFilter) {
      return false;
    }
    if (libraryFolder && item.parent !== libraryFolder) {
      return false;
    }
    if (!query) {
      return true;
    }
    const hay = `${item.name} ${item.folder ?? ''} ${item.channelLabel ?? ''}`.toLowerCase();
    return hay.includes(query);
  });
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

function renderCatalogKpis() {
  const box = document.getElementById('catalog-kpis');
  if (!box) {
    return;
  }
  const counts = catalogState.counts ?? {};
  const cards = [
    ['קטעים', counts.tracks ?? 0],
    ['עטיפות', counts.covers ?? 0],
    ['ערוצים', counts.stems ?? 0],
    ['אפקטים', counts.effects ?? 0],
    ['תיקיות', counts.folders ?? 0],
    ['FM מוסתר', counts.excludedFm ?? 0],
  ];
  box.innerHTML = cards
    .map(([label, value]) => `<div class="kpi-card"><strong>${value}</strong><span>${label}</span></div>`)
    .join('');
}

function renderFolderTree() {
  const tree = document.getElementById('folder-tree');
  if (!tree) {
    return;
  }
  const folders = catalogState.folders ?? [];
  tree.innerHTML = '';
  const all = document.createElement('button');
  all.type = 'button';
  all.className = libraryFolder ? 'folder-item' : 'folder-item active';
  all.textContent = 'כל התיקיות';
  all.addEventListener('click', () => {
    libraryFolder = null;
    renderLibrary();
  });
  tree.appendChild(all);
  folders.forEach((folder) => {
    const total = Object.values(folder.counts ?? {}).reduce((sum, value) => sum + Number(value || 0), 0);
    if (!total) {
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = libraryFolder === folder.path ? 'folder-item active' : 'folder-item';
    button.textContent = `${folder.name} (${total})`;
    button.addEventListener('click', () => {
      libraryFolder = folder.path;
      renderLibrary();
    });
    tree.appendChild(button);
  });
}

function renderLibraryCovers(items) {
  const grid = document.getElementById('library-cover-grid');
  if (!grid) {
    return;
  }
  const covers = items.filter((item) => item.role === 'covers');
  grid.innerHTML = '';
  grid.classList.toggle('hidden', covers.length === 0);
  covers.forEach((image) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = image.id === selectedBackgroundId ? 'bg-tile selected' : 'bg-tile';
    tile.innerHTML = `<img alt="" src="${escapeHtml(backgroundUrl(image))}"><span>${escapeHtml(image.name)}</span>`;
    tile.addEventListener('click', () => {
      selectedBackgroundId = image.id;
      showToast('עטיפה נבחרה כרקע — עדיין לא פורסם כלום');
      renderLibrary();
    });
    grid.appendChild(tile);
  });
}

function renderTrackList() {
  const list = document.getElementById('track-list');
  const status = document.getElementById('player-index-status');
  if (!list) {
    return;
  }
  const visible = visibleCatalogItems();
  const audioItems = visible.filter((item) => item.media === 'audio' || item.kind === 'audio' || item.kind === 'midi');
  playlist = audioItems;
  if (playlistIndex >= playlist.length) {
    playlistIndex = playlist.length ? 0 : -1;
  }
  list.innerHTML = '';
  const counts = catalogState.counts ?? {};
  if (status) {
    status.textContent = catalogState.items?.length
      ? `${counts.tracks ?? 0} קטעים · ${counts.covers ?? 0} עטיפות · ${counts.stems ?? 0} ערוצים · ${counts.effects ?? 0} אפקטים · ${counts.excludedFm ?? 0} FM מוסתר`
      : 'אין קטלוג — לחץ סרוק הכל. FM מוסתר. כלום לא עולה לרשת עד שתראה תוצאה ותאשר.';
  }
  if (!visible.length) {
    const empty = document.createElement('li');
    empty.textContent = 'אין פריטים בסינון הזה';
    list.appendChild(empty);
    return;
  }
  visible.forEach((item) => {
    if (item.role === 'covers') {
      return;
    }
    const index = playlist.findIndex((track) => track.id === item.id);
    const row = document.createElement('li');
    row.className = index === playlistIndex ? 'active' : '';
    const icon = item.kind === 'midi' ? '🎹' : item.role === 'effects' ? '✨' : item.role === 'stems' ? '🎚️' : '🎵';
    row.innerHTML = `<span>${icon} ${escapeHtml(item.name)}</span><small>${escapeHtml(item.roleLabel || '')} · ${escapeHtml(item.folder || '')}</small>`;
    row.addEventListener('click', () => {
      if (index >= 0) {
        playAt(index);
      }
      const title = document.getElementById('reel-title');
      if (title && !title.value) {
        title.value = item.name;
      }
    });
    list.appendChild(row);
  });
}

function renderLibrary() {
  renderCatalogKpis();
  renderFolderTree();
  renderLibraryCovers(visibleCatalogItems());
  renderTrackList();
  fillReelTrackSelect();
}

async function loadMusicIndex() {
  if (window.api?.getCatalog) {
    catalogState = await window.api.getCatalog();
    renderLibrary();
    return;
  }
  if (!window.api?.getMusicIndex) {
    return;
  }
  const index = await window.api.getMusicIndex();
  catalogState = {
    items: (index.tracks ?? []).map((track) => ({ ...track, media: track.kind, role: 'tracks', roleLabel: 'קטעים' })),
    folders: [],
    counts: { tracks: index.tracks?.length ?? 0 },
  };
  renderLibrary();
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
    renderLibrary();
    return;
  }
  playlistIndex = index;
  audio.src = streamUrl(track);
  audio.play().catch((error) => showToast(error.message));
  document.getElementById('now-playing').textContent = track.name;
  renderLibrary();
}

function setupPlayerControls() {
  const audio = document.getElementById('universal-audio');
  if (!audio) {
    return;
  }
  document.getElementById('btn-scan-music')?.addEventListener('click', async () => {
    showToast('סורק קטעים, עטיפות, ערוצים ואפקטים...');
    if (window.api.scanCatalog) {
      catalogState = await window.api.scanCatalog({});
      renderLibrary();
    } else {
      await window.api.scanMusic({});
      await loadMusicIndex();
    }
    await loadBackgroundIndex();
    await refreshCreationLog();
    showToast('הסריקה מוכנה לצפייה — עדיין לא פורסם כלום');
  });
  document.getElementById('btn-library-reel')?.addEventListener('click', () => prepareApprovedReel());
  document.getElementById('library-search')?.addEventListener('input', (event) => {
    libraryQuery = event.target.value ?? '';
    renderLibrary();
  });
  document.getElementById('library-filters')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) {
      return;
    }
    libraryFilter = button.getAttribute('data-filter') || 'all';
    document.querySelectorAll('#library-filters .chip').forEach((chip) => {
      chip.classList.toggle('active', chip === button);
    });
    renderLibrary();
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

function linkLabel(key) {
  const labels = {
    instagram: 'IG',
    spotify: 'Spotify',
    youtube: 'YT',
    soundcloud: 'SC',
    beatport: 'Beatport',
    booking: 'Booking',
    site: 'Site',
    label: 'Label',
    polyverse: 'Polyverse',
    unvrs: 'UNVRS',
  };
  return labels[key] ?? key;
}

function renderCareerBoard(board) {
  document.getElementById('career-title').textContent = board.title;
  document.getElementById('career-subtitle').textContent = `${board.subtitle} · עודכן ${board.updatedAt}`;

  const kpis = document.getElementById('career-kpis');
  kpis.innerHTML = board.kpis.map((kpi) => `
    <article class="kpi-card">
      <strong>${escapeHtml(kpi.value)}</strong>
      <span>${escapeHtml(kpi.label)}</span>
      <small>${escapeHtml(kpi.note)}</small>
    </article>
  `).join('');

  document.getElementById('career-sprint-title').textContent = board.sprint?.title ?? '';
  const sprint = document.getElementById('career-sprint');
  sprint.innerHTML = (board.sprint?.weeks ?? []).map((week) => `
    <article class="sprint-card">
      <h3>${escapeHtml(week.title)}</h3>
      ${(week.days ?? []).map((day) => `
        <div class="sprint-day">
          <strong>${escapeHtml(day.title)}</strong>
          <ul>${day.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        </div>
      `).join('')}
    </article>
  `).join('');

  const pack = board.pack ?? {};
  document.getElementById('career-pack-summary').textContent = pack.next ?? '';
  const packBox = document.getElementById('career-pack');
  packBox.innerHTML = `
    <article class="pack-card">
      <h3>3 שלדים</h3>
      <ul>${(pack.skeletons ?? []).map((row) => `<li>${escapeHtml(row.id)} · ${escapeHtml(row.title || `${row.bpm} ${row.key}`)}</li>`).join('')}</ul>
    </article>
    <article class="pack-card">
      <h3>MIDI</h3>
      <p>${escapeHtml(String(pack.midiCount ?? 0))} קבצים · 40 מובילים + 12 שלד</p>
      <p class="muted">${pack.ready ? escapeHtml(pack.relativeZip ?? '') : 'עדיין לא נוצר ZIP'}</p>
    </article>
    <article class="pack-card">
      <h3>10 פריסטים לייצוא</h3>
      <ol>${(pack.presets ?? []).map((row) => `<li>${escapeHtml(row.name)} (${escapeHtml(row.synth)})</li>`).join('')}</ol>
    </article>
  `;

  document.getElementById('career-organic-summary').textContent =
    `${board.organic.readyCount}/${board.organic.total} כלים מוכנים במחשב · ${board.organic.tracks} טראקים באינדקס · ${board.organic.pendingRenders} רילס בתור אישור`;

  const organic = document.getElementById('career-organic');
  organic.innerHTML = board.organic.tools.map((tool) => `
    <article class="organic-card ${tool.ready ? 'ready' : 'blocked'}">
      <span class="tool-badge ${tool.ready ? 'ok' : ''}">${tool.ready ? 'מוכן במחשב' : 'חסר / מוגבל'}</span>
      <h3>${escapeHtml(tool.title)}</h3>
      <p class="muted">${escapeHtml(tool.how)}</p>
      <p>${escapeHtml(tool.next)}</p>
      <button class="btn btn-secondary" type="button" data-career-action="${escapeHtml(tool.action)}" data-career-tab="${escapeHtml(tool.tab)}">הרץ</button>
    </article>
  `).join('');

  const ladder = document.getElementById('career-ladder');
  ladder.innerHTML = board.ladder.map((row) => `
    <div class="ladder-row ${row.highlight ? 'me' : ''}">
      <div class="ladder-name">${escapeHtml(row.name)}</div>
      <div class="ladder-bars">
        <div class="bar-track"><div class="bar-fill ig ${row.highlight ? 'me' : ''}" style="width:${row.instagramBar}%"></div></div>
        <div class="ladder-meta">IG ${escapeHtml(row.instagramLabel)} · Spotify ${escapeHtml(row.spotifyLabel)}</div>
        <div class="bar-track"><div class="bar-fill spotify" style="width:${row.spotifyBar}%"></div></div>
      </div>
    </div>
  `).join('');

  const artists = document.getElementById('career-artists');
  artists.innerHTML = board.artists.map((artist) => {
    const links = Object.entries(artist.links ?? {})
      .map(([key, href]) => `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(linkLabel(key))}</a>`)
      .join('');
    return `
      <article class="artist-card">
        <h3>${escapeHtml(artist.name)}</h3>
        <p class="muted">${escapeHtml(artist.layer)}${artist.instagramFollowers ? ` · ${escapeHtml(String(artist.instagramFollowers))} IG` : ''}${artist.spotifyMonthly ? ` · ${escapeHtml(String(artist.spotifyMonthly))} Spotify` : ''}</p>
        <p><strong>המסלול</strong> ${escapeHtml(artist.path)}</p>
        <p><strong>הכסף</strong> ${escapeHtml(artist.money)}</p>
        ${artist.moneyVerified ? '' : '<p class="unverified">לא אומת</p>'}
        <p><strong>הקידום</strong> ${escapeHtml(artist.promo)}</p>
        <p><strong>למה לעקוב</strong> ${escapeHtml(artist.why)}</p>
        <div class="artist-links">${links}</div>
      </article>
    `;
  }).join('');

  document.getElementById('career-patterns').innerHTML = board.patterns.map((pattern) => `
    <article class="pattern-card">
      <h3>${escapeHtml(pattern.title)}</h3>
      <p class="muted">${escapeHtml(pattern.body)}</p>
    </article>
  `).join('');

  document.getElementById('career-agencies').innerHTML = board.agencies.map((agency) => `
    <article class="agency-card">
      <h3>${escapeHtml(agency.name)}</h3>
      <p>${escapeHtml(agency.detail)}</p>
      ${agency.contact ? `<p class="muted" dir="ltr">${escapeHtml(agency.contact)}</p>` : ''}
    </article>
  `).join('');

  document.getElementById('career-stages').innerHTML = board.stages.map((stage) => `
    <article class="stage-card">
      <h3>${escapeHtml(stage.title)}</h3>
      <p class="muted">${escapeHtml(stage.subtitle)}</p>
      <ul>${stage.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      <p><strong>מדד:</strong> ${escapeHtml(stage.metric)}</p>
    </article>
  `).join('');

  document.getElementById('career-wave-note').textContent = board.wave1.note;
  document.getElementById('career-wave-body').innerHTML = board.wave1.campaigns.map((row) => `
    <tr>
      <td>${escapeHtml(row.id)}</td>
      <td>${escapeHtml(row.creative)}</td>
      <td>${escapeHtml(row.audience)}</td>
      <td>₪${escapeHtml(String(row.dailyIls))}/יום</td>
      <td class="badge-mock">${escapeHtml(row.status)}</td>
    </tr>
  `).join('');
  document.getElementById('career-sources').textContent = `מקורות: ${board.sources.join(', ')}`;

  organic.querySelectorAll('[data-career-action]').forEach((button) => {
    button.addEventListener('click', () => runCareerAction(button.dataset.careerAction, button.dataset.careerTab));
  });
}

async function loadCareerBoard() {
  if (!window.api?.getCareer) {
    return;
  }
  const board = await window.api.getCareer();
  renderCareerBoard(board);
}

async function runCareerAction(action, tabId) {
  if (action === 'scan-music') {
    showToast('סורק ספריית מוזיקה...');
    await window.api.scanMusic({});
    await loadMusicIndex();
    await loadCareerBoard();
    showToast('הסריקה הושלמה — זה הקטלוג האורגני');
    switchTab('player-tab');
    return;
  }
  if (action === 'hooks') {
    const track = currentTrack();
    const result = await window.api.generateHooks({
      title: track?.name || 'ShiBass Progressive Psytrance',
      bpm: 142,
    });
    showToast(result.success ? `${result.hooks.length} הוקים מ-${result.engine}` : result.error);
    switchTab('create-tab');
    await refreshCreationLog();
    return;
  }
  if (action === 'radar') {
    if (window.api.scanRadar) {
      await window.api.scanRadar();
    }
    switchTab('radar-tab');
    return;
  }
  if (action === 'pack') {
    await generateStudioPack();
    return;
  }
  if (action === 'epk') {
    await writeStudioEpk();
    return;
  }
  if (tabId) {
    switchTab(tabId);
  }
}

function epkLinksFromForm() {
  return {
    setLink: document.getElementById('epk-link-set')?.value.trim() || undefined,
    audixLink: document.getElementById('epk-link-audix')?.value.trim() || undefined,
    packLink: document.getElementById('epk-link-pack')?.value.trim() || undefined,
  };
}

function showEpkEmails(result) {
  const he = result?.emails?.he;
  const en = result?.emails?.en;
  if (he) {
    document.getElementById('epk-he-body').textContent = `נושא: ${he.subject}\n\n${he.body}`;
  }
  if (en) {
    document.getElementById('epk-en-body').textContent = `Subject: ${en.subject}\n\n${en.body}`;
  }
}

async function writeStudioEpk() {
  const result = await window.api.writeEpk({ links: epkLinksFromForm() });
  showEpkEmails(result);
  showToast(result.success ? `EPK נכתב ל-${result.relativePath}` : result.error);
  await refreshCreationLog();
  await loadCareerBoard();
}

async function generateStudioPack() {
  showToast('psy_pack_v3 רץ — 3 שלדים + 40 MIDI...');
  const result = await window.api.generatePack();
  showToast(result.success ? `${result.midiCount} MIDI → ${result.relativeZip}` : result.error);
  await refreshCreationLog();
  await loadCareerBoard();
}

async function copyPre(id) {
  const text = document.getElementById(id)?.textContent ?? '';
  await navigator.clipboard.writeText(text);
  showToast('הועתק ללוח');
}

function setupCareerActions() {
  document.getElementById('btn-refresh-career')?.addEventListener('click', async () => {
    await window.api.getEngines();
    await loadCareerBoard();
    await refreshSystemStatus();
    showToast('פאנל הקריירה עודכן מהמנועים המקומיים');
  });
  document.getElementById('btn-generate-pack')?.addEventListener('click', () => generateStudioPack());
  document.getElementById('btn-write-epk')?.addEventListener('click', () => writeStudioEpk());
  document.getElementById('btn-copy-epk-he')?.addEventListener('click', () => copyPre('epk-he-body'));
  document.getElementById('btn-copy-epk-en')?.addEventListener('click', () => copyPre('epk-en-body'));
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
      backgroundId: selectedBackgroundId || undefined,
    });
    await refreshCreationLog();
    if (result.success) {
      showToast('הריל מוכן בתור אישור — צפה ואז אשר');
      await loadApprovalQueue();
      switchTab('approval-tab');
    } else {
      showToast(result.error ?? 'הרינדור נכשל');
    }
  });
  document.getElementById('btn-scan-backgrounds')?.addEventListener('click', async () => {
    showToast('סורק רקעים מהמחשב...');
    await window.api.scanBackgrounds({});
    await loadBackgroundIndex();
    await refreshCreationLog();
    showToast(backgroundCatalog.length ? `${backgroundCatalog.length} רקעים נמצאו` : 'לא נמצאו רקעים בתיקיות הידועות');
  });
  document.getElementById('btn-prepare-reel')?.addEventListener('click', () => prepareApprovedReel());
  document.getElementById('bg-file')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file || !window.api?.uploadBackground) {
      return;
    }
    const result = await window.api.uploadBackground(file);
    await loadBackgroundIndex();
    if (result?.success && result.image?.id) {
      selectedBackgroundId = result.image.id;
      renderBackgroundGrid();
      showToast('הרקע נשמר — עדיין לא פורסם כלום');
    } else {
      showToast(result?.error ?? 'העלאת הרקע נכשלה');
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
  setupCareerActions();
  loadApprovalQueue();
  refreshSystemStatus();
  refreshCreationLog();
  loadMusicIndex().then(() => fillReelTrackSelect());
  loadBackgroundIndex();
});
