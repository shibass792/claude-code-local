window.MB = window.MB || {};

MB.API = {
  base: "",

  async get(path) {
    const r = await fetch(this.base + path);
    if (!r.ok) throw new Error(`API ${path}: ${r.status}`);
    return r.json();
  },

  libraries() {
    return this.get("/api/libraries");
  },

  browse(library, sub, offset, limit) {
    let url = `/api/browse?library=${encodeURIComponent(library)}&offset=${offset}&limit=${limit}`;
    if (sub) url += `&sub=${encodeURIComponent(sub)}`;
    return this.get(url);
  },

  search(q, limit = 30) {
    return this.get(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`);
  },

  stats() {
    return this.get("/api/stats");
  },

  status() {
    return this.get("/api/status");
  },

  cubase(path) {
    return this.get(`/api/cubase?path=${encodeURIComponent(path)}`);
  },

  matchAnalyze(source, daw) {
    let url = `/api/match/analyze?source=${encodeURIComponent(source)}`;
    if (daw) url += `&daw=${encodeURIComponent(daw)}`;
    return this.get(url);
  },

  matchOpen(payload) {
    return fetch(this.base + "/api/match/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `API error ${r.status}`);
      return data;
    });
  },

  matchLinks(project) {
    let url = "/api/match/links";
    if (project) url += `?project=${encodeURIComponent(project)}`;
    return this.get(url);
  },

  referenceStreamUrl(refId) {
    return `${this.base}/api/reference/${encodeURIComponent(refId)}/stream`;
  },

  streamUrl(fileId) {
    return `${this.base}/api/stream/${fileId}`;
  },

  fileMeta(fileId) {
    return this.get(`/api/file/${fileId}`);
  },
};
