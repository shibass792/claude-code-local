require('dotenv').config({ path: require('path').join(__dirname, 'config/.env') });

const { app, BrowserWindow, ipcMain, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const radar = require('./modules/radar');
const approvalEngine = require('./modules/approval-publisher');
const { resolveFromRoot } = require('./modules/store');
const { getEngineStatus } = require('./modules/engines');
const { readLog, formatLogText, readState } = require('./modules/creation-log');
const { renderVerticalReel } = require('./modules/render');
const { generateViralHooks } = require('./modules/hooks');
const instagram = require('./modules/instagram-engine');
const music = require('./modules/music-library');
const career = require('./modules/career-ladder');
const psyPack = require('./modules/psy-pack');

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

ipcMain.handle('engines:status', async () => getEngineStatus({ log: true }));

ipcMain.handle('log:get', async () => {
  const entries = readLog(160);
  return { mock: false, entries, text: formatLogText(entries), state: readState() };
});

ipcMain.handle('render:reel', async (_event, payload) => renderVerticalReel(payload ?? {}));

ipcMain.handle('hooks:generate', async (_event, payload) => generateViralHooks(payload ?? {}));

ipcMain.handle('instagram:session', async () => instagram.startSession());

ipcMain.handle('music:scan', async (_event, payload) => music.scanLibrary(payload ?? {}));

ipcMain.handle('music:index', async () => music.getIndex());

ipcMain.handle('render:upload-meta', async (_event, payload) =>
  renderVerticalReel(payload ?? {}),
);

ipcMain.handle('career:get', async () => {
  const engines = await getEngineStatus();
  return career.buildCareerBoard({
    engines: engines.engines ?? engines,
    inventory: music.getIndex(),
    pending: approvalEngine.getPendingQueue().length,
  });
});

ipcMain.handle('career:epk', async (_event, payload) => {
  const engines = await getEngineStatus();
  return career.writeEpk({
    engines: engines.engines ?? engines,
    inventory: music.getIndex(),
    pending: approvalEngine.getPendingQueue().length,
    links: payload?.links ?? {},
  });
});

ipcMain.handle('pack:status', async () => psyPack.getPackStatus());

ipcMain.handle('pack:generate', async () => psyPack.generatePack());
