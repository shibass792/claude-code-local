"""Local HTTP API + Match Panel UI — stdlib only, 127.0.0.1 by default.

    soundbrain serve --port 8770

    GET  /                              Match Panel (HTML)
    GET  /panel                         same panel
    GET  /health
    GET  /inventory
    GET  /stats
    GET  /brain
    GET  /suggest?bpm=145&key=F# minor
    GET  /dna?path=<project>
    GET  /project?path=<project>
    GET  /search?q=bass like Astrix
    GET  /match?path=<kick>&role=bass
    GET  /similar?path=<sample>
    GET  /api/match-track?q=<youtube|song|path>
    POST /api/download   {"hits":[...], "label":"..."}
    POST /api/open-cubase {"reference":{...}, "project_file_id":1, "arp_file_ids":[...]}
    POST /like  {"file_id": 123}

Nothing is exposed beyond the loopback interface unless you explicitly pass a
different host.
"""

from __future__ import annotations

import json
import mimetypes
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, unquote, urlparse

from . import brain, bridge, dna as dna_mod, learner, matcher, scanner, search as search_mod, session, studio_match
from .config import Config
from .db import Database
from .web import STATIC_DIR

PANEL_PAGES = {
    "/": "panel/index.html",
    "/panel": "panel/index.html",
    "/index.html": "panel/index.html",
}


