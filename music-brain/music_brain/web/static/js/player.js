window.MB = window.MB || {};

MB.Player = {
  queue: [],
  filteredQueue: [],
  filter: "all",
  index: -1,
  _inited: false,
  _libraryLoaded: false,
  _expanded: true,
  _minimized: false,
  STORAGE_KEY: "mb_player_v1",

  init() {
    if (this._inited) return;
    this._inited = true;
    if (document.getElementById("mb-mini-player")) return;

    document.body.insertAdjacentHTML(
      "beforeend",
      `<div id="mb-mini-player" class="mb-mini">
        <div class="mb-mini-header" id="mb-mini-drag">
          <span class="mb-mini-label">🎵 נגן</span>
          <span class="mb-mini-count" id="mb-queue-count">0</span>
          <div class="mb-mini-header-btns">
            <button type="button" class="mb-icon-btn" id="mb-btn-expand" title="רשימה">☰</button>
            <button type="button" class="mb-icon-btn" id="mb-btn-minimize" title="מזער">—</button>
          </div>
        </div>
        <div class="mb-mini-body" id="mb-mini-body">
          <div class="mb-mini-filters" id="mb-mini-filters">
            <button type="button" class="mb-filter active" data-filter="all">הכל</button>
            <button type="button" class="mb-filter" data-filter="music">מוזיקה</button>
            <button type="button" class="mb-filter" data-filter="samples">סמפלים</button>
            <button type="button" class="mb-filter" data-filter="loops">לופים</button>
          </div>
          <div class="mb-mini-now">
            <div id="mb-player-title" class="mb-now-title">טוען ספרייה...</div>
            <div id="mb-player-sub" class="mb-now-sub">—</div>
            <audio id="mb-player-audio" controls preload="metadata"></audio>
            <div class="mb-mini-controls">
              <button type="button" class="mb-ctrl" id="mb-btn-prev">⏮</button>
              <button type="button" class="mb-ctrl" id="mb-btn-toggle">▶</button>
              <button type="button" class="mb-ctrl" id="mb-btn-next">⏭</button>
            </div>
          </div>
          <div class="mb-mini-playlist-wrap" id="mb-playlist-wrap">
            <input type="search" id="mb-playlist-search" placeholder="חפש ברשימה..." class="mb-playlist-search"/>
            <div class="mb-mini-playlist" id="mb-playlist"></div>
          </div>
        </div>
      </div>`
    );

    document.getElementById("mb-btn-prev").onclick = () => this.prev();
    document.getElementById("mb-btn-next").onclick = () => this.next();
    document.getElementById("mb-btn-toggle").onclick = () => this.toggle();
    document.getElementById("mb-btn-expand").onclick = () => this.toggleExpand();
    document.getElementById("mb-btn-minimize").onclick = () => this.toggleMinimize();

    document.querySelectorAll(".mb-filter").forEach((btn) => {
      btn.onclick = () => this.setFilter(btn.dataset.filter);
    });

    const searchInput = document.getElementById("mb-playlist-search");
    searchInput.addEventListener("input", () => this.renderPlaylist());

    const audio = this.audioEl();
    audio.addEventListener("ended", () => this.next());
    audio.addEventListener("play", () => this._updateToggleBtn());
    audio.addEventListener("pause", () => this._updateToggleBtn());
    audio.addEventListener("timeupdate", () => this.saveState());
    audio.addEventListener("loadedmetadata", () => this._tryRestoreTime());

    this._restoreUiState();
    document.getElementById("mb-mini-player").classList.add("active");
  },

  audioEl() {
    return document.getElementById("mb-player-audio");
  },

  _updateToggleBtn() {
    const btn = document.getElementById("mb-btn-toggle");
    if (!btn) return;
    btn.textContent = this.audioEl().paused ? "▶" : "⏸";
  },

  toggleExpand() {
    this._expanded = !this._expanded;
    document.getElementById("mb-playlist-wrap").style.display = this._expanded
      ? "flex"
      : "none";
    document.getElementById("mb-btn-expand").textContent = this._expanded
      ? "☰"
      : "☰";
    this.saveState();
  },

  toggleMinimize() {
    this._minimized = !this._minimized;
    const el = document.getElementById("mb-mini-player");
    el.classList.toggle("minimized", this._minimized);
    document.getElementById("mb-btn-minimize").textContent = this._minimized
      ? "□"
      : "—";
    this.saveState();
  },

  setFilter(filter) {
    this.filter = filter;
    document.querySelectorAll(".mb-filter").forEach((b) => {
      b.classList.toggle("active", b.dataset.filter === filter);
    });
    this.applyFilter();
    this.renderPlaylist();
    this.saveState();
  },

  applyFilter() {
    if (this.filter === "all") {
      this.filteredQueue = this.queue.slice();
    } else {
      this.filteredQueue = this.queue.filter(
        (r) => (r.library || "other") === this.filter
      );
    }
    const count = document.getElementById("mb-queue-count");
    if (count) count.textContent = String(this.filteredQueue.length);
  },

  setQueue(items, replaceAll) {
    if (replaceAll) {
      this.queue = (items || []).filter((r) => r.file_id);
    } else {
      const ids = new Set(this.queue.map((r) => r.file_id));
      for (const item of items || []) {
        if (item.file_id && !ids.has(item.file_id)) {
          this.queue.push(item);
          ids.add(item.file_id);
        }
      }
    }
    this.applyFilter();
    this.renderPlaylist();
    this.saveState();
  },

  async loadPersistentLibrary() {
    if (this._libraryLoaded) {
      this.applyFilter();
      this.renderPlaylist();
      return;
    }
    const title = document.getElementById("mb-player-title");
    if (title) title.textContent = "טוען את כל הקבצים...";

    const libraries = ["music", "samples", "loops", "other"];
    const all = [];
    for (const lib of libraries) {
      let offset = 0;
      while (true) {
        try {
          const data = await MB.API.browse(lib, null, offset, 500);
          for (const item of data.items) {
            item.library = lib;
            all.push(item);
          }
          if (!data.has_more || !data.items.length) break;
          offset += data.items.length;
        } catch (_e) {
          break;
        }
      }
    }

    this.queue = all;
    this._libraryLoaded = true;
    this.applyFilter();
    this.renderPlaylist();
    this.saveState();

    const restored = this.restorePlayback();
    if (!restored && this.filteredQueue.length) {
      if (title) title.textContent = `${all.length} קבצים מוכנים לנגינה`;
      const sub = document.getElementById("mb-player-sub");
      if (sub) sub.textContent = "לחץ ▶ ברשימה או בטבלה";
    }
  },

  renderPlaylist() {
    const el = document.getElementById("mb-playlist");
    if (!el) return;
    const q = (document.getElementById("mb-playlist-search")?.value || "")
      .toLowerCase()
      .trim();
    let items = this.filteredQueue;
    if (q) {
      items = items.filter((r) =>
        String(r.path).toLowerCase().includes(q)
      );
    }
    if (!items.length) {
      el.innerHTML = '<p class="mb-pl-empty">אין קבצים — הרץ pipeline</p>';
      return;
    }
    const maxShow = 300;
    const slice = items.slice(0, maxShow);
    el.innerHTML = slice
      .map((r, i) => {
        const realIdx = this.queue.indexOf(r);
        const idx = realIdx >= 0 ? realIdx : this.filteredQueue.indexOf(r);
        const name = MB.basename(r.path);
        const playing =
          this.index >= 0 &&
          this.queue[this.index]?.file_id === r.file_id;
        return `<button type="button" class="mb-pl-item${playing ? " playing" : ""}" data-idx="${idx}">
          <span class="mb-pl-name">${MB.esc(name)}</span>
          <span class="mb-pl-meta">${MB.esc(r.library_sub || r.library || "")}</span>
        </button>`;
      })
      .join("");
    if (items.length > maxShow) {
      el.innerHTML += `<p class="mb-pl-more">+ עוד ${items.length - maxShow} — צמצם חיפוש</p>`;
    }
    el.querySelectorAll(".mb-pl-item").forEach((btn) => {
      btn.onclick = () => this.playAt(Number(btn.dataset.idx));
    });
  },

  highlight(fileId) {
    document.querySelectorAll("tr[data-id]").forEach((tr) => {
      tr.classList.toggle("playing", tr.dataset.id === String(fileId));
    });
    this.renderPlaylist();
  },

  showMeta(meta) {
    document.getElementById("mb-player-title").textContent = meta.name || "—";
    const bits = [
      meta.sub_style,
      meta.bpm ? `${meta.bpm} BPM` : null,
      meta.key,
      meta.library_sub,
      meta.library,
    ].filter(Boolean);
    document.getElementById("mb-player-sub").textContent =
      bits.join(" · ") || meta.path || "—";
  },

  async playFileId(fileId, meta) {
    if (!fileId) return;
    this.init();
    const idx = this.queue.findIndex((r) => r.file_id === fileId);
    if (idx >= 0) this.index = idx;

    const a = this.audioEl();
    const needNewSrc =
      !a.src || !a.src.endsWith(`/api/stream/${fileId}`);
    if (needNewSrc) {
      a.src = MB.API.streamUrl(fileId);
    }
    this.showMeta(
      meta || {
        name: idx >= 0 ? MB.basename(this.queue[idx].path) : `קובץ #${fileId}`,
        ...(idx >= 0 ? this.queue[idx] : {}),
      }
    );
    this.highlight(fileId);
    try {
      await a.play();
    } catch (_e) {
      /* autoplay blocked */
    }
    this._updateToggleBtn();
    this.saveState();
  },

  playAt(i) {
    if (i < 0 || i >= this.queue.length) return;
    this.index = i;
    const item = this.queue[i];
    this.playFileId(item.file_id, {
      name: MB.basename(item.path),
      path: item.path,
      sub_style: item.sub_style,
      bpm: item.bpm,
      key: item.key,
      library_sub: item.library_sub,
      library: item.library,
    });
  },

  next() {
    if (!this.queue.length) return;
    const start = this.index < 0 ? 0 : (this.index + 1) % this.queue.length;
    if (this.filter !== "all") {
      const ids = new Set(this.filteredQueue.map((r) => r.file_id));
      for (let n = 0; n < this.queue.length; n++) {
        const i = (start + n) % this.queue.length;
        if (ids.has(this.queue[i].file_id)) {
          this.playAt(i);
          return;
        }
      }
    }
    this.playAt(start);
  },

  prev() {
    if (!this.queue.length) return;
    const start =
      this.index <= 0 ? this.queue.length - 1 : this.index - 1;
    if (this.filter !== "all") {
      const ids = new Set(this.filteredQueue.map((r) => r.file_id));
      for (let n = 0; n < this.queue.length; n++) {
        const i = (start - n + this.queue.length) % this.queue.length;
        if (ids.has(this.queue[i].file_id)) {
          this.playAt(i);
          return;
        }
      }
    }
    this.playAt(start);
  },

  toggle() {
    const a = this.audioEl();
    if (a.paused) a.play();
    else a.pause();
  },

  saveState() {
    try {
      const a = this.audioEl();
      const state = {
        index: this.index,
        fileId:
          this.index >= 0 ? this.queue[this.index]?.file_id : null,
        currentTime: a && !a.paused ? a.currentTime : 0,
        wasPlaying: a && !a.paused,
        filter: this.filter,
        expanded: this._expanded,
        minimized: this._minimized,
        queueIds: this.queue.map((r) => r.file_id),
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
    } catch (_e) {
      /* storage full */
    }
  },

  _restoreUiState() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.filter) this.setFilter(s.filter);
      if (s.expanded === false) {
        this._expanded = false;
        const wrap = document.getElementById("mb-playlist-wrap");
        if (wrap) wrap.style.display = "none";
      }
      if (s.minimized) this.toggleMinimize();
    } catch (_e) {
      /* ignore */
    }
  },

  _pendingTime: null,

  _tryRestoreTime() {
    if (this._pendingTime != null) {
      this.audioEl().currentTime = this._pendingTime;
      this._pendingTime = null;
    }
  },

  restorePlayback() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (s.fileId == null) return false;
      const idx = this.queue.findIndex((r) => r.file_id === s.fileId);
      if (idx < 0) return false;
      this.index = idx;
      const item = this.queue[idx];
      const a = this.audioEl();
      a.src = MB.API.streamUrl(item.file_id);
      this.showMeta({
        name: MB.basename(item.path),
        path: item.path,
        sub_style: item.sub_style,
        bpm: item.bpm,
        key: item.key,
        library_sub: item.library_sub,
        library: item.library,
      });
      if (s.currentTime) this._pendingTime = s.currentTime;
      this.highlight(item.file_id);
      if (s.wasPlaying) {
        a.play().catch(() => {});
      }
      this._updateToggleBtn();
      return true;
    } catch (_e) {
      return false;
    }
  },
};
