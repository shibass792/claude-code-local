let currentCampaign = null;
let hasWatchedCurrent = false;
let selectedAudioPath = null;
let lastProbe = null;
let renderStyles = {};

const player = document.getElementById('main-player');
const publishBtn = document.getElementById('btn-publish');
const watchHint = document.getElementById('watch-hint');
const logBody = document.getElementById('log-body');

const LOG_LIMIT = 400;
const logLines = [];

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3600);
}

/** Append one real engine event to the live console. */
function appendLog(line) {
  const stamp = new Date(line.at ?? Date.now()).toLocaleTimeString('he-IL');
  const tag = String(line.level ?? 'info').toUpperCase();
  logLines.push(`[${stamp}] [${tag}] ${line.message}`);
  if (logLines.length > LOG_LIMIT) {
    logLines.splice(0, logLines.length - LOG_LIMIT);
  }
  logBody.textContent = logLines.join('\n');
  logBody.scrollTop = logBody.scrollHeight;
}

function logLocal(level, message) {
  appendLog({ at: new Date().toISOString(), level, message });
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(2)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
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
  if (tabId === 'library-tab') loadLibraryStatus();
}

function updatePublishButtonState() {
  const canPublish = Boolean(currentCampaign) && hasWatchedCurrent;
  publishBtn.disabled = !canPublish;
  watchHint.textContent = canPublish
    ? '✅ צפית בסרטון — ניתן לפרסם'
    : '▶ לחץ Play כדי לאפשר פרסום';
}

/** Build the track context the model needs, from the real campaign data. */
function currentTrackContext() {
  return {
    title: currentCampaign?.title ?? lastProbe?.title ?? lastProbe?.fileName ?? '',
    bpm: currentCampaign?.source?.bpm ?? lastProbe?.bpm ?? null,
    styleHint: currentCampaign?.style ?? null,
  };
}

