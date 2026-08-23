"""Upgrade Antigravity's synths_midi_server.py in place:
1. Port 8788 -> env SYNTHS_PORT (default 8789)  — music_brain owns 8788.
2. /api/midi/export mock -> real proxy to MIDI Forge (honest 502 when down).
3. /api/lib SQL fixed to the actual music_brain schema (files + analyses join).
4. /health: hardcoded fallback counts removed — real numbers or null.
5. Drop its /api/midi/status alias (that route belongs to MIDI Forge).
Idempotent; writes a .pre-upgrade backup once.
"""
import re
import shutil
from pathlib import Path

F = Path(r"H:\shibass-ai\services\synths_midi_player\synths_midi_server.py")
src = F.read_text(encoding="utf-8")
orig = src

bak = F.with_suffix(".py.pre-upgrade")
if not bak.exists():
    shutil.copy2(F, bak)

# 1 — port
src = src.replace('port=8788, log_level="info"',
                  'port=int(os.environ.get("SYNTHS_PORT", "8789")), log_level="info"')
src = src.replace('"port": 8788,', '"port": int(os.environ.get("SYNTHS_PORT", "8789")),')
src = src.replace("(Port 8788)", "(Port 8789)")

# 2 — real export proxy instead of the mock
mock = re.search(r'@app\.post\("/api/midi/export"\).*?(?=@app\.get\("/api/remote/poll"\))',
                 src, re.DOTALL)
if mock and "EXPORT_SUCCESS" in mock.group(0):
    proxy = '''@app.post("/api/midi/export")
async def export_midi(payload: Dict[str, Any] = Body(...)):
    """Proxy to the MIDI Forge engine (music_brain, port 8788) — real export."""
    import urllib.request as _rq
    body = json.dumps(payload).encode()
    req = _rq.Request("http://127.0.0.1:8788/api/midi/export", body,
                      {"Content-Type": "application/json"})
    try:
        with _rq.urlopen(req, timeout=300) as r:
            return JSONResponse(json.loads(r.read()))
    except Exception as e:
        raise HTTPException(status_code=502,
                            detail=f"MIDI Forge (port 8788) unavailable: {e}")

'''
    src = src[:mock.start()] + proxy + src[mock.end():]

# 3 — /api/lib SQL matches the real schema
src = src.replace(
    'sql = "SELECT id, path, name, kind, sub_style, bpm, key, size_bytes FROM files WHERE 1=1"',
    'sql = ("SELECT f.id, f.path, f.kind, f.size_bytes, a.sub_style, a.bpm, a.key "\n'
    '           "FROM files f LEFT JOIN analyses a ON a.file_id = f.id WHERE 1=1")')
src = src.replace('sql += " AND kind=?"', 'sql += " AND f.kind=?"')
src = src.replace('sql += " AND (name LIKE ? OR path LIKE ? OR sub_style LIKE ?)"',
                  'sql += " AND (f.path LIKE ? OR ifnull(a.sub_style,\'\') LIKE ?)"')
src = src.replace('q_wild = f"%{q}%"\n        params.extend([q_wild, q_wild, q_wild])',
                  'q_wild = f"%{q}%"\n        params.extend([q_wild, q_wild])')
src = src.replace('sql += " ORDER BY id DESC LIMIT ? OFFSET ?"',
                  'sql += " ORDER BY f.id DESC LIMIT ? OFFSET ?"')
src = src.replace(
    "rows = [dict(r) for r in c.fetchall()]",
    "rows = [dict(r) | {\"name\": os.path.basename(r[\"path\"])} for r in c.fetchall()]")

# 4 — honest counts (no invented defaults)
for k, v in (("midi", "306975"), ("sample", "467783"), ("track", "45382"),
             ("project", "66"), ("lessons", "18"), ("recipes", "24")):
    src = src.replace(f'counts.get("{k}", {v})', f'counts.get("{k}")')

# 5 — /api/midi/status belongs to MIDI Forge
src = src.replace('@app.get("/api/midi/status")\n', "")

if src != orig:
    F.write_text(src, encoding="utf-8", newline="\n")
    print("PATCHED")
else:
    print("NO-CHANGE (already upgraded or content moved)")
for marker in ("SYNTHS_PORT", "MIDI Forge (port 8788) unavailable", "LEFT JOIN analyses"):
    print(("OK  " if marker in src else "MISS"), marker)
