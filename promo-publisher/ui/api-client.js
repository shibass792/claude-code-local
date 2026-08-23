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
    uploadAndRender: async (file) => {
      const res = await fetch('/api/render/upload', {
        method: 'POST',
        headers: { 'X-Filename': file.name },
        body: file,
      });
      return res.json();
    },
  };
})();