async function loadApprovalQueue() {
  if (!window.api) return;

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
  document.getElementById('video-duration').textContent =
    `${currentCampaign.duration} | ${currentCampaign.format}`;
  document.getElementById('caption-he').value = currentCampaign.captionHe ?? '';
  document.getElementById('caption-en').value = currentCampaign.captionEn ?? '';
  document.getElementById('post-hashtags').value = currentCampaign.hashtags ?? '';

  const renderMeta = document.getElementById('render-meta');
  if (currentCampaign.render) {
    renderMeta.textContent =
      `רונדר ב-${currentCampaign.render.encoder} · ${formatBytes(currentCampaign.render.sizeBytes)} · ` +
      `${currentCampaign.render.renderMs}ms` +
      (currentCampaign.ai ? ` · כיתובים: ${currentCampaign.ai.model}` : '');
  } else {
    renderMeta.textContent = '';
  }

  if (currentCampaign.aiError) {
    logLocal('warn', `הקמפיין נוצר בלי כיתובי AI: ${currentCampaign.aiError}`);
  }

  renderHookList(currentCampaign.hookOptions ?? []);

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

function renderHookList(hooks) {
  const container = document.getElementById('hook-list');
  container.innerHTML = '';

  if (!hooks.length) {
    container.innerHTML =
      '<p class="muted small">לחץ "הפק 3 הוקים" — הבקשה נשלחת למודל המקומי בזמן אמת</p>';
    return;
  }

  hooks.forEach((hook, index) => {
    const item = document.createElement('div');
    item.className = 'hook-item';
    item.innerHTML = `
      <div class="hook-text">
        <strong>${index + 1}. ${hook.he || hook.en}</strong>
        ${hook.en && hook.he ? `<span class="muted small" dir="ltr">${hook.en}</span>` : ''}
        ${hook.why ? `<span class="muted small">${hook.why}</span>` : ''}
      </div>
      <button class="btn btn-small btn-secondary" type="button">השתמש</button>
    `;
    item.querySelector('button').addEventListener('click', () => {
      document.getElementById('caption-he').value = hook.he || hook.en;
      if (hook.en) document.getElementById('caption-en').value = hook.en;
      showToast('ההוק הוחל על הכיתוב');
    });
    container.appendChild(item);
  });
}

/** Reading a cached feed still hits disk/IPC, so never leave the pane blank. */
function showLoading(container, message) {
  container.innerHTML = `<p class="loading-note">${message}</p>`;
}

async function loadRadarData() {
  if (!window.api) return;

  const container = document.getElementById('radar-list');
  const banner = document.getElementById('radar-source');
  showLoading(container, 'טוען נתוני רדאר…');

  const feed = await window.api.getRadarFeed();
  const trends = feed?.viral ?? (await window.api.getTrends()) ?? [];
  container.innerHTML = '';

  if (feed) {
    const labels = { live: '🟢 נתונים חיים', sample: '🟡 פיד דוגמה', none: '🔴 אין נתונים' };
    banner.className = `source-banner source-${feed.source}`;
    banner.classList.remove('hidden');
    banner.innerHTML = `
      <strong>${labels[feed.source] ?? feed.source}</strong>
      <span class="muted small">נסרק: ${new Date(feed.scannedAt).toLocaleString('he-IL')}</span>
      ${feed.warning ? `<span class="warn-text">${feed.warning}</span>` : ''}
      ${
        feed.errors?.length
          ? `<details><summary class="muted small">שגיאות מקור (${feed.errors.length})</summary>
             <ul class="error-list">${feed.errors
               .map((e) => `<li>${e.artist}: ${String(e.error).slice(0, 200)}</li>`)
               .join('')}</ul></details>`
          : ''
      }
    `;
  } else {
    banner.classList.add('hidden');
  }

  if (!trends.length) {
    container.innerHTML = '<p class="muted">לא נמצאו פוסטים ויראליים — לחץ "סרוק מחדש"</p>';
    return;
  }

  trends.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'radar-card';
    card.innerHTML = `
      <div class="radar-badge">🔥 חריגה: ${item.outlierLabel} (${Number(item.views).toLocaleString()} צפיות)</div>
      <h3>${item.artist}</h3>
      <p><strong>💡 הוק:</strong> "${item.hookText}"</p>
      <p class="muted">🎨 סגנון: ${item.style} · חציון: ${Number(item.avgViews).toLocaleString()}</p>
      ${item.keyStrategy ? `<p class="strategy-box">📌 ${item.keyStrategy}</p>` : ''}
      <div class="radar-card-actions">
        ${item.url ? `<button class="btn btn-small btn-secondary" data-open="${item.url}" type="button">פתח פוסט</button>` : ''}
        <button class="btn btn-small btn-primary" data-template="${item.id}" type="button">✨ השתמש כהשראה</button>
      </div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll('[data-template]').forEach((button) => {
    button.addEventListener('click', () => useTemplate(button.getAttribute('data-template')));
  });
  container.querySelectorAll('[data-open]').forEach((button) => {
    button.addEventListener('click', () => window.api.openExternal(button.getAttribute('data-open')));
  });
}

/**
 * Use a real competitor post as grounding and ask the model for our own hook.
 */
async function useTemplate(templateId) {
  if (!window.api) return;

  const template = await window.api.getTemplate(templateId);
  if (!template) {
    showToast('תבנית לא נמצאה');
    return;
  }

  switchTab('approval-tab');
  showToast('מפיק הוק בהשראת הפוסט…');

  const result = await window.api.generateHooks({
    track: currentTrackContext(),
    trends: [template],
    count: 3,
  });

  if (!result.success) {
    showToast(`המודל לא זמין: ${result.error}`);
    return;
  }

  renderHookList(result.hooks);
  showToast(`הופקו ${result.hooks.length} הוקים מ-${result.model}`);
}

async function loadHistory() {
  if (!window.api) return;

  const history = await window.api.getPublishHistory();
  const body = document.getElementById('history-body');
  body.innerHTML = '';

  if (!history?.length) {
    body.innerHTML = '<tr><td colspan="5">אין פרסומים עדיין</td></tr>';
    return;
  }

  history.forEach((entry) => {
    const failed = (entry.results ?? []).filter((r) => !r.success);
    let statusClass = 'badge-ok';
    let statusText = 'פורסם';

    if (entry.dryRun) {
      statusClass = 'badge-mock';
      statusText = 'הרצה יבשה';
    } else if (entry.partial) {
      statusClass = 'badge-mock';
      statusText = 'חלקי';
    } else if (failed.length) {
      statusClass = 'badge-fail';
      statusText = 'נכשל';
    }

    const urls = Object.entries(entry.urls ?? {});
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${new Date(entry.publishedAt).toLocaleString('he-IL')}</td>
      <td>${entry.campaignId}</td>
      <td>${(entry.platforms ?? []).join(', ')}</td>
      <td class="${statusClass}">${statusText}</td>
      <td>${
        urls.length
          ? urls.map(([k, v]) => `<a href="#" data-url="${v}">${k}</a>`).join(' · ')
          : failed.length
            ? `<span class="muted small">${failed.map((f) => `${f.platform}: ${f.error}`).join(' | ')}</span>`
            : '—'
      }</td>
    `;
    body.appendChild(row);
  });

  body.querySelectorAll('[data-url]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      window.api.openExternal(link.getAttribute('data-url'));
    });
  });
}

