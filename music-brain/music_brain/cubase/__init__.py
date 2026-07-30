"""Cubase Bridge (Stage 7) — localhost API for real-time recommendations."""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from music_brain.brain import ingest_project, learn_summary, recommend_chain
from music_brain.db import KnowledgeDB
from music_brain.matcher import match_bass_for_kick, match_melodies_same_key, match_for
from music_brain.search import search as nl_search


def build_handler(db: KnowledgeDB) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args: Any) -> None:  # quieter
            pass

        def _json(self, code: int, payload: Any) -> None:
            body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        def _read_json(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                return {}
            raw = self.rfile.read(length)
            try:
                return json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError:
                return {}

        def do_OPTIONS(self) -> None:  # noqa: N802
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            qs = parse_qs(parsed.query)
            path = parsed.path.rstrip("/") or "/"

            if path == "/health":
                return self._json(200, {"ok": True, "service": "music-brain-cubase-bridge"})

            if path == "/stats":
                return self._json(200, learn_summary(db))

            if path == "/recommend/chain":
                synth = (qs.get("synth") or ["Serum"])[0]
                chain = recommend_chain(db, synth)
                return self._json(200, {"synth": synth, "chain": chain})

            if path == "/match/bass":
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

            if path == "/match/melodies":
                key = (qs.get("key") or [None])[0]
                if not key:
                    return self._json(400, {"error": "key query param required"})
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

            if path == "/search":
                q = (qs.get("q") or qs.get("query") or [""])[0]
                return self._json(200, nl_search(db, q))

            if path == "/project/open":
                # GET convenience: /project/open?path=...
                proj = (qs.get("path") or [None])[0]
                if not proj:
                    return self._json(400, {"error": "path required"})
                return self._handle_project_open(proj)

            return self._json(
                404,
                {
                    "error": "not found",
                    "endpoints": [
                        "GET /health",
                        "GET /stats",
                        "GET /recommend/chain?synth=Serum",
                        "GET /match/bass?key=F#&bpm=142&limit=26",
                        "GET /match/melodies?key=F#&limit=9",
                        "GET /search?q=bass+like+Astrix",
                        "POST /project/open  {\"path\": \"H:\\\\Projects\\\\track.cpr\"}",
                        "POST /match        {\"family\":\"bass\",\"key\":\"F#\",\"bpm\":142}",
                    ],
                },
            )

        def do_POST(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            path = parsed.path.rstrip("/") or "/"
            body = self._read_json()

            if path == "/project/open":
                proj = body.get("path")
                if not proj:
                    return self._json(400, {"error": "path required"})
                return self._handle_project_open(str(proj))

            if path == "/match":
                family = body.get("family") or "bass"
                hits = match_for(
                    db,
                    target_family=family,
                    key=body.get("key"),
                    bpm=body.get("bpm"),
                    style=body.get("style"),
                    limit=int(body.get("limit") or 25),
                    prefer_same_key=bool(body.get("prefer_same_key")),
                )
                return self._json(200, {"count": len(hits), "results": hits})

            if path == "/search":
                return self._json(200, nl_search(db, str(body.get("query") or body.get("q") or "")))

            return self._json(404, {"error": "not found"})

        def _handle_project_open(self, proj: str) -> None:
            p = Path(proj)
            if not p.exists():
                # Still record intent — Cubase may pass before save
                db.brain_event("project_opened", {"path": proj, "missing": True})
                summary = learn_summary(db)
                key = None
                bpm = None
            else:
                dna = ingest_project(db, str(p))
                key = dna.get("key")
                bpm = dna.get("bpm")
                summary = learn_summary(db)

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
                        *( [f"מצאתי {len(melodies)} מלודיות מאותו Key."] if key else [] ),
                    ],
                    "basses": basses,
                    "melodies": melodies,
                    "brain": summary,
                },
            )

    return Handler


def serve(db: KnowledgeDB, host: str = "127.0.0.1", port: int = 18766) -> None:
    handler = build_handler(db)
    httpd = ThreadingHTTPServer((host, port), handler)
    print(f"Cubase Bridge listening on http://{host}:{port}")
    print("Endpoints: /health /stats /match/bass /match/melodies /search /project/open")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        httpd.shutdown()
