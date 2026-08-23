(function attachStudioApi() {
  const isHttp = /^https?:$/.test(window.location.protocol);

  function looksFake(api) {
    if (!api || typeof api !== 'object') {
      return true;
    }
    if (api.__studioFake === true) {
      return true;
    }
    if (typeof api.getLog !== 'function' || typeof api.getEngines !== 'function') {
      return true;
    }
    return false;
  }

  async function json(method, pathname, body) {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }
    try {
      const res = await fetch(`${pathname}`, options);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          success: false,
          mock: false,
          error: data.error || `Studio API ${res.status} on ${pathname}`,
          entries: [],
          text: '',
        };
      }
      return data;
    } catch (error) {
      return {
        success: false,
        mock: false,
        error: `Studio API לא רץ על 4052 — ${error.message}`,
        entries: [],
        text: '',
      };
    }
  }

  const httpApi = {
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
    getDbHealth: () => json('GET', '/api/db/health'),
    installSql: () => json('POST', '/api/db/install', {}),
    scanFake: () => json('GET', '/api/scan'),
    getMcpStatus: () => json('GET', '/api/mcp/status'),
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
    getCatalog: () => json('GET', '/api/catalog'),
    scanCatalog: (payload) => json('POST', '/api/catalog/scan', payload ?? {}),
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

  if (isHttp || looksFake(window.api) || !window.api) {
    window.api = httpApi;
  }
})();