function renderEngineStatus(health) {
  Object.entries({
    ai: health.ai,
    renderer: health.renderer,
    radar: health.radar,
    library: health.library,
  }).forEach(([key, item]) => {
    const row = document.querySelector(`.engine-row[data-engine="${key}"]`);
    if (!row || !item) return;
    const dot = row.querySelector('.status-indicator');
    dot.classList.toggle('online', Boolean(item.ok));
    dot.classList.toggle('offline', !item.ok);
    row.title = item.error || item.detail || item.label;
  });
}

async function loadConnections({ verify = false } = {}) {
  if (!window.api) return;

  const health = await window.api.getConnectionHealth({ verify });
  renderEngineStatus(health);

  const grid = document.getElementById('connections-grid');
  grid.innerHTML = '';

  if (health.dryRun) {
    const notice = document.createElement('div');
    notice.className = 'source-banner source-sample';
    notice.innerHTML =
      '<strong>PUBLISH_DRY_RUN=1</strong><span class="muted small">פרסום מושבת — לא תבוצע קריאת API. הסר מ-.env כדי לפרסם באמת.</span>';
    grid.appendChild(notice);
  }

  Object.entries(health).forEach(([key, item]) => {
    if (!item || typeof item !== 'object') return;

    const configured = item.ok ?? item.configured ?? false;
    const details = [
      item.endpoint ? `נקודת קצה: ${item.endpoint}` : null,
      item.model ? `מודל: ${item.model}` : null,
      item.encoder ? `מקודד: ${item.encoder}` : null,
      item.resolution ? `רזולוציה: ${item.resolution}` : null,
      item.version ? `גרסה: ${item.version}` : null,
      item.apiVersion ? `Graph: ${item.apiVersion}` : null,
      item.igUsername ? `IG: @${item.igUsername}` : null,
      item.username ? `TikTok: @${item.username}` : null,
      item.mode ? `מצב: ${item.mode}` : null,
      item.detail ?? null,
      item.note ?? null,
    ].filter(Boolean);

    const card = document.createElement('div');
    card.className = 'connection-card';
    card.innerHTML = `
      <h3>${item.label ?? key}</h3>
      <div class="connection-status">
        <div class="status-indicator ${configured ? 'online' : 'offline'}"></div>
        <span>${configured ? 'מחובר / פעיל' : 'לא מוגדר'}</span>
      </div>
      ${details.map((line) => `<p class="muted small">${line}</p>`).join('')}
      ${item.error ? `<p class="warn-text small">${item.error}</p>` : ''}
    `;
    grid.appendChild(card);
  });
}

