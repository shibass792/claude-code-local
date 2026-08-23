require('dotenv').config({ path: require('path').join(__dirname, 'config/.env') });

const { app, BrowserWindow, ipcMain, Notification, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const radar = require('./modules/radar');
const approvalEngine = require('./modules/approval-publisher');
const mediaLibrary = require('./modules/media-library');
const renderEngine = require('./modules/render-engine');
const hookGenerator = require('./modules/hook-generator');
const engines = require('./modules/engines');
const { createCampaignFromRender } = require('./modules/campaign-factory');
const { resolveFromRoot, OUTPUT_DIR } = require('./modules/store');
const { generatePsyPack } = require('./modules/psy-pack');
const { buildProducerPack } = require('./modules/producer-pack');
const { buildEpk } = require('./modules/epk');
const { getSprint, toggleCell } = require('./modules/sprint');
const { getLadder } = require('./modules/ladder');
const { getWave1, evaluateCsvFile } = require('./modules/ads-cpc');
const { probeOps, formatOpsLog } = require('./modules/ops-probe');
const transcriber = require('./modules/transcriber');

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

ipcMain.handle('engines:status', async () => {
  const status = await engines.getEnginesStatus();
  return { ...status, log: engines.formatStatusLog(status) };
});

ipcMain.handle('media:scan', async (_event, options) => mediaLibrary.scanMediaLibrary(options || {}));

ipcMain.handle('media:library', async (_event, query) => mediaLibrary.getLibrary(query || {}));

ipcMain.handle('hooks:generate', async (_event, options) => hookGenerator.generateHooks(options || {}));

ipcMain.handle('render:reel', async (_event, options) => renderEngine.renderReel(options || {}));

ipcMain.handle('create:campaign', async (_event, options) => createCampaignFromRender(options || {}));

ipcMain.handle('psy:generate', async (_event, options) => generatePsyPack(options || {}));
ipcMain.handle('pack:build', async (_event, options) => buildProducerPack(options || {}));
ipcMain.handle('epk:build', async (_event, options) => buildEpk(options || {}));
ipcMain.handle('sprint:get', async () => getSprint());
ipcMain.handle('sprint:toggle', async (_event, payload) => toggleCell(payload?.id, payload?.done));
ipcMain.handle('ladder:get', async () => getLadder());
ipcMain.handle('wave1:get', async () => getWave1());
ipcMain.handle('ops:probe', async () => {
  const report = await probeOps();
  return { ...report, log: formatOpsLog(report) };
});
ipcMain.handle('ads:pick-csv', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Wave 1 Ads CSV (Windsor / Ads Manager export)',
    filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }
  return evaluateCsvFile(result.filePaths[0]);
});
ipcMain.handle('guides:ingest', async (_event, payload) => transcriber.ingestFile(payload || {}));
ipcMain.handle('shell:open-path', async (_event, target) => {
  const dest = target || OUTPUT_DIR;
  await shell.openPath(dest);
  return true;
});
