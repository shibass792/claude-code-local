"""Local web UI — search, stats, Cubase recommendations."""

from __future__ import annotations

import json
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from music_brain.brain.learner import Brain
from music_brain.bridge.cubase_bridge import CubaseBridge
from music_brain.database.knowledge_db import KnowledgeDB
from music_brain.matcher.engine import MatcherEngine
from music_brain.search.ai_search import AISearch

INDEX_HTML = """<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Music Brain</title>
  <style>
    :root { --bg:#0d0d12; --card:#1a1a24; --accent:#7c5cff; --text:#e8e8f0; --muted:#888; }
    * { box-sizing:border-box; }
    body { font-family: system-ui, sans-serif; background:var(--bg); color:var(--text);
           margin:0; padding:1.5rem; max-width:960px; margin-inline:auto; }
    h1 { font-size:1.5rem; margin-bottom:0.25rem; }
    .sub { color:var(--muted); margin-bottom:1.5rem; }
    .card { background:var(--card); border-radius:12px; padding:1rem 1.25rem; margin-bottom:1rem; }
    input, button { font-size:1rem; padding:0.6rem 1rem; border-radius:8px; border:1px solid #333; }
    input { flex:1; background:#111; color:var(--text); width:100%; }
    button { background:var(--accent); color:#fff; border:none; cursor:pointer; margin-top:0.5rem; }
    button:hover { filter:brightness(1.1); }
    .row { display:flex; gap:0.5rem; flex-wrap:wrap; }
    table { width:100%; border-collapse:collapse; font-size:0.85rem; }
    th, td { text-align:right; padding:0.4rem 0.5rem; border-bottom:1px solid #2a2a35; }
    th { color:var(--muted); font-weight:500; }
    .tag { display:inline-block; background:#2a2540; color:#b8a8ff; padding:0.15rem 0.5rem;
           border-radius:4px; font-size:0.75rem; margin-left:0.25rem; }
    pre { background:#111; padding:0.75rem; border-radius:8px; overflow:auto; font-size:0.8rem; }
    .stats-grid { display:grid; grid-template-columns:1fr 1fr; gap:1rem; }
    @media(max-width:600px){ .stats-grid { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <h1>🧠 Music Brain</h1>
  <p class="sub">חיפוש AI · סטטיסטיקות · Cubase</p>

  <div class="card">
    <label>חיפוש (לדוגמה: באס כמו Astrix, kick 145 full on)</label>
    <div class="row" style="margin-top:0.5rem">
      <input id="q" placeholder="אני רוצה באס כמו Astrix..." />
    </div>
    <button onclick="doSearch()">חפש בספריות שלי</button>
    <div id="search-results" style="margin-top:1rem"></div>
  </div>

  <div class="stats-grid">
    <div class="card">
      <strong>שימוש בפלאגינים</strong>
      <div id="plugins" style="margin-top:0.5rem"></div>
      <button onclick="loadStats()">רענן סטטיסטיקות</button>
    </div>
    <div class="card">
      <strong>BPM & Key</strong>
      <div id="bpmkey" style="margin-top:0.5rem"></div>
    </div>
  </div>

  <div class="card">
    <strong>Cubase — המלצות לפרויקט</strong>
    <input id="cpr" placeholder="D:\\Projects\\Track.cpr" style="margin-top:0.5rem"/>
    <button onclick="doCubase()">נתח פרויקט</button>
    <pre id="cubase-out" style="margin-top:0.75rem;display:none"></pre>
  </div>

<script>
async function api(path) {
  const r = await fetch(path);
  return r.json();
}
function esc(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
async function doSearch(){
  const q = document.getElementById('q').value;
  if(!q) return;
  const data = await api('/api/search?q='+encodeURIComponent(q));
  const el = document.getElementById('search-results');
  if(!data.results.length){ el.innerHTML='<p>לא נמצאו תוצאות</p>'; return; }
  let html = '<table><tr><th>קובץ</th><th>סגנון</th><th>BPM</th><th>Key</th><th>ציון</th></tr>';
  for(const r of data.results){
    const name = r.path.split(/[\\\\/]/).pop();
    html += `<tr><td>${esc(name)}</td><td>${esc(r.sub_style||'-')}</td>
      <td>${r.bpm||'-'}</td><td>${r.key||'-'}</td><td>${r.score.toFixed(2)}</td></tr>`;
  }
  html += '</table>';
  el.innerHTML = html;
}
async function loadStats(){
  const data = await api('/api/stats');
  let ph = '';
  for(const p of (data.plugins||[]).slice(0,8)){
    ph += `<div>${esc(p.name)} <span class="tag">${p.percent}%</span></div>`;
  }
  document.getElementById('plugins').innerHTML = ph || '<span class="sub">אין עדיין נתונים — הרץ scan</span>';
  let bk = '';
  for(const b of (data.top_bpms||[]).slice(0,3))
    bk += `<div>${b.bpm} BPM <span class="tag">${b.percent}%</span></div>`;
  for(const k of (data.top_keys||[]).slice(0,3))
    bk += `<div>${k.key} <span class="tag">${k.percent}%</span></div>`;
  document.getElementById('bpmkey').innerHTML = bk || '<span class="sub">—</span>';
}
async function doCubase(){
  const p = document.getElementById('cpr').value;
  if(!p) return;
  const data = await api('/api/cubase?path='+encodeURIComponent(p));
  const pre = document.getElementById('cubase-out');
  pre.style.display='block';
  pre.textContent = data.message_he + '\\n\\n' + JSON.stringify(data, null, 2);
}
loadStats();
</script>
</body>
</html>
"""


