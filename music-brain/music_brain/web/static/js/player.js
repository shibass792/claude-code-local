window.MB = window.MB || {};

MB.Player = {
  queue: [],
  index: -1,
  _inited: false,

  init() {
    if (this._inited) return;
    this._inited = true;
    if (!document.getElementById("mb-player-bar")) {
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div id="mb-player-bar">
          <div id="mb-player-meta">
            <div id="mb-player-title">—</div>
            <div id="mb-player-sub">—</div>
          </div>
          <audio id="mb-player-audio" controls preload="metadata"></audio>
          <div id="mb-player-controls">
            <button type="button" id="mb-btn-prev">⏮</button>
            <button type="button" id="mb-btn-toggle">⏸</button>
            <button type="button" id="mb-btn-next">⏭</button>
          </div>
        </div>`
      );
      document.getElementById("mb-btn-prev").onclick = () => this.prev();
      document.getElementById("mb-btn-next").onclick = () => this.next();
      document.getElementById("mb-btn-toggle").onclick = () => this.toggle();
      const audio = this.audioEl();
      audio.addEventListener("ended", () => this.next());
      audio.addEventListener("play", () => {
        document.getElementById("mb-btn-toggle").textContent = "⏸";
      });
      audio.addEventListener("pause", () => {
        document.getElementById("mb-btn-toggle").textContent = "▶";
      });
    }
  },

  audioEl() {
    return document.getElementById("mb-player-audio");
  },

  setQueue(items) {
    this.queue = (items || []).filter((r) => r.file_id);
  },

  highlight(fileId) {
    document.querySelectorAll("tr[data-id]").forEach((tr) => {
      tr.classList.toggle("playing", tr.dataset.id === String(fileId));
    });
  },

  showMeta(meta) {
    document.getElementById("mb-player-bar").classList.add("active");
    document.getElementById("mb-player-title").textContent = meta.name || "—";
    const bits = [
      meta.sub_style,
      meta.bpm ? `${meta.bpm} BPM` : null,
      meta.key,
      meta.library_sub,
    ].filter(Boolean);
    document.getElementById("mb-player-sub").textContent =
      bits.join(" · ") || meta.path || "—";
  },

  async playFileId(fileId, meta) {
    if (!fileId) return;
    this.init();
    const a = this.audioEl();
    a.src = MB.API.streamUrl(fileId);
    this.showMeta(meta || { name: `קובץ #${fileId}` });
    this.highlight(fileId);
    try {
      await a.play();
    } catch (_e) {
      /* autoplay blocked */
    }
    document.getElementById("mb-btn-toggle").textContent = "⏸";
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
    });
  },

  next() {
    if (!this.queue.length) return;
    this.playAt((this.index + 1) % this.queue.length);
  },

  prev() {
    if (!this.queue.length) return;
    this.playAt((this.index - 1 + this.queue.length) % this.queue.length);
  },

  toggle() {
    const a = this.audioEl();
    if (a.paused) {
      a.play();
    } else {
      a.pause();
    }
  },
};
