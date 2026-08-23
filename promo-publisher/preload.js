const { contextBridge, ipcRenderer } = require('electron');

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
  getEnginesStatus: () => ipcRenderer.invoke('engines:status'),
  scanMedia: (options) => ipcRenderer.invoke('media:scan', options),
  getLibrary: (query) => ipcRenderer.invoke('media:library', query),
  generateHooks: (options) => ipcRenderer.invoke('hooks:generate', options),
  renderReel: (options) => ipcRenderer.invoke('render:reel', options),
  createCampaign: (options) => ipcRenderer.invoke('create:campaign', options),
});
