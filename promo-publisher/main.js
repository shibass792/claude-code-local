const { installProcessGuards } = require('./modules/safe-stdio');
installProcessGuards();

require('dotenv').config({ path: require('path').join(__dirname, 'config/.env') });

const { app, BrowserWindow, ipcMain, Notification, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const radar = require('./modules/radar');
const approvalEngine = require('./modules/approval-publisher');
const ai = require('./modules/ai');
const hooks = require('./modules/hooks');
const renderer = require('./modules/renderer');
const library = require('./modules/library');
const { resolveFromRoot } = require('./modules/store');

function configureElectronStorage() {
  const userDataPath = path.join(__dirname, '.electron-user-data');
  const cachePath = path.join(userDataPath, 'cache');
  const gpuCachePath = path.join(userDataPath, 'gpu-cache');

  fs.mkdirSync(cachePath, { recursive: true });
  fs.mkdirSync(gpuCachePath, { recursive: true });

  app.setPath('userData', userDataPath);
  app.commandLine.appendSwitch('disk-cache-dir', cachePath);
  app.commandLine.appendSwitch('gpu-disk-cache-dir', gpuCachePath);
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
  app.commandLine.appendSwitch('disable-http-cache');
}

configureElectronStorage();

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('no-sandbox');

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0f1117',
    title: 'ShiBass Social Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
    autoHideMenuBar: true,
  });

  mainWindow.loadFile(path.join(__dirname, 'ui/index.html'));
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/**
 * Push a real engine log line to the UI console. Every line here corresponds to
 * an actual operation that just happened — there is no scripted output.
 */
