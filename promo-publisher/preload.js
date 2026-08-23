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
  renderReel: (payload) => ipcRenderer.invoke('studio:render', payload),
  generateHooks: (payload) => ipcRenderer.invoke('studio:hooks', payload),
  getInstagramHealth: () => ipcRenderer.invoke('studio:instagram-health'),
  scanLibrary: (payload) => ipcRenderer.invoke('studio:scan-library', payload),
  getMusicIndex: () => ipcRenderer.invoke('studio:music-index'),
  createCampaign: (payload) => ipcRenderer.invoke('studio:create-campaign', payload),
});
