"""SHIBASS S1 player panel — UI + media streaming + Cubase bridge on one port."""

from __future__ import annotations

import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

from music_brain.brain import ingest_project, learn_summary, recommend_chain
from music_brain.db import KnowledgeDB
from music_brain.matcher import match_bass_for_kick, match_for, match_melodies_same_key
from music_brain.player.media import (
    browser_tree,
    ensure_media_indexed,
    guess_mime,
    list_media,
    resolve_media_path,
)
from music_brain.player import remote_bus
from music_brain.search import search as nl_search

STATIC_DIR = Path(__file__).resolve().parent / "static"


def _lan_urls(port: int) -> list[str]:
    import socket

    urls = [f"http://127.0.0.1:{port}/"]
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip.startswith("127."):
                continue
            urls.append(f"http://{ip}:{port}/")
    except Exception:
        pass
    # Also try connecting UDP trick for primary LAN IP
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        u = f"http://{ip}:{port}/"
        if u not in urls:
            urls.insert(1, u)
    except Exception:
        pass
    return list(dict.fromkeys(urls))


def build_handler(db: KnowledgeDB) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt: str, *args: Any) -> None:
            pass

        def _cors(self) -> None:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Range")

        def _json(self, code: int, payload: Any) -> None:
            body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self._cors()
            self.end_headers()
            self.wfile.write(body)

        def _read_json(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                return {}
            try:
                return json.loads(self.rfile.read(length).decode("utf-8"))
            except json.JSONDecodeError:
                return {}

        def do_OPTIONS(self) -> None:  # noqa: N802
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            qs = parse_qs(parsed.query)
            path = parsed.path or "/"

            # --- Player UI ---
            if path in ("/", "/player", "/player/"):
                return self._static("index.html")
            if path in ("/remote", "/remote/", "/rokid", "/rokid/"):
                return self._static("remote.html")
            if path.startswith("/static/"):
                rel = path[len("/static/") :]
                return self._static(rel)
            if path.startswith("/assets/"):
                return self._static(path.lstrip("/"))

            # --- Rokid / remote control bus ---
            if path.rstrip("/") == "/api/remote/state":
                return self._json(200, remote_bus.get_state())

            if path.rstrip("/") == "/api/remote/poll":
                after = int((qs.get("after") or ["0"])[0])
                cmds = remote_bus.poll_commands(after)
                return self._json(200, {"commands": cmds, "state": remote_bus.get_state()})

            if path.rstrip("/") == "/api/remote/info":
                return self._json(
                    200,
                    {
                        "service": "shibass-s1",
                        "remote": "/remote",
                        "panel": "/",
                        "urls": _lan_urls(self.server.server_address[1]),
                    },
                )

            # --- Media library API ---
            if path.rstrip("/") == "/api/library":
                category = (qs.get("category") or qs.get("cat") or [None])[0]
                q = (qs.get("q") or qs.get("search") or [None])[0]
                ext = (qs.get("ext") or [None])[0]
                limit = int((qs.get("limit") or ["200"])[0])
                offset = int((qs.get("offset") or ["0"])[0])
                items = list_media(
                    db, category=category, q=q, extension=ext, limit=limit, offset=offset
                )
                return self._json(200, {"count": len(items), "items": items})

            if path.rstrip("/") == "/api/browser":
                return self._json(200, browser_tree(db))

            if path.rstrip("/") == "/api/media/index":
                # Trigger a light re-index (may take time on huge drives)
                roots = qs.get("root") or None
                stats = ensure_media_indexed(db, roots)
                return self._json(200, {"ok": True, **stats})

            if path.startswith("/api/stream"):
                return self._stream(qs)

            if path.rstrip("/") == "/api/file-info":
                raw = (qs.get("path") or qs.get("id") or [None])[0]
                p = resolve_media_path(db, unquote(raw or ""))
                if not p:
                    return self._json(404, {"error": "not found"})
                st = p.stat()
                return self._json(
                    200,
                    {
                        "path": str(p),
                        "name": p.name,
                        "size": st.st_size,
                        "mime": guess_mime(p),
                        "extension": p.suffix.lower(),
                    },
                )

            # --- Cubase / Music Brain API (compat) ---
            api_path = path.rstrip("/") or "/"
            if api_path == "/health":
                return self._json(
                    200,
                    {
                        "ok": True,
                        "service": "shibass-s1",
                        "player": "/",
                        "remote": "/remote",
                        "bridge": True,
                        "urls": _lan_urls(self.server.server_address[1]),
                    },
                )
            if api_path == "/stats":
                return self._json(200, learn_summary(db))
            if api_path == "/recommend/chain":
                synth = (qs.get("synth") or ["Serum"])[0]
                return self._json(200, {"synth": synth, "chain": recommend_chain(db, synth)})
            if api_path == "/match/bass":
                key = (qs.get("key") or [None])[0]
                bpm = float(qs["bpm"][0]) if qs.get("bpm") else None
                kick = (qs.get("kick") or [None])[0]
                limit = int((qs.get("limit") or ["26"])[0])
                hits = match_bass_for_kick(db, kick_path=kick, key=key, bpm=bpm, limit=limit)
                return self._json(
                    200,
                    {
                        "message": f"מצאתי {len(hits)} באסים שמתאימים.",
                        "count": len(hits),
                        "results": hits,
                    },
                )
            if api_path == "/match/melodies":
                key = (qs.get("key") or [None])[0]
                if not key:
                    return self._json(400, {"error": "key required"})
                limit = int((qs.get("limit") or ["9"])[0])
                hits = match_melodies_same_key(db, key, limit=limit)
                return self._json(
                    200,
                    {
                        "message": f"מצאתי {len(hits)} מלודיות מאותו Key ({key}).",
                        "count": len(hits),
                        "results": hits,
                    },
                )
            if api_path == "/search":
                q = (qs.get("q") or qs.get("query") or [""])[0]
                return self._json(200, nl_search(db, q))
            if api_path == "/project/open":
                proj = (qs.get("path") or [None])[0]
                if not proj:
                    return self._json(400, {"error": "path required"})
                return self._project_open(proj)

            return self._json(404, {"error": "not found", "player": "/"})

        def do_POST(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            path = parsed.path.rstrip("/") or "/"
            body = self._read_json()
            if path == "/project/open":
                proj = body.get("path")
                if not proj:
                    return self._json(400, {"error": "path required"})
                return self._project_open(str(proj))
            if path == "/match":
                hits = match_for(
                    db,
                    target_family=body.get("family") or "bass",
                    key=body.get("key"),
                    bpm=body.get("bpm"),
                    style=body.get("style"),
                    limit=int(body.get("limit") or 25),
                    prefer_same_key=bool(body.get("prefer_same_key")),
                )
                return self._json(200, {"count": len(hits), "results": hits})
            if path == "/search":
                return self._json(200, nl_search(db, str(body.get("query") or body.get("q") or "")))
            if path == "/api/media/index":
                stats = ensure_media_indexed(db, body.get("roots"))
                return self._json(200, {"ok": True, **stats})

            if path == "/api/remote/command":
                action = str(body.get("action") or "").strip().lower()
                if not action:
                    return self._json(400, {"error": "action required"})
                allowed = {
                    "play",
                    "pause",
                    "toggle",
                    "next",
                    "prev",
                    "stop",
                    "seek",
                    "volume",
                    "play_path",
                    "add_path",
                    "search",
                }
                if action not in allowed:
                    return self._json(400, {"error": f"unknown action: {action}", "allowed": sorted(allowed)})
                cmd = remote_bus.push_command(action, body.get("payload") or body)
                return self._json(200, {"ok": True, "command": cmd})

            if path == "/api/remote/state":
                st = remote_bus.set_state(body)
                return self._json(200, st)

            return self._json(404, {"error": "not found"})

        def _project_open(self, proj: str) -> None:
            p = Path(proj)
            key = bpm = None
            if p.exists():
                dna = ingest_project(db, str(p))
                key, bpm = dna.get("key"), dna.get("bpm")
            else:
                db.brain_event("project_opened", {"path": proj, "missing": True})
            basses = match_bass_for_kick(db, key=key, bpm=float(bpm) if bpm else None, limit=26)
            melodies = match_melodies_same_key(db, key, limit=9) if key else []
            self._json(
                200,
                {
                    "project": proj,
                    "key": key,
                    "bpm": bpm,
                    "messages": [
                        f"מצאתי {len(basses)} באסים שמתאימים.",
                        *([f"מצאתי {len(melodies)} מלודיות מאותו Key."] if key else []),
                    ],
                    "basses": basses,
                    "melodies": melodies,
                    "brain": learn_summary(db),
                },
            )

        def _static(self, rel: str) -> None:
            # Prevent path escape
            rel = rel.replace("\\", "/").lstrip("/")
            target = (STATIC_DIR / rel).resolve()
            try:
                target.relative_to(STATIC_DIR.resolve())
            except ValueError:
                return self._json(403, {"error": "forbidden"})
            if target.is_dir():
                target = target / "index.html"
            if not target.is_file():
                return self._json(404, {"error": f"missing static: {rel}"})
            data = target.read_bytes()
            mime, _ = mimetypes.guess_type(str(target))
            if target.suffix == ".css":
                mime = "text/css"
            elif target.suffix == ".js":
                mime = "application/javascript"
            elif target.suffix == ".html":
                mime = "text/html"
            self.send_response(200)
            self.send_header("Content-Type", f"{mime or 'application/octet-stream'}; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self._cors()
            self.end_headers()
            self.wfile.write(data)

        def _stream(self, qs: dict[str, list[str]]) -> None:
            raw = (qs.get("path") or qs.get("id") or [None])[0]
            if not raw:
                return self._json(400, {"error": "path or id required"})
            p = resolve_media_path(db, unquote(raw))
            if not p:
                return self._json(404, {"error": "media not found or not indexed"})
            size = p.stat().st_size
            mime = guess_mime(p)
            range_header = self.headers.get("Range")
            if range_header and range_header.startswith("bytes="):
                try:
                    start_s, end_s = range_header.replace("bytes=", "").split("-", 1)
                    start = int(start_s) if start_s else 0
                    end = int(end_s) if end_s else size - 1
                    end = min(end, size - 1)
                    length = end - start + 1
                    with p.open("rb") as f:
                        f.seek(start)
                        chunk = f.read(length)
                    self.send_response(206)
                    self.send_header("Content-Type", mime)
                    self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                    self.send_header("Accept-Ranges", "bytes")
                    self.send_header("Content-Length", str(len(chunk)))
                    self._cors()
                    self.end_headers()
                    self.wfile.write(chunk)
                    return
                except Exception:
                    pass
            data = p.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(len(data)))
            self._cors()
            self.end_headers()
            self.wfile.write(data)

    return Handler


def serve(db: KnowledgeDB, host: str = "0.0.0.0", port: int = 18766) -> None:
    handler = build_handler(db)
    httpd = ThreadingHTTPServer((host, port), handler)
    print(f"SHIBASS S1 player  -> http://127.0.0.1:{port}/")
    print(f"Rokid remote       -> http://127.0.0.1:{port}/remote")
    for u in _lan_urls(port):
        if "127.0.0.1" not in u:
            print(f"LAN / glasses     -> {u}remote")
    print(f"Cubase Bridge API  -> http://127.0.0.1:{port}/health")
    print("Library API        -> /api/library  /api/browser  /api/stream?path=...")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down SHIBASS S1.")
        httpd.shutdown()
