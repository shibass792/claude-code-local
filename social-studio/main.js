'use strict';

const { app, BrowserWindow, ipcMain, Notification, dialog } = require('electron');
const path = require('path');
const radar = require('./modules/radar');
const approvalEngine = require('./modules/approval-publisher');
const campaignFactory = require('./modules/campaign-factory');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#03101c',
    title: 'ShiBass Social Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
    autoHideMenuBar: true,
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
}

function notify(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

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

ipcMain.handle('radar:get-trends', async (_event, options) => {
  return radar.getTopTrendingContent(options || {});
});

ipcMain.handle('radar:summary', async () => {
  return radar.summarizeRadar();
});

ipcMain.handle('radar:watchlist', async () => {
  return radar.getWatchlist();
});

ipcMain.handle('approval:get-pending', async () => {
  return approvalEngine.getPendingQueue();
});

ipcMain.handle('approval:mark-watched', async (_event, campaignId) => {
  return approvalEngine.markWatched(campaignId);
});

ipcMain.handle('approval:update', async (_event, campaignId, patch) => {
  return approvalEngine.updateCampaign(campaignId, patch);
});

ipcMain.handle('approval:reject', async (_event, campaignId) => {
  return approvalEngine.rejectCampaign(campaignId);
});

ipcMain.handle('approval:approve-and-publish', async (_event, campaignData) => {
  try {
    const result = await approvalEngine.publishCampaign(campaignData, { dryRun: true });
    notify('ShiBass — הפרסום נרשם', `קמפיין ${campaignData.id} · ${campaignData.platforms.join(', ')}`);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('approval:history', async () => {
  return approvalEngine.getPublishHistory();
});

ipcMain.handle('system:connections', async () => {
  return approvalEngine.getConnectionHealth();
});

ipcMain.handle('create:templates', async () => {
  return campaignFactory.listTemplates();
});

ipcMain.handle('create:from-template', async (_event, options) => {
  const campaign = campaignFactory.createCampaignFromTemplate(options || {});
  notify('סרטון חדש בתור', campaign.title);
  return campaign;
});

ipcMain.handle('create:from-radar', async (_event, trend) => {
  const campaign = campaignFactory.createFromRadarIdea(trend);
  notify('מיקסוס מרדאר', campaign.title);
  return campaign;
});

ipcMain.handle('dialog:pick-media', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'בחר אודיו / וידאו מהמחשב',
    properties: ['openFile'],
    filters: [
      { name: 'Media', extensions: ['wav', 'mp3', 'flac', 'aiff', 'mp4', 'mov', 'mkv'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) {
    return null;
  }
  return result.filePaths[0];
});
