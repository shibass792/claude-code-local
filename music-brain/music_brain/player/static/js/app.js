/** SHIBASS S1 — player UI controller */
(function () {
  "use strict";

  const engine = new window.ShibassAudio();
  const state = {
    playlist: [],
    index: -1,
    browserCat: "midi",
    library: [],
    loop: false,
    shuffle: false,
    params: { gain: 0.85, balance: 0, bass: 0, mid: 0, treble: 0, volume: 0.85 },
    activeNotes: new Set(),
  };

  const $ = (id) => document.getElementById(id);
  const playlistEl = $("playlist");
  const browserList = $("browserList");
  const npTitle = $("npTitle");
  const npMeta = $("npMeta");
  const progressFill = $("progressFill");
  const timeLeft = $("timeLeft");
  const aiMsg = $("aiMsg");
  const fileType = $("fileType");
  const searchInput = $("searchInput");

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function setAi(msg) {
    aiMsg.textContent = msg;
  }

  async function api(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + " → " + r.status);
    return r.json();
  }

  // ---- Knobs ----
  function drawKnob(canvas, value01, labelColor) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const cx = w / 2;
    const cy = w / 2;
    const r = w * 0.36;
    ctx.clearRect(0, 0, w, w);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(61,231,255,0.25)";
    ctx.lineWidth = 6;
    ctx.stroke();
    const start = -Math.PI * 0.75;
    const end = start + value01 * Math.PI * 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, end);
    ctx.strokeStyle = labelColor || "#3de7ff";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.stroke();
    const ang = end;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ang) * r * 0.7, cy + Math.sin(ang) * r * 0.7);
    ctx.strokeStyle = "#e8fbff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function bindKnob(el, param, min, max, onChange) {
    const canvas = el.querySelector(".knob-canvas");
    const apply = (v) => {
      state.params[param] = v;
      const t = (v - min) / (max - min);
      drawKnob(canvas, t);
      onChange(v);
    };
    apply(state.params[param] ?? (min + max) / 2);
    let dragging = false;
    let lastY = 0;
    const start = (y) => { dragging = true; lastY = y; };
    const move = (y) => {
      if (!dragging) return;
      const dy = lastY - y;
      lastY = y;
      const range = max - min;
      apply(Math.max(min, Math.min(max, state.params[param] + dy * range * 0.005)));
    };
    const end = () => { dragging = false; };
    canvas.addEventListener("mousedown", (e) => start(e.clientY));
    window.addEventListener("mousemove", (e) => move(e.clientY));
    window.addEventListener("mouseup", end);
    canvas.addEventListener("touchstart", (e) => start(e.touches[0].clientY), { passive: true });
    window.addEventListener("touchmove", (e) => move(e.touches[0].clientY), { passive: true });
    window.addEventListener("touchend", end);
  }

  document.querySelectorAll(".knob").forEach((el) => {
    const p = el.dataset.param;
    if (p === "gain" || p === "volume") {
      bindKnob(el, p === "volume" ? "volume" : "gain", 0, 1.5, (v) => engine.setGain(v));
    } else if (p === "balance") {
      bindKnob(el, "balance", -1, 1, (v) => engine.setBalance(v));
    } else if (p === "bass" || p === "mid" || p === "treble") {
      bindKnob(el, p, -18, 18, (v) => engine.setEq(p, v));
    }
  });

  // ---- Waveform / Spectrum ----
  const waveCanvas = $("waveform");
  const specCanvas = $("spectrum");
  const wctx = waveCanvas.getContext("2d");
  const sctx = specCanvas.getContext("2d");

  function drawWave(data) {
    const w = waveCanvas.width;
    const h = waveCanvas.height;
    wctx.clearRect(0, 0, w, h);
    wctx.strokeStyle = "#3de7ff";
    wctx.lineWidth = 2;
    wctx.beginPath();
    const step = Math.ceil(data.length / w);
    for (let x = 0; x < w; x++) {
      const v = data[x * step] / 128.0;
      const y = (v * h) / 2;
      if (x === 0) wctx.moveTo(x, y);
      else wctx.lineTo(x, y);
    }
    wctx.stroke();
    wctx.strokeStyle = "rgba(61,231,255,0.25)";
    wctx.beginPath();
    wctx.moveTo(0, h / 2);
    wctx.lineTo(w, h / 2);
    wctx.stroke();
  }

  function drawSpec(data) {
    const w = specCanvas.width;
    const h = specCanvas.height;
    sctx.clearRect(0, 0, w, h);
    const bars = 64;
    const gap = 2;
    const bw = w / bars - gap;
    for (let i = 0; i < bars; i++) {
      const idx = Math.floor((i / bars) * data.length * 0.7);
      const v = data[idx] / 255;
      const bh = Math.max(2, v * h);
      const x = i * (bw + gap);
      const grad = sctx.createLinearGradient(0, h - bh, 0, h);
      grad.addColorStop(0, "#3de7ff");
      grad.addColorStop(1, "#0a4a5c");
      sctx.fillStyle = grad;
      sctx.fillRect(x, h - bh, bw, bh);
    }
  }

  engine.attachViz(drawWave, drawSpec);
  // idle visuals
  drawWave(new Uint8Array(2048).fill(128));
  drawSpec(new Uint8Array(1024));

  // ---- Keyboard ----
  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const keyboard = $("keyboard");
  const startMidi = 48; // C3
  const numKeys = 36;

  function buildKeyboard() {
    keyboard.innerHTML = "";
    for (let i = 0; i < numKeys; i++) {
      const midi = startMidi + i;
      const name = NOTE_NAMES[midi % 12];
      const el = document.createElement("div");
      el.className = "key" + (name.includes("#") ? " black" : "");
      el.dataset.midi = String(midi);
      el.title = name + Math.floor(midi / 12) - 1;
      el.addEventListener("mousedown", () => tapNote(midi, true));
      el.addEventListener("mouseup", () => tapNote(midi, false));
      el.addEventListener("mouseleave", () => tapNote(midi, false));
      keyboard.appendChild(el);
    }
  }

  async function tapNote(midi, on) {
    const el = keyboard.querySelector(`[data-midi="${midi}"]`);
    if (!el) return;
    if (on) {
      el.classList.add("active");
      state.activeNotes.add(midi);
      await engine.ensure();
      engine.playMidiNotes([{ midi, start: 0, dur: 0.25 }]);
    } else {
      el.classList.remove("active");
      state.activeNotes.delete(midi);
    }
  }

  function flashNotes(midis, ms) {
    midis.forEach((m) => {
      const el = keyboard.querySelector(`[data-midi="${m}"]`);
      if (el) el.classList.add("active");
    });
    setTimeout(() => {
      midis.forEach((m) => {
        const el = keyboard.querySelector(`[data-midi="${m}"]`);
        if (el) el.classList.remove("active");
      });
    }, ms || 180);
  }

  buildKeyboard();

  // ---- Playlist / Browser ----
  function renderPlaylist() {
    playlistEl.innerHTML = "";
    state.playlist.forEach((item, i) => {
      const li = document.createElement("li");
      li.textContent = String(i + 1).padStart(2, "0") + "_" + item.name;
      if (i === state.index) li.classList.add("active");
      li.addEventListener("click", () => playIndex(i));
      playlistEl.appendChild(li);
    });
  }

  function renderBrowser(items) {
    browserList.innerHTML = "";
    if (!items.length) {
      const li = document.createElement("li");
      li.textContent = "No files — run scan / index";
      browserList.appendChild(li);
      return;
    }
    items.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item.name;
      li.title = item.path;
      li.addEventListener("click", () => {
        addToPlaylist(item, true);
      });
      li.addEventListener("dblclick", () => playItem(item));
      browserList.appendChild(li);
    });
  }

  function addToPlaylist(item, select) {
    const exists = state.playlist.findIndex((x) => x.path === item.path);
    if (exists >= 0) {
      if (select) playIndex(exists);
      return;
    }
    state.playlist.push(item);
    renderPlaylist();
    if (select) playIndex(state.playlist.length - 1);
  }

  async function playIndex(i) {
    if (i < 0 || i >= state.playlist.length) return;
    state.index = i;
    renderPlaylist();
    await playItem(state.playlist[i]);
  }

  async function playItem(item) {
    npTitle.textContent = item.stem || item.name;
    npMeta.textContent = [
      item.extension?.toUpperCase(),
      item.key,
      item.bpm ? item.bpm + " BPM" : null,
      item.style,
      item.folder,
    ]
      .filter(Boolean)
      .join(" · ");
    $("pillBpm").textContent = item.bpm ? item.bpm + " BPM" : "— BPM";
    $("pillKey").textContent = item.key || "— Key";
    setAi("Loading " + item.name + "…");

    try {
      await engine.ensure();
      if (item.is_midi || (item.extension || "").match(/\.mid/i)) {
        await playMidiFile(item);
      } else {
        const url = "/api/stream?path=" + encodeURIComponent(item.path);
        await engine.loadUrl(url);
        engine.play();
        updatePlayIcons(true);
        setAi("Playing · " + (item.category || "media") + " · Music Brain linked");
      }
    } catch (err) {
      console.error(err);
      setAi("Cannot play: " + (err.message || err));
      updatePlayIcons(false);
    }
  }

  async function playMidiFile(item) {
    const url = "/api/stream?path=" + encodeURIComponent(item.path);
    const buf = await fetch(url).then((r) => r.arrayBuffer());
    const notes = parseMidiSimple(new Uint8Array(buf));
    if (!notes.length) {
      setAi("MIDI parsed but no notes found");
      return;
    }
    engine.stop();
    updatePlayIcons(true);
    setAi("MIDI · " + notes.length + " notes · " + item.name);
    // Visualize + play in chunks
    const horizon = Math.min(notes.length, 120);
    const slice = notes.slice(0, horizon);
    engine.playMidiNotes(slice);
    slice.forEach((n) => {
      setTimeout(() => flashNotes([n.midi], Math.max(80, n.dur * 1000)), n.start * 1000);
    });
    const last = slice[slice.length - 1];
    setTimeout(() => updatePlayIcons(false), (last.start + last.dur) * 1000 + 200);
  }

  /** Minimal SMF parser — note on/off → {midi,start,dur} seconds @ inferred tempo */
  function parseMidiSimple(bytes) {
    const notes = [];
    let i = 0;
    const rd = () => bytes[i++];
    const u32 = () => (rd() << 24) | (rd() << 16) | (rd() << 8) | rd();
    const u16 = () => (rd() << 8) | rd();
    if (String.fromCharCode(rd(), rd(), rd(), rd()) !== "MThd") return notes;
    const hdrLen = u32();
    i += 2; // format
    const ntrks = u16();
    const division = u16();
    i = 8 + hdrLen; // safety
    // re-find tracks from start
    i = 0;
    // skip header properly
    i = 4; // after MThd already consumed wrongly — restart
    i = 0;
    function match(str) {
      return (
        bytes[i] === str.charCodeAt(0) &&
        bytes[i + 1] === str.charCodeAt(1) &&
        bytes[i + 2] === str.charCodeAt(2) &&
        bytes[i + 3] === str.charCodeAt(3)
      );
    }
    if (!match("MThd")) return notes;
    i += 4;
    const hlen = u32();
    i += 2;
    const tracks = u16();
    const div = u16();
    i = 8 + hlen;
    let tempo = 500000; // us per quarter
    const tpq = div & 0x8000 ? 480 : div;

    function readVar() {
      let v = 0;
      for (;;) {
        const b = rd();
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
      }
      return v;
    }

    for (let t = 0; t < tracks && i < bytes.length; t++) {
      if (i + 8 > bytes.length) break;
      if (!match("MTrk")) {
        // scan forward
        let found = false;
        while (i < bytes.length - 4) {
          if (match("MTrk")) {
            found = true;
            break;
          }
          i++;
        }
        if (!found) break;
      }
      i += 4;
      const tlen = u32();
      const end = i + tlen;
      let abs = 0;
      let running = 0;
      const active = new Map();
      while (i < end && i < bytes.length) {
        abs += readVar();
        let status = bytes[i];
        if (status < 0x80) {
          status = running;
        } else {
          i++;
          running = status;
        }
        const type = status & 0xf0;
        if (status === 0xff) {
          const meta = rd();
          const len = readVar();
          if (meta === 0x51 && len === 3) {
            tempo = (rd() << 16) | (rd() << 8) | rd();
          } else {
            i += len;
          }
        } else if (status === 0xf0 || status === 0xf7) {
          const len = readVar();
          i += len;
        } else if (type === 0x90 || type === 0x80) {
          const note = rd();
          const vel = rd();
          const sec = (abs * tempo) / tpq / 1e6;
          if (type === 0x90 && vel > 0) {
            active.set(note, sec);
          } else {
            const start = active.get(note);
            if (start != null) {
              notes.push({ midi: note, start, dur: Math.max(0.05, sec - start) });
              active.delete(note);
            }
          }
        } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) {
          i += 2;
        } else if (type === 0xc0 || type === 0xd0) {
          i += 1;
        } else {
          break;
        }
      }
      i = end;
    }
    notes.sort((a, b) => a.start - b.start);
    return notes;
  }

  function updatePlayIcons(playing) {
    $("iconPlay").classList.toggle("hidden", playing);
    $("iconPause").classList.toggle("hidden", !playing);
  }

  engine.onEnded = () => {
    updatePlayIcons(false);
    if (state.loop) {
      playIndex(state.index);
      return;
    }
    nextTrack();
  };

  function nextTrack() {
    if (!state.playlist.length) return;
    if (state.shuffle) {
      playIndex(Math.floor(Math.random() * state.playlist.length));
      return;
    }
    const n = state.index + 1;
    if (n < state.playlist.length) playIndex(n);
  }

  function prevTrack() {
    if (!state.playlist.length) return;
    playIndex(Math.max(0, state.index - 1));
  }

  // ---- Transport ----
  $("btnPlay").addEventListener("click", async () => {
    await engine.ensure();
    if (engine.playing) {
      engine.pause();
      updatePlayIcons(false);
    } else if (engine.buffer) {
      engine.play();
      updatePlayIcons(true);
    } else if (state.playlist.length) {
      playIndex(Math.max(0, state.index));
    } else if (state.library.length) {
      addToPlaylist(state.library[0], true);
    }
  });

  document.querySelectorAll(".orbit-knob").forEach((btn) => {
    btn.addEventListener("click", () => {
      const a = btn.dataset.orbit;
      if (a === "prev") prevTrack();
      if (a === "loop") {
        state.loop = !state.loop;
        engine.setLoop(state.loop);
        btn.classList.toggle("on", state.loop);
      }
      if (a === "shuffle") {
        state.shuffle = !state.shuffle;
        btn.classList.toggle("on", state.shuffle);
      }
      if (a === "speed") {
        const rates = [1, 1.25, 0.75, 1.5];
        const cur = rates.indexOf(engine.rate);
        engine.setRate(rates[(cur + 1) % rates.length]);
        btn.querySelector("span").textContent = engine.rate.toFixed(2).replace(/0$/, "") + "x";
        btn.classList.toggle("on", engine.rate !== 1);
      }
      if (a === "volume") {
        const v = state.params.volume > 0.05 ? 0 : 0.85;
        state.params.volume = v;
        engine.setGain(v);
      }
    });
  });

  $("progressTrack").addEventListener("click", (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = (e.clientX - rect.left) / rect.width;
    engine.seek(t * engine.duration());
  });

  function tickUI() {
    const dur = engine.duration();
    const cur = engine.currentTime();
    if (dur > 0) {
      progressFill.style.width = (100 * cur) / dur + "%";
      timeLeft.textContent = "- " + fmt(Math.max(0, dur - cur));
    }
    requestAnimationFrame(tickUI);
  }
  tickUI();

  // ---- Library loading ----
  async function loadLibrary() {
    const cat = fileType.value === "all" ? "" : fileType.value;
    const q = searchInput.value.trim();
    let url = "/api/library?limit=300";
    if (cat) url += "&category=" + encodeURIComponent(cat);
    if (q) url += "&q=" + encodeURIComponent(q);
    try {
      const data = await api(url);
      state.library = data.items || [];
      $("pillCount").textContent = state.library.length + " files";
      // If browser category set, prefer that view
      await loadBrowser();
      setAi("Library · " + state.library.length + " media files indexed");
    } catch (e) {
      setAi("Library offline — is Music Brain serving?");
    }
  }

  async function loadBrowser() {
    const cat = state.browserCat;
    const q = searchInput.value.trim();
    let url = "/api/library?limit=200&category=" + encodeURIComponent(cat);
    if (q) url += "&q=" + encodeURIComponent(q);
    try {
      const data = await api(url);
      renderBrowser(data.items || []);
    } catch (_) {
      renderBrowser([]);
    }
  }

  document.querySelectorAll("#browserCats .cat").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#browserCats .cat").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.browserCat = btn.dataset.cat;
      loadBrowser();
    });
  });

  fileType.addEventListener("change", loadLibrary);
  $("btnSearch").addEventListener("click", () => {
    loadLibrary();
    loadBrowser();
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      loadLibrary();
      loadBrowser();
    }
  });

  $("btnAdd").addEventListener("click", async () => {
    // add first selected browser / or open file picker fallback
    const first = browserList.querySelector("li");
    if (state.library.length) addToPlaylist(state.library[0], false);
    else setAi("Nothing to add — index media first");
  });
  $("btnRemove").addEventListener("click", () => {
    if (state.index < 0) return;
    state.playlist.splice(state.index, 1);
    state.index = Math.min(state.index, state.playlist.length - 1);
    renderPlaylist();
  });
  $("btnClear").addEventListener("click", () => {
    state.playlist = [];
    state.index = -1;
    renderPlaylist();
    engine.stop();
    updatePlayIcons(false);
  });

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const p = btn.dataset.panel;
      if (p === "library") loadLibrary();
      if (p === "playlist") playlistEl.scrollIntoView({ behavior: "smooth", block: "center" });
      if (p === "eq") document.querySelector(".eq-mod")?.scrollIntoView({ behavior: "smooth" });
    });
  });

  // Output devices (best-effort)
  async function loadOutputs() {
    const sel = $("outputDevice");
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outs = devices.filter((d) => d.kind === "audiooutput");
      if (!outs.length) return;
      sel.innerHTML = "";
      outs.forEach((d, i) => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label || "Output " + (i + 1);
        sel.appendChild(opt);
      });
    } catch (_) {}
  }

  async function postState() {
    try {
      await fetch("/api/remote/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playing: !!engine.playing,
          title: npTitle.textContent,
          path: state.index >= 0 ? state.playlist[state.index]?.path : null,
          position: engine.currentTime(),
          duration: engine.duration(),
          volume: state.params.gain ?? state.params.volume ?? 0.85,
        }),
      });
    } catch (_) {}
  }

  let lastCmdId = 0;
  async function pollRemote() {
    try {
      const data = await api("/api/remote/poll?after=" + lastCmdId);
      for (const c of data.commands || []) {
        lastCmdId = Math.max(lastCmdId, c.id);
        const a = c.action;
        const p = c.payload || {};
        if (a === "toggle") $("btnPlay").click();
        else if (a === "play") {
          if (!engine.playing) $("btnPlay").click();
        } else if (a === "pause") {
          if (engine.playing) {
            engine.pause();
            updatePlayIcons(false);
          }
        } else if (a === "next") nextTrack();
        else if (a === "prev") prevTrack();
        else if (a === "stop") {
          engine.stop();
          updatePlayIcons(false);
        } else if (a === "volume" && p.volume != null) {
          engine.setGain(Number(p.volume));
          state.params.gain = Number(p.volume);
        } else if (a === "seek" && p.seconds != null) {
          engine.seek(Number(p.seconds));
        } else if (a === "play_path" && p.path) {
          playItem({
            path: p.path,
            name: p.path.split(/[/\\]/).pop(),
            stem: (p.path.split(/[/\\]/).pop() || "").replace(/\.[^.]+$/, ""),
            extension: (p.path.match(/\.[^.]+$/) || [""])[0],
          });
        } else if (a === "add_path" && p.path) {
          addToPlaylist(
            {
              path: p.path,
              name: p.path.split(/[/\\]/).pop(),
              stem: (p.path.split(/[/\\]/).pop() || "").replace(/\.[^.]+$/, ""),
            },
            false
          );
        }
      }
      await postState();
    } catch (_) {}
  }

  async function boot() {
    setAi("SHIBASS S1 starting...");
    // Do NOT block UI on full-drive index
    await loadLibrary();
    await loadOutputs();
    try {
      const health = await api("/health");
      if (health.ok) setAi("SHIBASS S1 online - Rokid: /remote");
    } catch (_) {
      setAi("Waiting for server...");
    }
    setInterval(pollRemote, 800);
  }

  boot();
})();
