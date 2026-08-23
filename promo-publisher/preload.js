const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getTrends: () => ipcRenderer.invoke('radar:get-trends'),
  scanRadar: () => ipcRenderer.invoke('radar:scan'),
  getTemplate: (templateId) => ipcRenderer.invoke('radar:get-template', templateId),
  getPendingApproval: () => ipcRenderer.invoke('approval:get-pending'),
  rejectCampaign: (campaignId) => ipcRenderer.invoke('approval:reject', campaignId),
  markWatched: (campaignId) => ipcRenderer.invoke('approval:mark-watched', campaignId),
  getPublishHistory: () => ipcRenderer.invoke('approval:get-history'),
  getConnectionHealth: () => ipcRenderer.invoke('connections:get-health'),
  resolveMediaPath: (relativePath) => ipcRenderer.invoke('media:resolve-path', relativePath),
  approveAndPublish: (campaignData) =>
    ipcRenderer.invoke('approval:approve-and-publish', campaignData),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  enginesStatus: () => ipcRenderer.invoke('engines:status'),
  getCreationLog: (limit) => ipcRenderer.invoke('engines:log', limit),
  clearCreationLog: () => ipcRenderer.invoke('engines:log-clear'),
  instagramStatus: () => ipcRenderer.invoke('engines:instagram-status'),
  generateHooks: (input) => ipcRenderer.invoke('engines:hooks', input),
  renderReel: (input) => ipcRenderer.invoke('engines:render', input),
  playerIndex: () => ipcRenderer.invoke('engines:player-index'),
  playerScan: (roots) => ipcRenderer.invoke('engines:player-scan', roots),
  playerStreamUrl: (id) => ipcRenderer.invoke('engines:player-stream-url', id),
  pathForDroppedFile: (file) => {
    const filePath = webUtils?.getPathForFile ? webUtils.getPathForFile(file) : file.path;
    return ipcRenderer.invoke('media:path-for-file', filePath);
  },
});
