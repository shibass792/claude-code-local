window.MB = window.MB || {};

MB.Search = {
  async run(query, containerId) {
    const el = document.getElementById(containerId || "search-results");
    if (!query || !el) return;
    const data = await MB.API.search(query);
    if (!data.results.length) {
      el.innerHTML = "<p>לא נמצאו תוצאות</p>";
      return;
    }
    let html =
      "<table><tr><th></th><th>קובץ</th><th>סגנון</th><th>BPM</th><th>Key</th><th>ציון</th></tr>";
    data.results.forEach((r) => {
      const name = MB.basename(r.path);
      html += `<tr data-id="${r.file_id}"><td><button type="button" class="play-btn" data-play-id="${r.file_id}">▶</button></td>
        <td>${MB.esc(name)}</td><td>${MB.esc(r.sub_style || "-")}</td>
        <td>${r.bpm || "-"}</td><td>${r.key || "-"}</td><td>${r.score.toFixed(2)}</td></tr>`;
    });
    html += "</table>";
    el.innerHTML = html;
    el.querySelectorAll("[data-play-id]").forEach((btn) => {
      btn.onclick = () => {
        const item = data.results.find(
          (r) => String(r.file_id) === btn.dataset.playId
        );
        if (!item?.file_id) return;
        const idx = MB.Player.queue.findIndex((r) => r.file_id === item.file_id);
        if (idx >= 0) {
          MB.Player.playAt(idx);
          return;
        }
        MB.Player.setQueue([item], false);
        MB.Player.playAt(MB.Player.queue.length - 1);
      };
    });
  },
};
