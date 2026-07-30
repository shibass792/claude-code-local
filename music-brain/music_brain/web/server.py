"""Local web UI — search, stats, Cubase recommendations, audio player."""

from __future__ import annotations

import json
import re
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from music_brain.brain.learner import Brain
from music_brain.bridge.cubase_bridge import CubaseBridge
from music_brain.database.knowledge_db import KnowledgeDB
from music_brain.matcher.engine import MatcherEngine
from music_brain.library.classifier import LIBRARY_LABELS_HE, SAMPLE_SUB_LABELS_HE
from music_brain.search.ai_search import AISearch
from music_brain.web.audio_stream import (
    mime_for_path,
    read_file_range,
    resolve_indexed_file,
)

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
           margin:0; padding:1.5rem; padding-bottom:6.5rem; max-width:960px; margin-inline:auto; }
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
    .play-btn { background:#2a2540; color:#b8a8ff; border:none; border-radius:6px;
                padding:0.25rem 0.55rem; cursor:pointer; font-size:0.85rem; margin-top:0; }
    .play-btn:hover { filter:brightness(1.15); }
    tr.playing td { background:#221f33; }
    #player-bar { position:fixed; left:0; right:0; bottom:0; background:#14141c;
                  border-top:1px solid #2a2a35; padding:0.75rem 1rem; display:none;
                  align-items:center; gap:1rem; z-index:100; }
    #player-bar.active { display:flex; }
    #player-meta { flex:1; min-width:0; }
    #player-title { font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    #player-sub { color:var(--muted); font-size:0.8rem; margin-top:0.15rem; }
    #player-audio { flex:2; min-width:180px; max-width:480px; height:36px; }
    #player-controls button { margin-top:0; margin-inline:0.15rem; padding:0.45rem 0.75rem; }
    .lib-tabs, .sub-tabs { display:flex; flex-wrap:wrap; gap:0.4rem; margin-top:0.5rem; }
    .lib-tab, .sub-tab { background:#2a2540; color:#b8a8ff; border:none; border-radius:8px;
                          padding:0.45rem 0.85rem; cursor:pointer; font-size:0.85rem; margin-top:0; }
    .lib-tab.active, .sub-tab.active { background:var(--accent); color:#fff; }
    .lib-count { opacity:0.7; font-size:0.75rem; margin-inline-start:0.25rem; }
  </style>
</head>
<body>
  <h1>🧠 Music Brain</h1>
  <p class="sub">ספריות · חיפוש AI · נגן · Cubase</p>

  <div class="card" id="library-card">
    <strong>הספריות שלי</strong>
    <p class="sub" id="lib-summary" style="margin:0.5rem 0">טוען...</p>
    <div class="lib-tabs" id="lib-tabs"></div>
    <div class="sub-tabs" id="sub-tabs" style="display:none"></div>
    <div id="browse-results" style="margin-top:1rem"></div>
    <button onclick="loadMoreBrowse()" id="btn-more" style="display:none">טען עוד</button>
  </div>

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

  <div id="player-bar">
    <div id="player-meta">
      <div id="player-title">—</div>
      <div id="player-sub">—</div>
    </div>
    <audio id="player-audio" controls preload="metadata"></audio>
    <div id="player-controls">
      <button onclick="playPrev()">⏮</button>
      <button onclick="togglePlay()" id="btn-toggle">⏸</button>
      <button onclick="playNext()">⏭</button>
    </div>
  </div>

  <div class="card">
    <strong>Cubase — המלצות לפרויקט</strong>
    <input id="cpr" placeholder="D:\\Projects\\Track.cpr" style="margin-top:0.5rem"/>
    <button onclick="doCubase()">נתח פרויקט</button>
    <pre id="cubase-out" style="margin-top:0.75rem;display:none"></pre>
  </div>

<script>
let queue = [];
let queueIndex = -1;
let currentLibrary = 'music';
let currentSub = null;
let browseOffset = 0;
let browseItems = [];
const browsePage = 80;
const audio = () => document.getElementById('player-audio');

async function api(path) {
  const r = await fetch(path);
  return r.json();
}
function esc(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function basename(p){ return p.split(/[\\\\/]/).pop(); }

function highlightRow(fileId){
  document.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.classList.toggle('playing', tr.dataset.id === String(fileId));
  });
}

function showPlayer(meta){
  document.getElementById('player-bar').classList.add('active');
  document.getElementById('player-title').textContent = meta.name || '—';
  const bits = [meta.sub_style, meta.bpm ? meta.bpm+' BPM' : null, meta.key].filter(Boolean);
  document.getElementById('player-sub').textContent = bits.join(' · ') || meta.path || '—';
}

async function playFileId(fileId, meta){
  if(!fileId) return;
  const a = audio();
  a.src = '/api/stream/' + fileId;
  showPlayer(meta || { name: 'קובץ #'+fileId });
  highlightRow(fileId);
  try { await a.play(); } catch(e) {}
  document.getElementById('btn-toggle').textContent = '⏸';
}

