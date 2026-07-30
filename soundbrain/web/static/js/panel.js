window.SB = window.SB || {};

SB.Panel = {
  state: {
    reference: null,
    arps: [],
    projects: [],
  },

  init() {
    const input = document.getElementById("query");
    const btn = document.getElementById("btn-search");
    const btnDl = document.getElementById("btn-download");
    const btnOpen = document.getElementById("btn-open-cubase");

    btn.addEventListener("click", () => this.search());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.search();
    });
    btnDl.addEventListener("click", () => this.downloadSelected());
    btnOpen.addEventListener("click", () => this.openCubase());

    SB.API.health()
      .then((h) => {
        const el = document.getElementById("health");
        const n = Object.values(h.counts || {}).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);
        el.textContent = `מחובר · ${n.toLocaleString()} רשומות באינדקס`;
        el.className = "status ok";
      })
      .catch(() => {
        const el = document.getElementById("health");
        el.textContent = "השרת לא זמין — הרץ: soundbrain serve";
        el.className = "status err";
      });
  },

  setStatus(msg, kind) {
    const el = document.getElementById("status");
    el.textContent = msg || "";
    el.className = "status" + (kind ? ` ${kind}` : "");
  },

  async search() {
    const q = document.getElementById("query").value.trim();
    if (!q) {
      this.setStatus("הדבק קישור YouTube, שם שיר, או נתיב לקובץ", "err");
      return;
    }
    const btn = document.getElementById("btn-search");
    btn.disabled = true;
    this.setStatus("מחפש התאמות בספריות שלך…");
    try {
      const data = await SB.API.matchTrack(q);
      this.state.reference = data.reference;
      this.state.arps = data.arps || [];
      this.state.projects = data.projects || [];
      this.renderMeta(data);
      this.renderArps(this.state.arps);
      this.renderProjects(this.state.projects);
      this.setStatus(data.message_he || "מוכן", "ok");
    } catch (err) {
      this.setStatus(err.message || String(err), "err");
    } finally {
      btn.disabled = false;
    }
  },

  renderMeta(data) {
    const box = document.getElementById("meta");
    const r = data.reference || {};
    const chips = [];
    if (r.source) chips.push(`<span class="chip">${SB.esc(r.source)}</span>`);
    if (r.artist) chips.push(`<span class="chip teal">${SB.esc(r.artist)}</span>`);
    if (r.title) chips.push(`<span class="chip">${SB.esc(r.title)}</span>`);
    if (r.bpm) chips.push(`<span class="chip">${Math.round(r.bpm)} BPM</span>`);
    if (r.key) chips.push(`<span class="chip">${SB.esc(r.key)}</span>`);
    chips.push(`<span class="chip teal">${data.counts?.arps || 0} ARP</span>`);
    chips.push(`<span class="chip teal">${data.counts?.projects || 0} פרויקטים</span>`);
    box.innerHTML = chips.join("");
  },

  renderArps(arps) {
    const el = document.getElementById("arp-list");
    if (!arps.length) {
      el.innerHTML = '<p class="empty">לא נמצאו ARP — הרץ scan/analyze או נסה שאילתה אחרת</p>';
      return;
    }
    el.innerHTML = arps
      .map(
        (a, i) => `<label class="hit">
        <input type="checkbox" name="arp" value="${a.file_id}" data-path="${SB.esc(a.path)}" ${i < 3 ? "checked" : ""}/>
        <div>
          <div class="hit-title">${SB.esc(a.name)}</div>
          <div class="hit-meta">${SB.esc(a.kind)} · ${SB.esc(a.subtype || a.role || "-")} · ${a.bpm ? Math.round(a.bpm) + " BPM" : "—"} · ${SB.esc(a.key || "-")}
          <br/>${SB.esc((a.reasons || []).slice(0, 2).join(" · "))}</div>
        </div>
        <div class="score">${SB.scorePct(a.score)}</div>
      </label>`
      )
      .join("");
  },

  renderProjects(projects) {
    const el = document.getElementById("project-list");
    if (!projects.length) {
      el.innerHTML = '<p class="empty">לא נמצאו פרויקטי Cubase/Ableton באינדקס</p>';
      return;
    }
    el.innerHTML = projects
      .map(
        (p, i) => `<label class="hit">
        <input type="radio" name="project" value="${p.file_id}" data-path="${SB.esc(p.path)}" ${i === 0 ? "checked" : ""}/>
        <div>
          <div class="hit-title">${SB.esc(p.name)}</div>
          <div class="hit-meta">${SB.esc(p.daw || "project")} · ${p.bpm ? Math.round(p.bpm) + " BPM" : "—"} · ${SB.esc(p.key || "-")}
          <br/>${SB.esc((p.reasons || []).slice(0, 2).join(" · "))}</div>
        </div>
        <div class="score">${SB.scorePct(p.score)}</div>
      </label>`
      )
      .join("");
  },

  selectedArps() {
    const boxes = [...document.querySelectorAll('input[name="arp"]:checked')];
    const byId = new Map(this.state.arps.map((a) => [String(a.file_id), a]));
    return boxes.map((b) => byId.get(b.value)).filter(Boolean);
  },

  selectedProject() {
    const radio = document.querySelector('input[name="project"]:checked');
    if (!radio) return null;
    return this.state.projects.find((p) => String(p.file_id) === radio.value) || null;
  },

  async downloadSelected() {
    const arps = this.selectedArps();
    const project = this.selectedProject();
    const hits = [...arps];
    if (project) hits.push(project);
    if (!hits.length) {
      this.setStatus("בחר לפחות ARP או פרויקט להורדה", "err");
      return;
    }
    this.setStatus("מעתיק קבצים לתיקיית הורדות…");
    try {
      const label = this.state.reference?.title || "match-pack";
      const data = await SB.API.download(hits, label);
      this.setStatus(data.message_he || `הורדו ${data.count} קבצים`, "ok");
    } catch (err) {
      this.setStatus(err.message || String(err), "err");
    }
  },

  async openCubase() {
    if (!this.state.reference) {
      this.setStatus("חפש קודם טראק / קישור", "err");
      return;
    }
    const arps = this.selectedArps();
    const project = this.selectedProject();
    if (!project && !arps.length) {
      this.setStatus("בחר פרויקט ו/או ARP כדי לשייך ולפתוח", "err");
      return;
    }
    this.setStatus("משייך ופותח ב-Cubase…");
    try {
      const data = await SB.API.openCubase({
        reference: this.state.reference,
        project_file_id: project?.file_id ?? null,
        project_path: project?.path ?? null,
        arp_file_ids: arps.map((a) => a.file_id),
        open_daw: true,
      });
      this.setStatus(data.message_he || "נפתח", data.launched ? "ok" : "");
    } catch (err) {
      this.setStatus(err.message || String(err), "err");
    }
  },
};

document.addEventListener("DOMContentLoaded", () => SB.Panel.init());
