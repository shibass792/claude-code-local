/** MIDI FORGE — transformation & song expansion panel (SHIBASS S1). */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const modal = $("forgeModal");
  if (!modal) return;

  const state = {
    path: null,
    name: null,
    analysis: null,
    lastLayers: null,
    previewEngine: null,
  };

  function engine() {
    if (!state.previewEngine && window.ShibassAudio) {
      state.previewEngine = new window.ShibassAudio();
    }
    return state.previewEngine;
  }

  function setStatus(msg, kind) {
    const el = $("forgeStatus");
    if (!el) return;
    el.textContent = msg;
    el.className = "forge-status" + (kind ? " " + kind : "");
  }

  function open(item) {
    if (item && item.path) {
      state.path = item.path;
      state.name = item.name || item.path;
    }
    modal.classList.add("open");
    $("forgeFile").textContent = state.name || "— pick a MIDI file in the BROWSER —";
    if (state.path) analyze();
    else setStatus("Select a .mid file in the BROWSER panel, then reopen MIDI FORGE.", "warn");
  }

  function close() {
    modal.classList.remove("open");
    stopPreview();
  }

  function stopPreview() {
    const e = engine();
    if (e) { try { e.stop(); } catch (_) {} }
  }

  async function jsonGet(url) {
    const r = await fetch(url);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || r.status);
    return d;
  }

  async function jsonPost(url, body) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || r.status);
    return d;
  }

  function params() {
    const checked = Array.from(
      document.querySelectorAll("#forgeTransforms input[type=checkbox]:checked")
    ).map((c) => c.value);
    return {
      path: state.path,
      transforms: checked,
      complexity: Number($("forgeComplexity").value) / 100,
      mutation_rate: Number($("forgeMutation").value) / 100,
      scale_lock: $("forgeScaleLock").checked,
      octave_double: $("forgeOctave").checked,
      invert: $("forgeInvert").checked,
      pad_rhythmic: $("forgePadRhythmic").checked,
      bass_style: $("forgeBassStyle").value,
      template: $("forgeTemplate").value,
      bars: Number($("forgeBars").value) || undefined,
      seed: Number($("forgeSeed").value) || 0,
    };
  }

  // ---- Analyze ----
  async function analyze() {
    if (!state.path) return;
    setStatus("Analyzing MIDI DNA…");
    try {
      const d = await jsonGet("/api/midi/analyze?path=" + encodeURIComponent(state.path));
      state.analysis = d.analysis;
      renderAnalysis(d.analysis);
      const barsInput = $("forgeBars");
      if (barsInput && !barsInput.dataset.touched) barsInput.value = d.analysis.bars;
      setStatus(
        `${d.analysis.key} · ${d.analysis.bpm} BPM · ${d.analysis.bars} bars · ${d.analysis.density}`,
        "ok"
      );
    } catch (e) {
      setStatus("Analyze failed: " + e.message, "err");
    }
  }

  function renderAnalysis(a) {
    const box = $("forgeAnalysis");
    if (!box) return;
    const roleColor = {
      lead: "#3de7ff", bass: "#8de9a8", arp: "#ffd166",
      pad: "#c792ea", drums: "#ff8fa3", counter: "#7ee8fa",
    };
    const rows = (a.tracks || [])
      .map(
        (t) => `<tr>
          <td>${t.index + 1}</td>
          <td title="${t.name}">${t.name.slice(0, 22)}</td>
          <td><b style="color:${roleColor[t.role] || "#7eb8c8"}">${t.role}</b></td>
          <td>${t.note_count}</td>
          <td>${t.notes_per_bar}</td>
          <td>${t.velocity.mean}</td>
          <td>${t.groove.is_quantized ? "grid" : t.groove.timing_deviation_ms + "ms"}</td>
        </tr>`
      )
      .join("");

    const prog = (a.root_progression || [])
      .slice(0, 16)
      .map((p) => p.root_name || "–")
      .join(" → ");

    box.innerHTML = `
      <div class="forge-kpis">
        <span><b>${a.key}</b><small>key · ${Math.round(a.key_confidence * 100)}%</small></span>
        <span><b>${a.bpm}</b><small>BPM</small></span>
        <span><b>${a.bars}</b><small>bars</small></span>
        <span><b>${a.time_signature}</b><small>meter</small></span>
        <span><b>${a.density}</b><small>density</small></span>
      </div>
      <table class="forge-table">
        <thead><tr><th>#</th><th>Track</th><th>Role</th><th>Notes</th><th>/bar</th><th>Vel</th><th>Timing</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7">no tracks</td></tr>'}</tbody>
      </table>
      <div class="forge-prog"><b>Roots:</b> ${prog || "—"}</div>`;
  }

  // ---- Preview ----
  async function playNotes(notes) {
    const e = engine();
    if (!e || !notes || !notes.length) {
      setStatus("Nothing to preview.", "warn");
      return;
    }
    await e.ensure();
    e.stop();
    e.playMidiNotes(notes.slice(0, 260));
    const last = notes[Math.min(notes.length, 260) - 1];
    const ms = (last.start + last.dur) * 1000 + 200;
    setStatus(`Previewing ${notes.length} notes…`, "ok");
    setTimeout(() => setStatus("Preview done.", "ok"), Math.min(ms, 30000));
  }

  async function previewOriginal() {
    if (!state.path) return setStatus("No file selected.", "warn");
    setStatus("Loading original…");
    try {
      const d = await jsonGet("/api/midi/preview?path=" + encodeURIComponent(state.path));
      await playNotes(d.notes);
    } catch (e) {
      setStatus("Preview failed: " + e.message, "err");
    }
  }

  async function previewGenerated() {
    if (!state.path) return setStatus("No file selected.", "warn");
    const layer = $("forgePreviewLayer").value;
    setStatus("Generating " + layer + "…");
    try {
      const body = params();
      body.preview = layer;
      const d = await jsonPost("/api/midi/transform", body);
      state.lastLayers = d.layers;
      const pv = (d.previews || {})[layer];
      if (!pv) return setStatus(`Layer "${layer}" not generated — enable it above.`, "warn");
      renderLayerCounts(d.layers);
      await playNotes(pv.notes);
    } catch (e) {
      setStatus("Transform failed: " + e.message, "err");
    }
  }

  function renderLayerCounts(layers) {
    const el = $("forgeLayers");
    if (!el || !layers) return;
    el.innerHTML = Object.entries(layers)
      .map(([k, v]) => `<span class="forge-chip">${k}<b>${v}</b></span>`)
      .join("");
  }

  // ---- Export ----
  async function exportProject() {
    if (!state.path) return setStatus("No file selected.", "warn");
    const btn = $("forgeExport");
    btn.disabled = true;
    setStatus("Generating layers and writing Cubase folder…");
    try {
      const d = await jsonPost("/api/midi/export", params());
      renderLayerCounts(state.lastLayers || {});
      const files = (d.files || []).map((f) => `<li><code>${f.file}</code> · ${f.notes} notes</li>`).join("");
      $("forgeResult").innerHTML = `
        <div class="forge-ok">Exported ${d.file_count} files · ${d.arrangement.total_bars} bars · ~${d.arrangement.approx_duration}</div>
        <div class="forge-path" title="click to copy">${d.project_dir}</div>
        <ul class="forge-files">${files}</ul>
        <div class="forge-hint">Set Cubase to <b>${d.bpm} BPM</b> (${d.key}) before dragging the folder in. Read <code>ARRANGEMENT_GUIDE.md</code> for the section map.</div>`;
      const pathEl = document.querySelector(".forge-path");
      if (pathEl) {
        pathEl.addEventListener("click", () => {
          navigator.clipboard?.writeText(d.project_dir);
          setStatus("Folder path copied to clipboard.", "ok");
        });
      }
      setStatus("Export complete.", "ok");
    } catch (e) {
      setStatus("Export failed: " + e.message, "err");
    }
    btn.disabled = false;
  }

  // ---- Wiring ----
  $("forgeClose").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("open")) close();
  });

  $("forgeAnalyze").addEventListener("click", analyze);
  $("forgePreviewOrig").addEventListener("click", previewOriginal);
  $("forgePreviewGen").addEventListener("click", previewGenerated);
  $("forgeStop").addEventListener("click", () => { stopPreview(); setStatus("Stopped."); });
  $("forgeExport").addEventListener("click", exportProject);
  $("forgeBars").addEventListener("input", (e) => { e.target.dataset.touched = "1"; });

  ["forgeComplexity", "forgeMutation"].forEach((id) => {
    const el = $(id);
    const out = $(id + "Val");
    const sync = () => { if (out) out.textContent = el.value + "%"; };
    el.addEventListener("input", sync);
    sync();
  });

  // Public hook so app.js can hand us the selected browser item
  window.MidiForge = {
    open,
    close,
    setFile(item) {
      state.path = item.path;
      state.name = item.name || item.path;
      const f = $("forgeFile");
      if (f) f.textContent = state.name;
    },
  };

  const navBtn = document.querySelector('.nav-btn[data-panel="forge"]');
  if (navBtn) navBtn.addEventListener("click", () => open());
})();
