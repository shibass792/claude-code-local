(function attachStudioApi() {
  if (window.api) {
    return;
  }

  const base = '';

  async function json(method, pathname, body) {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }
    const res = await fetch(`${base}${pathname}`, options);
    return res.json();
  }

  window.api = {
    getTrends: () => json('GET', '/api/radar'),
    scanRadar: () => json('POST', '/api/radar/scan', {}),
    getTemplate: async (templateId) => {
      const items = await json('GET', '/api/radar');
      const list = Array.isArray(items) ? items : items.viral ?? items.items ?? [];
      return list.find((item) => item.id === templateId) ?? null;
    },
    getPendingApproval: () => json('GET', '/api/approval/pending'),
    rejectCampaign: (campaignId) => json('POST', '/api/approval/reject', { campaignId }),
    markWatched: (campaignId) => json('POST', '/api/approval/mark-watched', { campaignId }),
    getPublishHistory: () => json('GET', '/api/approval/history'),
    getConnectionHealth: () => json('GET', '/api/connections'),
    resolveMediaPath: (relativePath) =>
      json('GET', `/api/media?path=${encodeURIComponent(relativePath ?? '')}`),
    approveAndPublish: (campaignData) => json('POST', '/api/approval/publish', campaignData),
    openExternal: (url) => {
      window.open(url, '_blank', 'noopener');
      return true;
    },
    getEngines: () => json('GET', '/api/engines'),
    getLog: () => json('GET', '/api/log'),
    renderReel: (payload) => json('POST', '/api/render', payload),
    generateHooks: (payload) => json('POST', '/api/hooks', payload),
    instagramSession: () => json('POST', '/api/instagram/session', {}),
    scanMusic: (payload) => json('POST', '/api/music/scan', payload ?? {}),
    getMusicIndex: () => json('GET', '/api/music/index'),
    getCareer: () => json('GET', '/api/career'),
    writeEpk: (payload) => json('POST', '/api/career/epk', payload ?? {}),
    getPack: () => json('GET', '/api/pack'),
    generatePack: () => json('POST', '/api/pack/generate', {}),
    scanBackgrounds: (payload) => json('POST', '/api/backgrounds/scan', payload ?? {}),
    getBackgrounds: () => json('GET', '/api/backgrounds'),
    uploadBackground: async (file) => {
      const res = await fetch('/api/backgrounds/upload', {
        method: 'POST',
        headers: { 'X-Filename': file.name },
        body: file,
      });
      return res.json();
    },
    uploadAndRender: async (file, extra) => {
      const headers = { 'X-Filename': file.name };
      if (extra?.backgroundId) {
        headers['X-Background-Id'] = extra.backgroundId;
      }
      const res = await fetch('/api/render/upload', {
        method: 'POST',
        headers,
        body: file,
      });
      return res.json();
    },
  };
})();
