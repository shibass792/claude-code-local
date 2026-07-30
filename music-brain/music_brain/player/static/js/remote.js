(function () {
  const status = document.getElementById("status");
  const title = document.getElementById("title");
  const meta = document.getElementById("meta");
  const results = document.getElementById("results");
  const btnToggle = document.getElementById("btnToggle");
  document.getElementById("host").textContent = location.host;

  async function cmd(action, payload) {
    const body = { action, payload: payload || {} };
    if (payload && payload.delta != null) body.payload = payload;
    const r = await fetch("/api/remote/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ action }, payload || {})),
    });
    return r.json();
  }

  async function refresh() {
    try {
      const r = await fetch("/api/remote/state");
      const s = await r.json();
      status.textContent = "online · " + location.host;
      title.textContent = s.title || "No track";
      meta.textContent = [s.path, s.playing ? "PLAYING" : "PAUSED"].filter(Boolean).join(" · ");
      btnToggle.textContent = s.playing ? "PAUSE" : "PLAY";
    } catch (e) {
      status.textContent = "offline - start MusicBrain-Serve.cmd on PC";
    }
  }

  document.querySelectorAll("[data-cmd]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.cmd;
      const payload = {};
      if (btn.dataset.delta) payload.delta = parseFloat(btn.dataset.delta);
      if (action === "volume") {
        // read current and nudge
        try {
          const s = await (await fetch("/api/remote/state")).json();
          const v = Math.max(0, Math.min(1.5, (s.volume || 0.85) + (payload.delta || 0)));
          await cmd("volume", { volume: v });
        } catch (_) {
          await cmd("volume", { volume: 0.85 });
        }
      } else {
        await cmd(action, payload);
      }
      refresh();
    });
  });

  async function search() {
    const q = document.getElementById("q").value.trim();
    const url = "/api/library?limit=40" + (q ? "&q=" + encodeURIComponent(q) : "");
    const data = await (await fetch(url)).json();
    results.innerHTML = "";
    (data.items || []).forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item.name;
      li.title = item.path;
      li.addEventListener("click", async () => {
        await cmd("play_path", { path: item.path });
        title.textContent = item.stem || item.name;
        meta.textContent = item.path;
        refresh();
      });
      results.appendChild(li);
    });
  }

  document.getElementById("btnSearch").addEventListener("click", search);
  document.getElementById("q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") search();
  });

  // Desktop panel will poll commands; remote also works standalone for search/play_path queue
  setInterval(refresh, 1500);
  refresh();
  search();
})();