function playAt(index){
  if(index < 0 || index >= queue.length) return;
  queueIndex = index;
  const item = queue[index];
  playFileId(item.file_id, {
    name: basename(item.path),
    path: item.path,
    sub_style: item.sub_style,
    bpm: item.bpm,
    key: item.key,
  });
}

function playNext(){ if(queue.length) playAt((queueIndex + 1) % queue.length); }
function playPrev(){ if(queue.length) playAt((queueIndex - 1 + queue.length) % queue.length); }
function togglePlay(){
  const a = audio();
  if(a.paused){ a.play(); document.getElementById('btn-toggle').textContent = '⏸'; }
  else { a.pause(); document.getElementById('btn-toggle').textContent = '▶'; }
}

audio().addEventListener('ended', () => playNext());
audio().addEventListener('play', () => { document.getElementById('btn-toggle').textContent = '⏸'; });
audio().addEventListener('pause', () => { document.getElementById('btn-toggle').textContent = '▶'; });

function renderBrowseTable(){
  const el = document.getElementById('browse-results');
  queue = browseItems.filter(r => r.file_id);
  if(!browseItems.length){
    el.innerHTML = '<p class="sub">אין קבצים בספרייה זו — הרץ music-brain pipeline</p>';
    return;
  }
  let html = '<table><tr><th></th><th>קובץ</th><th>תיקייה</th><th>BPM</th><th>Key</th></tr>';
  browseItems.forEach((r, i) => {
    const name = basename(r.path);
    const folder = r.library_sub || '-';
    html += `<tr data-id="${r.file_id}"><td><button class="play-btn" onclick="playAt(${i})">▶</button></td>
      <td title="${esc(r.path)}">${esc(name)}</td><td>${esc(folder)}</td>
      <td>${r.bpm||'-'}</td><td>${r.key||'-'}</td></tr>`;
  });
  html += '</table>';
  el.innerHTML = html;
}

async function loadLibraries(){
  const data = await api('/api/libraries');
  document.getElementById('lib-summary').textContent =
    `${data.total.toLocaleString()} קבצי שמיעה באינדקס`;
  const tabs = document.getElementById('lib-tabs');
  tabs.innerHTML = '';
  for(const lib of data.libraries){
    const btn = document.createElement('button');
    btn.className = 'lib-tab' + (lib.id === currentLibrary ? ' active' : '');
    btn.innerHTML = `${esc(lib.label)}<span class="lib-count">${lib.total}</span>`;
    btn.onclick = () => selectLibrary(lib.id);
    tabs.appendChild(btn);
  }
  renderSubTabs(data.libraries.find(l => l.id === currentLibrary));
  await browseLibrary(true);
}

function renderSubTabs(lib){
  const box = document.getElementById('sub-tabs');
  box.innerHTML = '';
  if(!lib || !lib.subs.length){
    box.style.display = 'none';
    currentSub = null;
    return;
  }
  box.style.display = 'flex';
  const allBtn = document.createElement('button');
  allBtn.className = 'sub-tab' + (!currentSub ? ' active' : '');
  allBtn.textContent = 'הכל';
  allBtn.onclick = () => { currentSub = null; updateSubActive(); browseLibrary(true); };
  box.appendChild(allBtn);
  for(const sub of lib.subs){
    const btn = document.createElement('button');
    btn.className = 'sub-tab' + (currentSub === sub.id ? ' active' : '');
    btn.innerHTML = `${esc(sub.label)}<span class="lib-count">${sub.count}</span>`;
    btn.onclick = () => { currentSub = sub.id; updateSubActive(); browseLibrary(true); };
    box.appendChild(btn);
  }
}

function updateSubActive(){
  document.querySelectorAll('.sub-tab').forEach((b,i) => {
    const isAll = i === 0 && !currentSub;
    const match = currentSub && b.textContent.includes(currentSub);
    b.classList.toggle('active', isAll || !!match);
  });
}

async function selectLibrary(id){
  currentLibrary = id;
  currentSub = null;
  const data = await api('/api/libraries');
  document.querySelectorAll('.lib-tab').forEach((b, i) => {
    b.classList.toggle('active', data.libraries[i].id === id);
  });
  renderSubTabs(data.libraries.find(l => l.id === id));
  await browseLibrary(true);
}

async function browseLibrary(reset){
  if(reset){
    browseOffset = 0;
    browseItems = [];
  }
  let url = `/api/browse?library=${encodeURIComponent(currentLibrary)}&offset=${browseOffset}&limit=${browsePage}`;
  if(currentSub) url += `&sub=${encodeURIComponent(currentSub)}`;
  const data = await api(url);
  browseItems = browseItems.concat(data.items);
  browseOffset += data.items.length;
  renderBrowseTable();
  document.getElementById('btn-more').style.display = data.has_more ? 'inline-block' : 'none';
}

function loadMoreBrowse(){ browseLibrary(false); }

