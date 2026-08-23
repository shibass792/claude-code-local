require('dotenv').config({ path: require('path').join(__dirname, 'config/.env') });

const { app, BrowserWindow, ipcMain, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const radar = require('./modules/radar');
const approvalEngine = require('./modules/approval-publisher');
const engines = require('./modules/engines');
const { startApiServer } = require('./api-server');
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

process.on('uncaughtException', (err) => {
  console.error('[fatal]', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandled]', err);
});

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

app.whenReady().then(async () => {
  try {
    const api = await startApiServer();
    console.log(`[engines-api] ${api.address}`);
  } catch (error) {
    console.error('[engines-api] already running or failed:', error.message);
  }

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

ipcMain.handle('radar:get-trends', async () => radar.getTopTrendingContent());

ipcMain.handle('radar:scan', async () => radar.scanWatchlist());

ipcMain.handle('radar:get-template', async (_event, templateId) =>
  radar.getTemplateById(templateId),
);

ipcMain.handle('approval:get-pending', async () => approvalEngine.getPendingQueue());

ipcMain.handle('approval:reject', async (_event, campaignId) =>
  approvalEngine.rejectCampaign(campaignId),
);

ipcMain.handle('approval:mark-watched', async (_event, campaignId) =>
  approvalEngine.markWatched(campaignId),
);

ipcMain.handle('approval:get-history', async () => approvalEngine.getPublishHistory());

ipcMain.handle('connections:get-health', async () => approvalEngine.getConnectionHealth());

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
  const result = await approvalEngine.publishCampaign(campaignData);

  if (result.success && Notification.isSupported()) {
    new Notification({
      title: result.mock ? 'פרסום סימולציה הושלם' : 'הפרסום הושלם בהצלחה! 🚀',
      body: `הסרטון ${campaignData.title} — ${(campaignData.platforms ?? []).join(', ')}`,
    }).show();
  }

  return result;
});

ipcMain.handle('shell:open-external', async (_event, url) => {
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('engines:status', async () => engines.getEnginesStatus());
ipcMain.handle('engines:log', async (_event, limit) => engines.creationLog.readLog(limit));
ipcMain.handle('engines:log-clear', async () => engines.creationLog.clearLog());
ipcMain.handle('engines:instagram-status', async () => engines.instagram.getStatus());
ipcMain.handle('engines:hooks', async (_event, input) => engines.reelhook.generateHooks(input));
ipcMain.handle('engines:render', async (_event, input) => {
  const render = await engines.renderer.renderVerticalReel(input);
  if (render.ok) {
    approvalEngine.enqueueRenderedCampaign(render);
  }
  return render;
});
ipcMain.handle('engines:player-index', async () => engines.player.getIndexOrEmpty());
ipcMain.handle('engines:player-scan', async (_event, roots) => engines.player.scanLibrary(roots));
ipcMain.handle('engines:player-stream-url', async (_event, id) => {
  const port = Number(process.env.ENGINES_API_PORT ?? 4051);
  return `http://127.0.0.1:${port}/api/player/stream/${encodeURIComponent(id)}`;
});
ipcMain.handle('media:path-for-file', async (_event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) {
    return { exists: false, path: null };
  }
  return { exists: true, path: filePath };
});
