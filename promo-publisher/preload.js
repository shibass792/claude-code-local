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
  getCreationLog: () => ipcRenderer.invoke('log:get'),
  clearCreationLog: () => ipcRenderer.invoke('log:clear'),
  generateHooks: (payload) => ipcRenderer.invoke('hooks:generate', payload),
  getLibrary: () => ipcRenderer.invoke('library:get'),
  scanLibrary: () => ipcRenderer.invoke('library:scan'),
  renderAudio: (payload) => ipcRenderer.invoke('render:audio', payload),
});