function emitLog(level, message) {
  const line = { at: new Date().toISOString(), level, message };
  console.log(`[${level}] ${message}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('engine:log', line);
  }
  return line;
}

ipcMain.handle('radar:get-trends', async () => radar.getTopTrendingContent());

ipcMain.handle('radar:scan', async () => {
  emitLog('info', 'Radar scan started (yt-dlp)');
  const result = await radar.scanWatchlist({
    onProgress: (p) => emitLog('info', `Radar ${p.index}/${p.total}: ${p.artist}`),
  });
  emitLog(
    result.source === 'live' ? 'ok' : 'warn',
    `Radar finished — source=${result.source}, posts=${result.items.length}, viral=${result.viral.length}` +
      (result.warning ? ` — ${result.warning}` : ''),
  );
  return result;
});

ipcMain.handle('radar:get-feed', async () => radar.getRadarFeed());

ipcMain.handle('radar:health', async () => radar.checkHealth());

ipcMain.handle('radar:get-template', async (_event, templateId) =>
  radar.getTemplateById(templateId),
);

ipcMain.handle('ai:health', async () => ai.checkHealth());

ipcMain.handle('ai:generate-hooks', async (_event, payload = {}) => {
  try {
    emitLog('info', 'ReelHook: requesting hooks from local model');
    const result = await hooks.generateHooks(payload);
    emitLog('ok', `ReelHook: ${result.hooks.length} hooks from ${result.model}`);
    return { success: true, ...result };
  } catch (error) {
    emitLog('error', `ReelHook failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('ai:remix-hook', async (_event, payload = {}) => {
  try {
    emitLog('info', 'ReelHook: rewriting hook');
    const result = await hooks.remixHook(payload);
    emitLog('ok', `ReelHook: new hook from ${result.model}`);
    return { success: true, ...result };
  } catch (error) {
    emitLog('error', `ReelHook remix failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('ai:generate-captions', async (_event, payload = {}) => {
  try {
    emitLog('info', 'ReelHook: writing captions');
    const result = await hooks.generateCaptions(payload);
    emitLog('ok', `ReelHook: captions from ${result.model}`);
    return { success: true, ...result };
  } catch (error) {
    emitLog('error', `Caption generation failed: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('render:health', async () => renderer.checkHealth());

ipcMain.handle('render:styles', async () => renderer.STYLES);

ipcMain.handle('render:probe', async (_event, audioPath) => {
  try {
    return { success: true, meta: await renderer.probeAudio(audioPath) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('render:pick-audio', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'בחר קובץ אודיו',
    properties: ['openFile'],
    filters: [
      { name: 'Audio', extensions: ['wav', 'mp3', 'flac', 'aiff', 'aif', 'm4a', 'aac', 'ogg'] },
    ],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('render:create-campaign', async (_event, options = {}) => {
  try {
    emitLog('info', `Render started: ${path.basename(options.audioPath ?? '')} (${options.style ?? 'bars'})`);
    const { campaign, render, aiError } = await approvalEngine.createCampaignFromAudio({
      ...options,
      onProgress: (p) => {
        if (p.stage === 'render' && typeof p.percent === 'number') {
          mainWindow?.webContents.send('render:progress', p);
        } else {
          emitLog('info', `Render stage: ${p.stage}`);
        }
      },
    });

    if (aiError) {
      emitLog('warn', `Captions unavailable: ${aiError}`);
    }
    emitLog(
      'ok',
      `Rendered ${render.relativePath} (${render.width}x${render.height} ${render.encoder}) ` +
        `${(render.sizeBytes / 1024 / 1024).toFixed(2)}MB in ${render.renderMs}ms`,
    );

    return { success: true, campaign, render, aiError };
  } catch (error) {
    emitLog('error', `Render failed: ${error.message}${error.stderr ? ` — ${error.stderr}` : ''}`);
    return { success: false, error: error.message, stderr: error.stderr ?? null };
  }
});

ipcMain.handle('library:status', async () => library.getIndexStatus());

ipcMain.handle('library:scan', async () => {
  emitLog('info', 'Music library scan started');
  const result = await library.scanLibrary({
    onProgress: (p) =>
      mainWindow?.webContents.send('library:progress', p),
  });
  emitLog(
    result.totals.all > 0 ? 'ok' : 'warn',
    `Library scan finished — ${result.totals.all} files (${result.totals.audio} audio, ` +
      `${result.totals.midi} midi) in ${result.scanMs}ms` +
      (result.warning ? ` — ${result.warning}` : ''),
  );
  return result;
});

ipcMain.handle('library:search', async (_event, query, options) =>
  library.searchTracks(query, options),
);

ipcMain.handle('approval:get-pending', async () => approvalEngine.getPendingQueue());

ipcMain.handle('approval:reject', async (_event, campaignId) =>
  approvalEngine.rejectCampaign(campaignId),
);

ipcMain.handle('approval:mark-watched', async (_event, campaignId) =>
  approvalEngine.markWatched(campaignId),
);

ipcMain.handle('approval:get-history', async () => approvalEngine.getPublishHistory());

ipcMain.handle('connections:get-health', async (_event, options = {}) =>
  approvalEngine.getConnectionHealth(options),
);

ipcMain.handle('media:resolve-path', async (_event, relativePath) => {
  const absolute = resolveFromRoot(relativePath);
  if (!absolute) {
    return { exists: false, path: null };
  }
  if (!fs.existsSync(absolute)) {
    return { exists: false, path: absolute };
  }
  return { exists: true, path: `file://${absolute.replace(/\\/g, '/')}` };
});

ipcMain.handle('approval:approve-and-publish', async (_event, campaignData) => {
  emitLog('info', `Publishing ${campaignData.id} to ${(campaignData.platforms ?? []).join(', ')}`);

  const result = await approvalEngine.publishCampaign(campaignData, {
    onProgress: (p) =>
      emitLog('info', `Publish ${p.platform ?? ''} ${p.stage ?? p.status ?? ''}`.trim()),
  });

  if (result.success) {
    const urls = Object.entries(result.urls ?? {});
    emitLog(
      'ok',
      result.dryRun
        ? `Dry run complete for ${campaignData.id} — no API call was made`
        : `Published ${campaignData.id}${urls.length ? ` — ${urls.map(([k, v]) => `${k}: ${v}`).join(' · ')}` : ''}`,
    );
  } else {
    emitLog('error', `Publish failed: ${result.error}`);
  }

  if (result.success && Notification.isSupported()) {
    new Notification({
      title: result.dryRun ? 'הרצה יבשה הושלמה (ללא פרסום)' : 'הפרסום הושלם בהצלחה! 🚀',
      body: `הסרטון ${campaignData.title} — ${(campaignData.platforms ?? []).join(', ')}`,
    }).show();
  }

  return result;
});

ipcMain.handle('shell:open-external', async (_event, url) => {
  await shell.openExternal(url);
  return true;
});
