window.MB = window.MB || {};

MB.Match = {
  reference: null,
  matches: [],

  init() {
    const btn = document.getElementById("btn-analyze");
    const input = document.getElementById("source");
    if (!btn || !input) return;

    btn.addEventListener("click", () => this.analyze());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.analyze();
    });

    this.loadRecentLinks();
  },

  _dawFilter() {
    const cubase = document.getElementById("filter-cubase")?.checked;
    const ableton = document.getElementById("filter-ableton")?.checked;
    if (cubase && !ableton) return "Cubase";
    if (ableton && !cubase) return "Ableton";
    return null;
  },

  setStatus(text, isError) {
    const el = document.getElementById("match-status");
    if (!el) return;
    el.textContent = text || "";
    el.style.color = isError ? "#ff8a8a" : "";
  },

  async analyze() {
    const source = document.getElementById("source")?.value?.trim();
    if (!source) {
      this.setStatus("נא להדביק קישור או נתיב", true);
      return;
    }

    const btn = document.getElementById("btn-analyze");
    btn.disabled = true;
    this.setStatus("מנתח טראק ומחפש פרויקטים מתאימים...");

    try {
      const data = await MB.API.matchAnalyze(source, this._dawFilter());
      this.reference = data.reference;
      this.matches = data.matches || [];
      this.renderReference();
      this.renderMatches();
      this.renderRecentLinks(data.recent_links || []);
      this.setStatus(data.message_he || "הושלם");
    } catch (err) {
      this.setStatus(err.message || "שגיאה בחיפוש", true);
    } finally {
      btn.disabled = false;
    }
  },

  renderReference() {
    const card = document.getElementById("reference-card");
    const meta = document.getElementById("reference-meta");
    const audio = document.getElementById("reference-audio");
    if (!this.reference || !card) return;

    card.style.display = "block";
    const r = this.reference;
    const bits = [
      r.title,
      r.bpm ? `${Math.round(r.bpm)} BPM` : null,
      r.key ? `Key ${r.key}` : null,
      r.source_type === "youtube" ? "YouTube" : "מקומי",
    ].filter(Boolean);
    meta.innerHTML = `<div class="ref-title">${MB.esc(bits.join(" · "))}</div>`;

    if (audio && r.preview_url) {
      audio.src = r.preview_url;
    }
  },

  renderMatches() {
    const card = document.getElementById("results-card");
    const container = document.getElementById("match-results");
    if (!card || !container) return;

    if (!this.matches.length) {
      card.style.display = "block";
      container.innerHTML =
        '<p class="sub">לא נמצאו פרויקטים — הרץ scan + pipeline כדי לאנדקס פרויקטים</p>';
      return;
    }

    card.style.display = "block";
    container.innerHTML = `
      <table class="match-table">
        <thead>
          <tr>
            <th>פרויקט</th>
            <th>DAW</th>
            <th>BPM</th>
            <th>Key</th>
            <th>התאמה</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${this.matches
            .map((m, i) => this._rowHtml(m, i))
            .join("")}
        </tbody>
      </table>`;

    container.querySelectorAll("[data-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.open);
        this.openInDaw(this.matches[idx]);
      });
    });
  },

  _rowHtml(m, idx) {
    const scorePct = Math.round((m.score || 0) * 100);
    const reasons = (m.reasons || []).slice(0, 2).join(" · ");
    return `<tr>
      <td>
        <div class="proj-name">${MB.esc(m.project_name)}</div>
        <div class="proj-path sub">${MB.esc(m.project_path)}</div>
        ${reasons ? `<div class="proj-reasons sub">${MB.esc(reasons)}</div>` : ""}
      </td>
      <td><span class="tag">${MB.esc(m.daw || "")}</span></td>
      <td>${m.bpm ? MB.esc(String(Math.round(m.bpm))) : "—"}</td>
      <td>${m.key ? MB.esc(m.key) : "—"}</td>
      <td><span class="score-badge">${scorePct}%</span></td>
      <td>
        <button type="button" class="play-btn" data-open="${idx}">פתח ב-${MB.esc(m.daw || "DAW")}</button>
      </td>
    </tr>`;
  },

  async openInDaw(match) {
    if (!match || !this.reference) return;
    this.setStatus(`פותח ${match.project_name} ומשייך לטראק...`);
    try {
      const data = await MB.API.matchOpen({
        project_path: match.project_path,
        reference_id: this.reference.id,
        reference_source: this.reference.source_url,
        reference_title: this.reference.title,
        bpm: this.reference.bpm,
        key: this.reference.key,
      });
      this.setStatus(data.message_he || "נפתח בהצלחה");
      await this.loadRecentLinks();
    } catch (err) {
      this.setStatus(err.message || "פתיחה נכשלה", true);
    }
  },

  renderRecentLinks(links) {
    const card = document.getElementById("links-card");
    const el = document.getElementById("recent-links");
    if (!card || !el) return;
    if (!links.length) {
      card.style.display = "none";
      return;
    }
    card.style.display = "block";
    el.innerHTML = links
      .map(
        (l) =>
          `<div class="link-row">
            <span>${MB.esc(l.reference_title || l.reference_id)}</span>
            <span class="tag">→</span>
            <span>${MB.esc(MB.basename(l.project_path))}</span>
          </div>`
      )
      .join("");
  },

  async loadRecentLinks() {
    try {
      const data = await MB.API.matchLinks();
      this.renderRecentLinks(data.links || []);
    } catch (_e) {
      /* ignore */
    }
  },
};
