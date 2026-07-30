"""Local HTTP API for the bridge (stage 7) — stdlib only, 127.0.0.1 by default.

    soundbrain serve --port 8770

    GET  /health
    GET  /inventory                     what the scanner found, per drive
    GET  /stats                         stage 5 + 6: usage shares and chains
    GET  /brain                         stage 10: the learned profile
    GET  /suggest?bpm=145&key=F# minor  a starting point in your own style
    GET  /dna?path=<project>            stage 8: Project DNA
    GET  /project?path=<project>        stage 7: "26 basses fit, 9 melodies in key"
    GET  /search?q=bass like Astrix     stage 9: AI search
    GET  /match?path=<kick>&role=bass   stage 4: partners for one sound
    GET  /similar?path=<sample>         nearest neighbours by timbre
    POST /like  {"file_id": 123}        teach Brain Mode that you liked something

Nothing is exposed beyond the loopback interface unless you explicitly pass a
different host, and there are no write operations against your audio files.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, urlparse

from . import brain, bridge, dna as dna_mod, learner, matcher, scanner, search as search_mod
from .config import Config
from .db import Database


class _Handler(BaseHTTPRequestHandler):
    server_version = "SoundBrain/1.0"
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

    def _query(self) -> dict[str, str]:
        parsed = urlparse(self.path)
        return {k: v[0] for k, v in parse_qs(parsed.query).items()}

    def _int(self, params: dict[str, str], name: str, default: int) -> int:
        try:
            return int(params.get(name, default))
        except (TypeError, ValueError):
            return default

    # -- routes ----------------------------------------------------------
    def do_GET(self) -> None:  # noqa: N802
        route = urlparse(self.path).path.rstrip("/") or "/"
        params = self._query()
        try:
            handler = self._routes().get(route)
            if handler is None:
                self._send({"error": "unknown route", "routes": sorted(self._routes())}, 404)
                return
            self._send(handler(params))
        except FileNotFoundError as exc:
            self._send({"error": str(exc)}, 404)
        except ValueError as exc:
            self._send({"error": str(exc)}, 400)
        except Exception as exc:  # noqa: BLE001 - never take the server down
            self._send({"error": f"{type(exc).__name__}: {exc}"}, 500)

    def do_POST(self) -> None:  # noqa: N802
        route = urlparse(self.path).path.rstrip("/") or "/"
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._send({"error": "invalid JSON body"}, 400)
            return
        if route == "/like":
            file_id = payload.get("file_id")
            if not isinstance(file_id, int):
                self._send({"error": "file_id (int) is required"}, 400)
                return
            self._send(brain.like(self.db, file_id))
            return
        self._send({"error": "unknown route"}, 404)

    def _routes(self) -> dict[str, Callable[[dict[str, str]], Any]]:
        return {
            "/": lambda p: {"ok": True, "routes": sorted(k for k in self._routes() if k != "/")},
            "/health": lambda p: {
                "ok": True,
                "db": str(self.cfg.db_path),
                "counts": self.db.counts(),
                "roots": self.cfg.roots,
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
        return {"seed": {"path": seed.get("path"), "role": seed.get("role")}, "role": role, "count": len(candidates), "results": [c.as_dict() for c in candidates]}

    def _similar(self, params: dict[str, str]) -> Any:
        seed = self._seed(params)
        candidates = matcher.find_similar(self.db, seed, role=params.get("role"), limit=self._int(params, "limit", 25))
        return {"seed": {"path": seed.get("path"), "role": seed.get("role")}, "count": len(candidates), "results": [c.as_dict() for c in candidates]}

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


def make_server(db: Database, cfg: Config, host: str | None = None, port: int | None = None, quiet: bool = True) -> ThreadingHTTPServer:
    handler = type("BoundHandler", (_Handler,), {"db": db, "cfg": cfg, "quiet": quiet})
    return ThreadingHTTPServer((host or cfg.server_host, port or cfg.server_port), handler)


def serve(db: Database, cfg: Config, host: str | None = None, port: int | None = None, quiet: bool = False) -> None:
    httpd = make_server(db, cfg, host, port, quiet=quiet)
    address = f"http://{httpd.server_address[0]}:{httpd.server_address[1]}"
    print(f"SoundBrain bridge listening on {address}")
    print(f"  try {address}/health  and  {address}/stats")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


def serve_in_thread(db: Database, cfg: Config, host: str = "127.0.0.1", port: int = 0) -> tuple[ThreadingHTTPServer, threading.Thread]:
    """Used by the tests and by anything embedding the bridge."""
    httpd = make_server(db, cfg, host, port)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, thread
