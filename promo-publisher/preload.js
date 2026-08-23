const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Radar (yt-dlp)
  getTrends: () => ipcRenderer.invoke('radar:get-trends'),
  scanRadar: () => ipcRenderer.invoke('radar:scan'),
  getRadarFeed: () => ipcRenderer.invoke('radar:get-feed'),
  getRadarHealth: () => ipcRenderer.invoke('radar:health'),
  getTemplate: (templateId) => ipcRenderer.invoke('radar:get-template', templateId),

  // Local AI (Ollama / OpenAI-compatible)
  getAiHealth: () => ipcRenderer.invoke('ai:health'),
  generateHooks: (payload) => ipcRenderer.invoke('ai:generate-hooks', payload),
  remixHook: (payload) => ipcRenderer.invoke('ai:remix-hook', payload),
  generateCaptions: (payload) => ipcRenderer.invoke('ai:generate-captions', payload),

  // Renderer (FFmpeg)
  getRenderHealth: () => ipcRenderer.invoke('render:health'),
  getRenderStyles: () => ipcRenderer.invoke('render:styles'),
  probeAudio: (audioPath) => ipcRenderer.invoke('render:probe', audioPath),
  pickAudioFile: () => ipcRenderer.invoke('render:pick-audio'),
  createCampaign: (options) => ipcRenderer.invoke('render:create-campaign', options),

  // Music library index
  getLibraryStatus: () => ipcRenderer.invoke('library:status'),
  scanLibrary: () => ipcRenderer.invoke('library:scan'),
  searchLibrary: (query, options) => ipcRenderer.invoke('library:search', query, options),

  // Approval + publishing
  getPendingApproval: () => ipcRenderer.invoke('approval:get-pending'),
  rejectCampaign: (campaignId) => ipcRenderer.invoke('approval:reject', campaignId),
  markWatched: (campaignId) => ipcRenderer.invoke('approval:mark-watched', campaignId),
  getPublishHistory: () => ipcRenderer.invoke('approval:get-history'),
  getConnectionHealth: (options) => ipcRenderer.invoke('connections:get-health', options),
  resolveMediaPath: (relativePath) => ipcRenderer.invoke('media:resolve-path', relativePath),
  approveAndPublish: (campaignData) =>
    ipcRenderer.invoke('approval:approve-and-publish', campaignData),

  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  // `File.path` is deprecated in newer Electron; webUtils is the supported way
  // to turn a dropped File into an absolute path.
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return file?.path ?? null;
    }
  },

  // Live engine events
  onEngineLog: (callback) => {
    const handler = (_event, line) => callback(line);
    ipcRenderer.on('engine:log', handler);
    return () => ipcRenderer.removeListener('engine:log', handler);
  },
  onRenderProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('render:progress', handler);
    return () => ipcRenderer.removeListener('render:progress', handler);
  },
  onLibraryProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('library:progress', handler);
    return () => ipcRenderer.removeListener('library:progress', handler);
  },
});
