window.SB = window.SB || {};

SB.API = {
  async get(path) {
    const r = await fetch(path);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  },

  async post(path, body) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  },

  matchTrack(q, opts = {}) {
    const params = new URLSearchParams({ q, limit_arps: opts.limitArps || 20, limit_projects: opts.limitProjects || 12 });
    if (opts.daw) params.set("daw", opts.daw);
    return this.get(`/api/match-track?${params}`);
  },

  download(hits, label) {
    return this.post("/api/download", { hits, label });
  },

  openCubase(payload) {
    return this.post("/api/open-cubase", payload);
  },

  health() {
    return this.get("/health");
  },
};

SB.esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

SB.scorePct = (n) => `${Math.round((Number(n) || 0) * 100)}%`;
