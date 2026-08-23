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
  getEngines: () => ipcRenderer.invoke('engines:status'),
  getLog: () => ipcRenderer.invoke('log:get'),
  renderReel: (payload) => ipcRenderer.invoke('render:reel', payload),
  generateHooks: (payload) => ipcRenderer.invoke('hooks:generate', payload),
  instagramSession: () => ipcRenderer.invoke('instagram:session'),
  scanMusic: (payload) => ipcRenderer.invoke('music:scan', payload),
  getMusicIndex: () => ipcRenderer.invoke('music:index'),
  uploadAndRender: (payload) => ipcRenderer.invoke('render:upload-meta', payload),
  getCareer: () => ipcRenderer.invoke('career:get'),
  writeEpk: (payload) => ipcRenderer.invoke('career:epk', payload ?? {}),
  getPack: () => ipcRenderer.invoke('pack:status'),
  generatePack: () => ipcRenderer.invoke('pack:generate'),
});