def create_handler(
    db: KnowledgeDB,
    cfg: dict[str, Any],
) -> type[BaseHTTPRequestHandler]:
    matcher = MatcherEngine(db, cfg.get("matcher_weights"))
    brain = Brain(db)
    search = AISearch(db, matcher)
    bridge_cfg = cfg.get("cubase_bridge", {})
    bridge = CubaseBridge(
        db, matcher, brain,
        enabled=bridge_cfg.get("enabled", False),
        osc_host=bridge_cfg.get("osc_host", "127.0.0.1"),
        osc_port=bridge_cfg.get("osc_port", 9000),
    )

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:
            pass  # quiet

        def _json(self, data: Any, status: int = 200) -> None:
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _html(self, html: str) -> None:
            body = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)

            if parsed.path in ("/", "/index.html"):
                self._html(INDEX_HTML)
                return

            if parsed.path == "/api/search":
                q = qs.get("q", [""])[0]
                results = search.search(q, limit=30)
                self._json({"query": q, "results": results})
                return

            if parsed.path == "/api/stats":
                usage = brain.get_plugin_usage_report()
                bpm_key = brain.get_bpm_key_report()
                counts = db.count_files()
                self._json({
                    "plugins": usage.get("plugins", []),
                    "top_bpms": bpm_key.get("top_bpms", []),
                    "top_keys": bpm_key.get("top_keys", []),
                    "file_counts": counts,
                })
                return

            if parsed.path == "/api/cubase":
                path = qs.get("path", [""])[0]
                if not path or not Path(path).exists():
                    self._json({"error": "path not found"}, 404)
                    return
                result = bridge.on_project_open(path)
                self._json(result)
                return

            if parsed.path == "/api/status":
                self._json({
                    "files": db.count_files(),
                    "unanalyzed": len(db.get_unanalyzed_files(limit=10000)),
                    "projects": db.get_project_stats(),
                })
                return

            self._json({"error": "not found"}, 404)

    return Handler


def serve(
    db: KnowledgeDB,
    cfg: dict[str, Any],
    host: str = "127.0.0.1",
    port: int = 8787,
) -> None:
    handler = create_handler(db, cfg)
    server = ThreadingHTTPServer((host, port), handler)
    print(f"Music Brain UI → http://{host}:{port}")
    server.serve_forever()