async function loadLibraryStatus() {
  if (!window.api) return;

  const status = await window.api.getLibraryStatus();
  const banner = document.getElementById('library-status');
  banner.className = `source-banner ${status.indexed ? 'source-live' : 'source-none'}`;
  banner.innerHTML = `
    <strong>${status.indexed ? '🟢' : '🔴'} ${status.message}</strong>
    ${status.scannedAt ? `<span class="muted small">נסרק: ${new Date(status.scannedAt).toLocaleString('he-IL')}</span>` : ''}
    <span class="muted small">תיקיות: ${status.roots?.length ? status.roots.join(' · ') : 'לא הוגדרו (MUSIC_ROOTS)'}</span>
  `;

  if (status.indexed) {
    await runLibrarySearch();
  }
}

async function runLibrarySearch() {
  const query = document.getElementById('library-search').value;
  const body = document.getElementById('library-body');
  body.innerHTML = '<tr><td colspan="6" class="loading-note">טוען…</td></tr>';

  const tracks = await window.api.searchLibrary(query, { limit: 200 });
  body.innerHTML = '';

  if (!tracks.length) {
    body.innerHTML = '<tr><td colspan="6">לא נמצאו קבצים</td></tr>';
    return;
  }

  tracks.forEach((track) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${track.displayName}${track.artist ? ` <span class="muted small">— ${track.artist}</span>` : ''}</td>
      <td>${track.category}</td>
      <td>${track.bpm ?? '—'}</td>
      <td>${formatDuration(track.durationSec)}</td>
      <td class="path-cell" dir="ltr">${track.dir}</td>
      <td>${track.category === 'audio' ? '<button class="btn btn-small btn-secondary" type="button">רנדר</button>' : ''}</td>
    `;
    const button = row.querySelector('button');
    if (button) {
      button.addEventListener('click', () => {
        selectAudio(track.path);
        switchTab('create-tab');
      });
    }
    body.appendChild(row);
  });
}

/** Read the file's real metadata with ffprobe before enabling the render. */
async function selectAudio(audioPath) {
  if (!audioPath) return;

  selectedAudioPath = audioPath;
  const result = await window.api.probeAudio(audioPath);
  const card = document.getElementById('probe-card');
  const details = document.getElementById('probe-details');
  const renderBtn = document.getElementById('btn-render');

  if (!result.success) {
    card.classList.add('hidden');
    renderBtn.disabled = true;
    showToast(`לא ניתן לקרוא את הקובץ: ${result.error}`);
    logLocal('error', `ffprobe failed: ${result.error}`);
    return;
  }

  lastProbe = result.meta;
  const rows = [
    ['קובץ', result.meta.fileName],
    ['אורך', formatDuration(result.meta.duration)],
    ['קודק', result.meta.codec],
    ['דגימה', result.meta.sampleRate ? `${result.meta.sampleRate} Hz` : '—'],
    ['ערוצים', result.meta.channels ?? '—'],
    ['BPM', result.meta.bpm ?? '—'],
    ['כותרת', result.meta.title ?? '—'],
    ['אמן', result.meta.artist ?? '—'],
    ['גודל', formatBytes(result.meta.sizeBytes)],
  ];
  details.innerHTML = rows
    .map(([label, value]) => `<div><span class="muted small">${label}</span><strong>${value}</strong></div>`)
    .join('');

  card.classList.remove('hidden');
  renderBtn.disabled = false;

  const durationInput = document.getElementById('render-duration');
  durationInput.max = Math.max(3, Math.floor(result.meta.duration));
  if (Number(durationInput.value) > result.meta.duration) {
    durationInput.value = Math.floor(result.meta.duration);
  }

  logLocal('ok', `נבחר ${result.meta.fileName} — ${formatDuration(result.meta.duration)}`);
}

async function runRender() {
  if (!selectedAudioPath) {
    showToast('בחר קובץ אודיו קודם');
    return;
  }

  const renderBtn = document.getElementById('btn-render');
  const wrap = document.getElementById('render-progress-wrap');
  const fill = document.getElementById('render-progress');
  const text = document.getElementById('render-progress-text');

  renderBtn.disabled = true;
  wrap.classList.remove('hidden');
  fill.style.width = '0%';
  text.textContent = '0%';

  const result = await window.api.createCampaign({
    audioPath: selectedAudioPath,
    style: document.getElementById('render-style').value,
    startSec: Number(document.getElementById('render-start').value) || 0,
    durationSec: Number(document.getElementById('render-duration').value) || 15,
  });

  renderBtn.disabled = false;

  if (!result.success) {
    text.textContent = 'נכשל';
    showToast(`הרינדור נכשל: ${result.error}`);
    return;
  }

  fill.style.width = '100%';
  text.textContent = '100%';
  showToast(
    result.aiError
      ? 'הסרטון רונדר — הכיתובים לא נוצרו (המודל לא זמין)'
      : 'הסרטון רונדר והכיתובים נכתבו',
  );

  switchTab('approval-tab');
  await loadApprovalQueue();
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

  if (!platforms.length) {
    showToast('בחר לפחות פלטפורמה אחת');
    return;
  }

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
    showToast(result.dryRun ? 'הרצה יבשה הושלמה (ללא פרסום)' : 'הסרטון פורסם בהצלחה!');
    await loadApprovalQueue();
    await loadHistory();
  } else {
    showToast(result.error ?? 'הפרסום נכשל');
    updatePublishButtonState();
  }
}

async function rejectCurrent() {
  if (!currentCampaign) return;
  if (!confirm('לדחות ולהסיר את הסרטון מתור האישורים?')) return;

  await window.api.rejectCampaign(currentCampaign.id);
  showToast('הסרטון הוסר מהתור');
  await loadApprovalQueue();
}

function setupPlayerWatchGate() {
  player.addEventListener('play', async () => {
    if (!currentCampaign || hasWatchedCurrent) return;

    hasWatchedCurrent = true;
    currentCampaign.watched = true;
    await window.api.markWatched(currentCampaign.id);
    updatePublishButtonState();
  });
}

function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach((button) => {
    button.addEventListener('click', () => switchTab(button.getAttribute('data-tab')));
  });
}

function setupActions() {
  document.getElementById('btn-publish').addEventListener('click', approveCurrent);
  document.getElementById('btn-reject').addEventListener('click', rejectCurrent);

  document.getElementById('btn-scan-radar').addEventListener('click', async () => {
    showToast('סורק מקורות חיים…');
    showLoading(
      document.getElementById('radar-list'),
      'סורק מקורות חיים דרך yt-dlp — עוקב אחרי ההתקדמות בלוג למטה…',
    );
    const result = await window.api.scanRadar();
    await loadRadarData();
    showToast(
      result.source === 'live'
        ? `נסרקו ${result.items.length} פוסטים (${result.viral.length} ויראליים)`
        : result.warning ?? 'הסריקה לא החזירה נתונים חיים',
    );
  });

  document.getElementById('btn-gen-hooks').addEventListener('click', async () => {
    showToast('שולח בקשה למודל המקומי…');
    const feed = await window.api.getRadarFeed();
    const result = await window.api.generateHooks({
      track: currentTrackContext(),
      trends: feed?.viral ?? [],
      count: 3,
    });

    if (!result.success) {
      showToast(`המודל לא זמין: ${result.error}`);
      return;
    }
    renderHookList(result.hooks);
    const short = result.requested && result.hooks.length < result.requested;
    showToast(
      short
        ? `המודל החזיר ${result.hooks.length} מתוך ${result.requested} הוקים (${result.model})`
        : `הופקו ${result.hooks.length} הוקים מ-${result.model}`,
    );
  });

  document.getElementById('btn-gen-captions').addEventListener('click', async () => {
    showToast('כותב כיתובים…');
    const result = await window.api.generateCaptions({
      track: currentTrackContext(),
      hook: document.getElementById('caption-he').value,
    });

    if (!result.success) {
      showToast(`המודל לא זמין: ${result.error}`);
      return;
    }

    document.getElementById('caption-he').value = result.captionHe;
    document.getElementById('caption-en').value = result.captionEn;
    document.getElementById('post-hashtags').value = result.hashtags;
    showToast(`כיתובים נכתבו על ידי ${result.model}`);
  });

  document.getElementById('btn-remix-hook').addEventListener('click', async () => {
    showToast('משנה הוק…');
    const result = await window.api.remixHook({
      currentHook: document.getElementById('caption-he').value,
      track: currentTrackContext(),
    });

    if (!result.success) {
      showToast(`המודל לא זמין: ${result.error}`);
      return;
    }

    document.getElementById('caption-he').value = result.he || result.en;
    if (result.en) document.getElementById('caption-en').value = result.en;
    showToast(`הוק חדש מ-${result.model}`);
  });

  document.getElementById('btn-pick-audio').addEventListener('click', async () => {
    const picked = await window.api.pickAudioFile();
    if (picked) await selectAudio(picked);
  });

  document.getElementById('btn-render').addEventListener('click', runRender);

  document.getElementById('btn-scan-library').addEventListener('click', async () => {
    showToast('סורק את הדיסק…');
    const result = await window.api.scanLibrary();
    await loadLibraryStatus();
    showToast(`נמצאו ${result.totals.all} קבצים (${result.totals.audio} אודיו)`);
  });

  document.getElementById('library-search').addEventListener('input', () => {
    clearTimeout(window.__librarySearchTimer);
    window.__librarySearchTimer = setTimeout(runLibrarySearch, 220);
  });

  document.getElementById('btn-verify-connections').addEventListener('click', async () => {
    showToast('בודק חיבורים מול ה-API…');
    await loadConnections({ verify: true });
    showToast('בדיקת החיבורים הושלמה');
  });

  document.getElementById('btn-clear-log').addEventListener('click', () => {
    logLines.length = 0;
    logBody.textContent = '';
  });

  document.getElementById('btn-toggle-log').addEventListener('click', (event) => {
    const dock = document.getElementById('log-dock');
    const collapsed = dock.classList.toggle('collapsed');
    event.target.textContent = collapsed ? 'הצג' : 'הסתר';
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
    if (!file) return;

    const filePath = window.api.getPathForFile(file);
    if (!filePath) {
      showToast('לא ניתן לקרוא את נתיב הקובץ');
      return;
    }
    await selectAudio(filePath);
  });
}

async function setupRenderStyles() {
  renderStyles = (await window.api.getRenderStyles()) ?? {};
  const select = document.getElementById('render-style');
  select.innerHTML = Object.entries(renderStyles)
    .map(([key, label]) => `<option value="${key}">${label}</option>`)
    .join('');
}

function setupLiveEvents() {
  window.api.onEngineLog(appendLog);

  window.api.onRenderProgress(({ percent }) => {
    const fill = document.getElementById('render-progress');
    const text = document.getElementById('render-progress-text');
    fill.style.width = `${percent}%`;
    text.textContent = `${percent}%`;
  });

  window.api.onLibraryProgress((progress) => {
    if (progress.phase === 'walk') {
      logLocal('info', `נמצאו ${progress.found} קבצים — קורא תגיות…`);
    } else if (progress.phase === 'probe') {
      logLocal('info', `ffprobe ${progress.done}/${progress.total}`);
    }
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupActions();
  setupPlayerWatchGate();
  setupDropZone();

  if (!window.api) {
    logLocal('error', 'IPC bridge unavailable — preload did not load');
    return;
  }

  setupLiveEvents();
  await setupRenderStyles();
  await loadApprovalQueue();
  await loadConnections();
  logLocal('ok', 'Studio ready — engines probed');
});
