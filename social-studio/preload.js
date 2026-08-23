'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getTrends: (options) => ipcRenderer.invoke('radar:get-trends', options),
  getRadarSummary: () => ipcRenderer.invoke('radar:summary'),
  getWatchlist: () => ipcRenderer.invoke('radar:watchlist'),
  getPendingApproval: () => ipcRenderer.invoke('approval:get-pending'),
  markWatched: (campaignId) => ipcRenderer.invoke('approval:mark-watched', campaignId),
  updateCampaign: (campaignId, patch) => ipcRenderer.invoke('approval:update', campaignId, patch),
  rejectCampaign: (campaignId) => ipcRenderer.invoke('approval:reject', campaignId),
  approveAndPublish: (campaignData) => ipcRenderer.invoke('approval:approve-and-publish', campaignData),
  getHistory: () => ipcRenderer.invoke('approval:history'),
  getConnections: () => ipcRenderer.invoke('system:connections'),
  listTemplates: () => ipcRenderer.invoke('create:templates'),
  createFromTemplate: (options) => ipcRenderer.invoke('create:from-template', options),
  createFromRadar: (trend) => ipcRenderer.invoke('create:from-radar', trend),
  pickMedia: () => ipcRenderer.invoke('dialog:pick-media'),
});
