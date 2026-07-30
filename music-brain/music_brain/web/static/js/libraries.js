window.MB = window.MB || {};

MB.Libraries = {
  currentLibrary: "music",
  currentSub: null,
  browseOffset: 0,
  browseItems: [],
  pageSize: 80,
  options: {},

  async init(opts) {
    this.options = {
      containerId: "browse-results",
      tabsId: "lib-tabs",
      subTabsId: "sub-tabs",
      summaryId: "lib-summary",
      moreBtnId: "btn-more",
      defaultLibrary: "music",
      librariesFilter: null,
      ...opts,
    };
    this.currentLibrary = this.options.defaultLibrary;
    MB.Player.init();
    await this.loadTabs();
    await this.browse(true);
  },

  async loadTabs() {
    const data = await MB.API.libraries();
    const summary = document.getElementById(this.options.summaryId);
    if (summary) {
      summary.textContent = `${data.total.toLocaleString()} קבצי שמיעה באינדקס`;
    }
    const tabs = document.getElementById(this.options.tabsId);
    if (!tabs) return;
    tabs.innerHTML = "";
    let libs = data.libraries;
    if (this.options.librariesFilter) {
      libs = libs.filter((l) => this.options.librariesFilter.includes(l.id));
    }
    for (const lib of libs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "lib-tab" + (lib.id === this.currentLibrary ? " active" : "");
      btn.innerHTML = `${MB.esc(lib.label)}<span class="lib-count">${lib.total}</span>`;
      btn.onclick = () => this.selectLibrary(lib.id, libs);
      tabs.appendChild(btn);
    }
    this._renderSubTabs(libs.find((l) => l.id === this.currentLibrary));
  },

  _renderSubTabs(lib) {
    const box = document.getElementById(this.options.subTabsId);
    if (!box) return;
    box.innerHTML = "";
    if (!lib || !lib.subs.length) {
      box.style.display = "none";
      this.currentSub = null;
      return;
    }
    box.style.display = "flex";
    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "sub-tab" + (!this.currentSub ? " active" : "");
    allBtn.textContent = "הכל";
    allBtn.onclick = () => {
      this.currentSub = null;
      this._updateSubActive();
      this.browse(true);
    };
    box.appendChild(allBtn);
    for (const sub of lib.subs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "sub-tab" + (this.currentSub === sub.id ? " active" : "");
      btn.innerHTML = `${MB.esc(sub.label)}<span class="lib-count">${sub.count}</span>`;
      btn.onclick = () => {
        this.currentSub = sub.id;
        this._updateSubActive();
        this.browse(true);
      };
      box.appendChild(btn);
    }
  },

  _updateSubActive() {
    document.querySelectorAll(".sub-tab").forEach((b, i) => {
      b.classList.toggle("active", i === 0 ? !this.currentSub : false);
    });
    document.querySelectorAll(".sub-tab").forEach((b) => {
      if (this.currentSub && b.textContent.includes(this.currentSub)) {
        b.classList.add("active");
      }
    });
  },

  async selectLibrary(id, libs) {
    this.currentLibrary = id;
    this.currentSub = null;
    if (!libs) {
      const data = await MB.API.libraries();
      libs = data.libraries;
    }
    document.querySelectorAll(".lib-tab").forEach((b, i) => {
      const filtered = this.options.librariesFilter
        ? libs.filter((l) => this.options.librariesFilter.includes(l.id))
        : libs;
      b.classList.toggle("active", filtered[i] && filtered[i].id === id);
    });
    this._renderSubTabs(libs.find((l) => l.id === id));
    await this.browse(true);
  },

  renderTable() {
    const el = document.getElementById(this.options.containerId);
    if (!el) return;
    MB.Player.setQueue(this.browseItems);
    if (!this.browseItems.length) {
      el.innerHTML =
        '<p class="sub">אין קבצים — הרץ <code>music-brain pipeline</code></p>';
      return;
    }
    let html =
      "<table><tr><th></th><th>קובץ</th><th>תיקייה</th><th>BPM</th><th>Key</th></tr>";
    this.browseItems.forEach((r, i) => {
      const name = MB.basename(r.path);
      const folder = r.library_sub || "-";
      html += `<tr data-id="${r.file_id}"><td><button type="button" class="play-btn" data-play="${i}">▶</button></td>
        <td title="${MB.esc(r.path)}">${MB.esc(name)}</td><td>${MB.esc(folder)}</td>
        <td>${r.bpm || "-"}</td><td>${r.key || "-"}</td></tr>`;
    });
    html += "</table>";
    el.innerHTML = html;
    el.querySelectorAll("[data-play]").forEach((btn) => {
      btn.onclick = () => MB.Player.playAt(Number(btn.dataset.play));
    });
  },

  async browse(reset) {
    if (reset) {
      this.browseOffset = 0;
      this.browseItems = [];
    }
    const data = await MB.API.browse(
      this.currentLibrary,
      this.currentSub,
      this.browseOffset,
      this.pageSize
    );
    this.browseItems = this.browseItems.concat(data.items);
    this.browseOffset += data.items.length;
    this.renderTable();
    const more = document.getElementById(this.options.moreBtnId);
    if (more) more.style.display = data.has_more ? "inline-block" : "none";
  },

  loadMore() {
    return this.browse(false);
  },
};
