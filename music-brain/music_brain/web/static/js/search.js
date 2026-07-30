window.MB = window.MB || {};

MB.Search = {
  async run(query, containerId) {
    const el = document.getElementById(containerId || "search-results");
    if (!query || !el) return;
    MB.Player.init();
    const data = await MB.API.search(query);
    if (!data.results.length) {
      el.innerHTML = "<p>לא נמצאו תוצאות</p>";
      MB.Player.setQueue([]);
      return;
    }
    MB.Player.setQueue(data.results);
    let html =
      "<table><tr><th></th><th>קובץ</th><th>סגנון</th><th>BPM</th><th>Key</th><th>ציון</th></tr>";
    data.results.forEach((r, i) => {
      const name = MB.basename(r.path);
      html += `<tr data-id="${r.file_id}"><td><button type="button" class="play-btn" data-play="${i}">▶</button></td>
        <td>${MB.esc(name)}</td><td>${MB.esc(r.sub_style || "-")}</td>
        <td>${r.bpm || "-"}</td><td>${r.key || "-"}</td><td>${r.score.toFixed(2)}</td></tr>`;
    });
    html += "</table>";
    el.innerHTML = html;
    el.querySelectorAll("[data-play]").forEach((btn) => {
      btn.onclick = () => MB.Player.playAt(Number(btn.dataset.play));
    });
  },
};
