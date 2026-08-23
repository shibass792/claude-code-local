"""Add a Synth-Studio pass-through to the music_brain player server (8788 -> 8789).

The studio UI (sb-synths-midi-player.html) hardcodes API_BASE=8788; music_brain owns
that port. This patch forwards only the routes music_brain does NOT own to the studio
server on 8789, so the user's known URL serves everything. MIDI Forge routes are
dispatched BEFORE the proxy, so /api/midi/{status,analyze,preview,transform,export}
stay ours. Idempotent.
"""
import shutil
from pathlib import Path

F = Path(r"H:\shibass-ai\claude-code-local\music-brain\music_brain\player\__init__.py")
src = F.read_text(encoding="utf-8")
if "_studio_proxy" in src:
    print("NO-CHANGE (already patched)")
    raise SystemExit(0)
shutil.copy2(F, F.with_suffix(".py.pre-proxy"))

# module-level constants after the midiforge import
anchor = "from music_brain.midiforge import api as midiforge_api\n"
consts = anchor + '''
# Synth Studio (auxiliary FastAPI service) — its UI targets 8788, we pass through.
_STUDIO_URL = "http://127.0.0.1:8789"
_STUDIO_PREFIXES = (
    "/sb-synths-midi-player.html", "/SHIBASS-MASTER-MENU.html",
    "/music-ai-studio.html", "/shibass-3d-theme.css",
    "/api/sylenth/", "/api/vst3/", "/api/scales/", "/api/research/",
    "/api/learning/", "/api/scan/", "/api/lib", "/f/",
    "/api/midi/categories", "/api/midi/parse", "/api/midi/raw",
    "/api/midi/search",
)
'''
assert anchor in src
src = src.replace(anchor, consts, 1)

# proxy method, inserted just before do_GET
method_anchor = "        def do_GET(self) -> None:  # noqa: N802\n"
proxy_method = '''        def _studio_proxy(self, method: str, body: bytes | None = None) -> bool:
            """Forward studio routes to 8789; True when the request was handled."""
            p = urlparse(self.path).path
            if not any(p == x or p.startswith(x) for x in _STUDIO_PREFIXES):
                return False
            import urllib.request as _rq
            try:
                req = _rq.Request(_STUDIO_URL + self.path, data=body, method=method)
                if body is not None:
                    req.add_header("Content-Type", "application/json")
                rng = self.headers.get("Range")
                if rng:
                    req.add_header("Range", rng)
                with _rq.urlopen(req, timeout=180) as r:
                    data = r.read()
                    self.send_response(r.status)
                    for h in ("Content-Type", "Content-Range", "Accept-Ranges"):
                        v = r.headers.get(h)
                        if v:
                            self.send_header(h, v)
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
            except Exception as e:
                self._json(502, {"error": f"synth studio (8789) unavailable: {e}"})
            return True

'''
assert method_anchor in src
src = src.replace(method_anchor, proxy_method + method_anchor, 1)

# GET fallback
get_404 = ('            return self._json(404, {"error": "not found", "player": "/"})')
assert get_404 in src
src = src.replace(get_404,
    '            if self._studio_proxy("GET"):\n'
    '                return\n' + get_404, 1)

# POST fallback — anchor on the full midiforge-dispatch block so we hit the real
# do_POST tail, not the identical-looking 404 inside /api/file-info.
post_block = (
    "            _mf = midiforge_api.handle_post(db, path, body)\n"
    "            if _mf is not None:\n"
    "                return self._json(_mf[0], _mf[1])\n"
    "\n"
    '            return self._json(404, {"error": "not found"})'
)
assert post_block in src
src = src.replace(post_block, post_block.replace(
    '            return self._json(404, {"error": "not found"})',
    '            if self._studio_proxy("POST", json.dumps(body).encode()):\n'
    "                return\n"
    '            return self._json(404, {"error": "not found"})'), 1)

F.write_text(src, encoding="utf-8", newline="\n")
print("PATCHED")
import py_compile
py_compile.compile(str(F), doraise=True)
print("COMPILES OK")
