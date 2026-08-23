# -*- coding: utf-8 -*-
"""Fix the Memory Engine /api/status hang.

Root cause: COUNT(*) full-table scans on a large sqlite DB (spinning H: disk)
while the incremental watcher writes — the panels time out and show "standby".
Fix (append-safe, backed up):
  1. connect(): busy timeout 3s so a writer never blocks us forever.
  2. /api/status counts come from a 60s in-memory cache; on any failure the
     last good numbers are served with "stale": true — panels never hang again.
"""
import re
import shutil
from pathlib import Path

F = Path(r"H:\shibass-ai\SHIBASS_SHARED_MEMORY\tools\shibass_memory_api.py")
src = F.read_text(encoding="utf-8")
if "_status_cache" in src:
    print("NO-CHANGE (already patched)")
    raise SystemExit(0)
shutil.copy2(F, str(F) + ".bak-status-fix")

# 1 — busy timeout on the read-only connection
src = src.replace(
    'f"file:{DATABASE.as_posix()}?mode=ro",\n        uri=True,',
    'f"file:{DATABASE.as_posix()}?mode=ro",\n        uri=True,\n        timeout=3,')

# 2 — cached status: replace the body of the /api/status branch
m = re.search(r'( *)if route == "/api/status":\n(.*?)(?=\n\1if route|\n\1# |\Z)',
              src, re.DOTALL)
assert m, "status branch not found"
indent = m.group(1)
cached = f'''{indent}if route == "/api/status":
{indent}    global _status_cache
{indent}    import time as _t
{indent}    now = _t.time()
{indent}    if _status_cache["ts"] + 60 < now:
{indent}        try:
{indent}            with connect() as connection:
{indent}                connection.execute("PRAGMA busy_timeout=3000")
{indent}                files = connection.execute("SELECT COUNT(*) FROM files").fetchone()[0]
{indent}                music = connection.execute("SELECT COUNT(*) FROM music_metadata").fetchone()[0]
{indent}                try:
{indent}                    projects = connection.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
{indent}                except Exception:
{indent}                    projects = None
{indent}            _status_cache.update(ts=now, stale=False,
{indent}                                 data={{"files": files, "music": music, "projects": projects}})
{indent}        except Exception as exc:
{indent}            _status_cache["stale"] = True
{indent}            _status_cache["error"] = str(exc)
{indent}    payload = {{"ok": True, "engine": "ShiBass Persistent Music Memory",
{indent}               "mode": "active" if not _status_cache["stale"] else "active (cached counts)",
{indent}               "counts": _status_cache["data"], "stale": _status_cache["stale"],
{indent}               "cached_at": _status_cache["ts"]}}
{indent}    self.send_json(payload)
{indent}    return

'''
src = src[:m.start()] + cached + src[m.end():]

# cache holder near DATABASE definition
src = src.replace('MODELS_DIR = Path(',
                  '_status_cache = {"ts": 0.0, "stale": True, "data": {}, "error": None}\n\nMODELS_DIR = Path(', 1)

F.write_text(src, encoding="utf-8", newline="\n")
import py_compile
py_compile.compile(str(F), doraise=True)
print("PATCHED + COMPILES")