class _Handler(BaseHTTPRequestHandler):
    server_version = "SoundBrain/1.1"
    db: Database
    cfg: Config
    quiet: bool = True

    # -- plumbing --------------------------------------------------------
    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        if not self.quiet:
            super().log_message(fmt, *args)

    def _send(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(self, data: bytes, content_type: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def _query(self) -> dict[str, str]:
        parsed = urlparse(self.path)
        return {k: v[0] for k, v in parse_qs(parsed.query).items()}

    def _int(self, params: dict[str, str], name: str, default: int) -> int:
        try:
            return int(params.get(name, default))
        except (TypeError, ValueError):
            return default

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError as exc:
            raise ValueError("invalid JSON body") from exc
        if not isinstance(payload, dict):
            raise ValueError("JSON body must be an object")
        return payload

    def _content_type(self, path: Path) -> str:
        ext = path.suffix.lower()
        if ext == ".js":
            return "application/javascript; charset=utf-8"
        if ext == ".css":
            return "text/css; charset=utf-8"
        if ext == ".html":
            return "text/html; charset=utf-8"
        guessed, _ = mimetypes.guess_type(str(path))
        return guessed or "application/octet-stream"

    def _resolve_static(self, rel: str) -> Path | None:
        base = STATIC_DIR.resolve()
        full = (STATIC_DIR / rel).resolve()
        if not str(full).startswith(str(base)):
            return None
        if not full.is_file():
            return None
        return full

    def _serve_static(self, rel: str) -> bool:
        full = self._resolve_static(rel)
        if full is None:
            return False
        self._send_bytes(full.read_bytes(), self._content_type(full))
        return True

    # -- routes ----------------------------------------------------------
    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        route = parsed.path.rstrip("/") or "/"
        # Keep "/assets/..." as-is for static; rstrip would break nothing important
        raw_path = parsed.path or "/"
        params = self._query()

        if raw_path.startswith("/assets/"):
            rel = unquote(raw_path[len("/assets/") :])
            if self._serve_static(rel):
                return
            self._send({"error": "asset not found"}, 404)
            return

        page = PANEL_PAGES.get(route) or PANEL_PAGES.get(raw_path)
        if page:
            if self._serve_static(page):
                return
            self._send({"error": "panel page missing"}, 500)
            return

        # file download of an indexed asset
        dl = re.fullmatch(r"/api/file/(\d+)/download", raw_path)
        if dl:
            self._download_file(int(dl.group(1)))
            return

        try:
            handler = self._routes().get(route)
            if handler is None:
                # also accept /api/* aliases without breaking old clients
                handler = self._routes().get(raw_path)
            if handler is None:
                self._send({"error": "unknown route", "routes": sorted(self._routes())}, 404)
                return
            with self.db.lock:
                payload = handler(params)
            self._send(payload)
        except FileNotFoundError as exc:
            self._send({"error": str(exc)}, 404)
        except ValueError as exc:
            self._send({"error": str(exc)}, 400)
        except Exception as exc:  # noqa: BLE001 - never take the server down
            self._send({"error": f"{type(exc).__name__}: {exc}"}, 500)

    def do_POST(self) -> None:  # noqa: N802
        route = urlparse(self.path).path.rstrip("/") or "/"
        try:
            payload = self._read_json()
        except ValueError as exc:
            self._send({"error": str(exc)}, 400)
            return

        try:
            if route == "/like":
                file_id = payload.get("file_id")
                if not isinstance(file_id, int):
                    self._send({"error": "file_id (int) is required"}, 400)
                    return
                with self.db.lock:
                    result = brain.like(self.db, file_id)
                self._send(result)
                return

            if route in ("/api/download", "/download"):
                hits = payload.get("hits") or []
                if not isinstance(hits, list) or not hits:
                    self._send({"error": "hits (non-empty list) is required"}, 400)
                    return
                label = str(payload.get("label") or "pack")
                with self.db.lock:
                    result = session.download_hits(self.cfg, hits, label=label)
                self._send(result)
                return

            if route in ("/api/open-cubase", "/open-cubase"):
                reference = payload.get("reference") or {}
                if not isinstance(reference, dict) or not reference:
                    self._send({"error": "reference object is required"}, 400)
                    return
                arp_ids = payload.get("arp_file_ids") or []
                arp_paths = payload.get("arp_paths") or []
                with self.db.lock:
                    result = session.open_in_cubase(
                        self.db,
                        self.cfg,
                        reference=reference,
                        project_path=payload.get("project_path"),
                        project_file_id=payload.get("project_file_id"),
                        arp_paths=list(arp_paths) if isinstance(arp_paths, list) else [],
                        arp_file_ids=[int(x) for x in arp_ids] if isinstance(arp_ids, list) else [],
                        open_daw=payload.get("open_daw", True) is not False,
                    )
                self._send(result)
                return

            self._send({"error": "unknown route"}, 404)
        except FileNotFoundError as exc:
            self._send({"error": str(exc)}, 404)
        except ValueError as exc:
            self._send({"error": str(exc)}, 400)
        except Exception as exc:  # noqa: BLE001
            self._send({"error": f"{type(exc).__name__}: {exc}"}, 500)

    def _download_file(self, file_id: int) -> None:
        row = self.db.file_by_id(file_id)
        if row is None:
            self._send({"error": "file not found"}, 404)
            return
        path = Path(str(row["path"]))
        if not path.is_file():
            self._send({"error": f"missing on disk: {path}"}, 404)
            return
        data = path.read_bytes()
        ctype = self._content_type(path)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Disposition", f'attachment; filename="{path.name}"')
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def _routes(self) -> dict[str, Callable[[dict[str, str]], Any]]:
        return {
            "/health": lambda p: {
                "ok": True,
                "db": str(self.cfg.db_path),
                "counts": self.db.counts(),
                "roots": self.cfg.roots,
                "panel": "/panel",
            },
            "/inventory": lambda p: scanner.inventory(self.db),
            "/stats": lambda p: learner.summary(self.db),
            "/brain": lambda p: brain.profile(self.db).as_dict(),
            "/timeline": lambda p: brain.timeline(self.db, self._int(p, "limit", 20)),
            "/suggest": lambda p: brain.suggest(
                self.db,
                self.cfg,
                bpm=float(p["bpm"]) if p.get("bpm") else None,
                key=p.get("key"),
                limit=self._int(p, "limit", 5),
            ),
            "/dna": self._dna,
            "/project": self._project,
            "/search": self._search,
            "/match": self._match,
            "/similar": self._similar,
            "/inkey": self._in_key,
            "/api/match-track": self._match_track,
            "/match-track": self._match_track,
            "/api/routes": lambda p: {"routes": sorted(self._routes())},
        }

    # -- route bodies ----------------------------------------------------
    def _require_path(self, params: dict[str, str]) -> str:
        path = params.get("path")
        if not path:
            raise ValueError("the 'path' parameter is required")
        if not Path(path).exists():
            raise FileNotFoundError(f"no such file: {path}")
        return path

    def _dna(self, params: dict[str, str]) -> Any:
        path = self._require_path(params)
        refresh = params.get("refresh") in ("1", "true", "yes")
        return dna_mod.dna_or_build(self.db, self.cfg, path, refresh=refresh)

    def _project(self, params: dict[str, str]) -> Any:
        path = self._require_path(params)
        report = bridge.build_report(
            self.db,
            self.cfg,
            path,
            limit=self._int(params, "limit", 30),
            refresh=params.get("refresh") in ("1", "true", "yes"),
        )
        payload = report.as_dict()
        payload["lines"] = report.lines(params.get("lang", "en"))
        return payload

    def _search(self, params: dict[str, str]) -> Any:
        query = params.get("q") or params.get("query")
        if not query:
            raise ValueError("the 'q' parameter is required")
        return search_mod.search(
            self.db,
            self.cfg,
            query,
            limit=self._int(params, "limit", 25),
            use_llm=params.get("llm") in ("1", "true", "yes"),
        )

    def _seed(self, params: dict[str, str]) -> dict[str, Any]:
        if params.get("file_id"):
            file_id = int(params["file_id"])
            features = self.db.analysis(file_id)
            if not features:
                raise FileNotFoundError(f"no analysis for file_id {file_id}")
            features["file_id"] = file_id
            return features
        path = self._require_path(params)
        row = self.db.file_by_path(path)
        if not row:
            raise FileNotFoundError(f"{path} is not indexed yet; run a scan first")
        features = self.db.analysis(int(row["id"]))
        if not features:
            raise FileNotFoundError(f"{path} is indexed but not analysed yet")
        features["file_id"] = int(row["id"])
        return features

    def _match(self, params: dict[str, str]) -> Any:
        seed = self._seed(params)
        role = params.get("role", "bass")
        candidates = matcher.find_partners_for_kick(
            self.db, seed, role=role, limit=self._int(params, "limit", 25), subtype=params.get("subtype")
        )
        return {
            "seed": {"path": seed.get("path"), "role": seed.get("role")},
            "role": role,
            "count": len(candidates),
            "results": [c.as_dict() for c in candidates],
        }

    def _similar(self, params: dict[str, str]) -> Any:
        seed = self._seed(params)
        candidates = matcher.find_similar(
            self.db, seed, role=params.get("role"), limit=self._int(params, "limit", 25)
        )
        return {
            "seed": {"path": seed.get("path"), "role": seed.get("role")},
            "count": len(candidates),
            "results": [c.as_dict() for c in candidates],
        }

    def _in_key(self, params: dict[str, str]) -> Any:
        key = params.get("key")
        if not key:
            raise ValueError("the 'key' parameter is required")
        candidates = matcher.find_in_key(
            self.db,
            key,
            role=params.get("role"),
            bpm=float(params["bpm"]) if params.get("bpm") else None,
            limit=self._int(params, "limit", 25),
        )
        return {"key": key, "count": len(candidates), "results": [c.as_dict() for c in candidates]}

    def _match_track(self, params: dict[str, str]) -> Any:
        query = params.get("q") or params.get("query") or params.get("url") or ""
        file_id = int(params["file_id"]) if params.get("file_id") else None
        if not query and file_id is None:
            raise ValueError("provide q= (YouTube URL, song name or path) or file_id=")
        return studio_match.match_track(
            self.db,
            self.cfg,
            query,
            file_id=file_id,
            limit_arps=self._int(params, "limit_arps", 20),
            limit_projects=self._int(params, "limit_projects", 12),
            daw=params.get("daw"),
            use_llm=params.get("llm") in ("1", "true", "yes"),
        )


def make_server(
    db: Database, cfg: Config, host: str | None = None, port: int | None = None, quiet: bool = True
) -> ThreadingHTTPServer:
    handler = type("BoundHandler", (_Handler,), {"db": db, "cfg": cfg, "quiet": quiet})
    return ThreadingHTTPServer((host or cfg.server_host, port or cfg.server_port), handler)


def serve(db: Database, cfg: Config, host: str | None = None, port: int | None = None, quiet: bool = False) -> None:
    cfg.ensure_dirs()
    httpd = make_server(db, cfg, host, port, quiet=quiet)
    address = f"http://{httpd.server_address[0]}:{httpd.server_address[1]}"
    print(f"SoundBrain Match Panel listening on {address}")
    print(f"  panel   {address}/panel")
    print(f"  health  {address}/health")
    print(f"  match   {address}/api/match-track?q=...")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


def serve_in_thread(
    db: Database, cfg: Config, host: str = "127.0.0.1", port: int = 0
) -> tuple[ThreadingHTTPServer, threading.Thread]:
    """Used by the tests and by anything embedding the bridge."""
    httpd = make_server(db, cfg, host, port)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, thread