async function doSearch(){
  const q = document.getElementById('q').value;
  if(!q) return;
  const data = await api('/api/search?q='+encodeURIComponent(q));
  const el = document.getElementById('search-results');
  if(!data.results.length){ el.innerHTML='<p>לא נמצאו תוצאות</p>'; queue=[]; return; }
  queue = data.results.filter(r => r.file_id);
  let html = '<table><tr><th></th><th>קובץ</th><th>סגנון</th><th>BPM</th><th>Key</th><th>ציון</th></tr>';
  queue.forEach((r, i) => {
    const name = basename(r.path);
    html += `<tr data-id="${r.file_id}"><td><button class="play-btn" onclick="playAt(${i})">▶</button></td>
      <td>${esc(name)}</td><td>${esc(r.sub_style||'-')}</td>
      <td>${r.bpm||'-'}</td><td>${r.key||'-'}</td><td>${r.score.toFixed(2)}</td></tr>`;
  });
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
loadLibraries();
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

        def _parse_range(self, range_header: str, size: int) -> tuple[int, int] | None:
            match = re.match(r"bytes=(\d*)-(\d*)", range_header.strip())
            if not match:
                return None
            start_s, end_s = match.groups()
            if start_s == "" and end_s == "":
                return None
            if start_s == "":
                suffix = int(end_s)
                start = max(0, size - suffix)
                end = size - 1
            else:
                start = int(start_s)
                end = int(end_s) if end_s else size - 1
            if start >= size:
                return None
            end = min(end, size - 1)
            if start > end:
                return None
            return start, end

        def _stream_file(self, file_id: int) -> None:
            path = resolve_indexed_file(db, file_id)
            if path is None:
                self._json({"error": "file not found"}, 404)
                return

            size = path.stat().st_size
            mime = mime_for_path(path)
            range_header = self.headers.get("Range")

            if range_header:
                byte_range = self._parse_range(range_header, size)
                if byte_range is None:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.end_headers()
                    return
                start, end = byte_range
                data = read_file_range(path, start, end)
                self.send_response(206)
                self.send_header("Content-Type", mime)
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return

            data = read_file_range(path, 0, size - 1)
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(size))
            self.end_headers()
            self.wfile.write(data)

        def _file_meta(self, file_id: int) -> None:
            row = db.get_file_with_analysis(file_id)
            if row is None:
                self._json({"error": "file not found"}, 404)
                return
            path = Path(row["path"])
            self._json({
                "file_id": row["file_id"],
                "path": row["path"],
                "name": path.name,
                "kind": row["kind"] if "kind" in row.keys() else None,
                "plugin_hint": row["plugin_hint"],
                "category": row["category"],
                "sub_style": row["sub_style"],
                "bpm": row["bpm"],
                "key": row["key"],
                "lufs": row["lufs"],
                "stream_url": f"/api/stream/{file_id}",
            })

        def do_GET(self) -> None:
            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)

            if parsed.path in ("/", "/index.html"):
                self._html(INDEX_HTML)
                return

            stream_match = re.fullmatch(r"/api/stream/(\d+)", parsed.path)
            if stream_match:
                self._stream_file(int(stream_match.group(1)))
                return

            file_match = re.fullmatch(r"/api/file/(\d+)", parsed.path)
            if file_match:
                self._file_meta(int(file_match.group(1)))
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

            if parsed.path == "/api/libraries":
                stats = db.get_library_stats()
                libs = []
                order = ["music", "samples", "loops", "other"]
                for lib_id in order:
                    info = stats["libraries"].get(lib_id)
                    if not info:
                        continue
                    entry: dict[str, Any] = {
                        "id": lib_id,
                        "label": LIBRARY_LABELS_HE.get(lib_id, lib_id),
                        "total": info["total"],
                        "subs": [],
                    }
                    if lib_id == "samples":
                        for sub_id, count in sorted(
                            info["subs"].items(), key=lambda x: -x[1]
                        ):
                            entry["subs"].append({
                                "id": sub_id,
                                "label": SAMPLE_SUB_LABELS_HE.get(sub_id, sub_id),
                                "count": count,
                            })
                    elif lib_id == "music":
                        for sub_id, count in sorted(
                            info["subs"].items(), key=lambda x: -x[1]
                        )[:20]:
                            entry["subs"].append({
                                "id": sub_id,
                                "label": sub_id,
                                "count": count,
                            })
                    libs.append(entry)
                self._json({"total": stats["total"], "libraries": libs})
                return

            if parsed.path == "/api/browse":
                library = qs.get("library", ["music"])[0]
                library_sub = qs.get("sub", [None])[0]
                offset = int(qs.get("offset", ["0"])[0])
                limit = min(int(qs.get("limit", ["100"])[0]), 200)
                items = db.browse_library(
                    library,
                    library_sub=library_sub or None,
                    offset=offset,
                    limit=limit,
                )
                total = db.count_library(library, library_sub=library_sub or None)
                self._json({
                    "library": library,
                    "sub": library_sub,
                    "items": items,
                    "offset": offset,
                    "limit": limit,
                    "total": total,
                    "has_more": offset + len(items) < total,
                })
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
