"""Local web UI — panel HTML pages, shared assets, REST API."""

from __future__ import annotations

import json
import mimetypes
import re
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from music_brain.brain.learner import Brain
from music_brain.bridge.cubase_bridge import CubaseBridge
from music_brain.database.knowledge_db import KnowledgeDB
from music_brain.library.classifier import LIBRARY_LABELS_HE, SAMPLE_SUB_LABELS_HE
from music_brain.matcher.engine import MatcherEngine
from music_brain.search.ai_search import AISearch
from music_brain.web.audio_stream import (
    mime_for_path,
    read_file_range,
    resolve_indexed_file,
)

STATIC_DIR = Path(__file__).resolve().parent / "static"

PANEL_PAGES: dict[str, str] = {
    "/": "panel/index.html",
    "/index.html": "panel/index.html",
    "/music": "panel/music.html",
    "/music.html": "panel/music.html",
    "/samples": "panel/samples.html",
    "/samples.html": "panel/samples.html",
    "/loops": "panel/loops.html",
    "/loops.html": "panel/loops.html",
    "/search": "panel/search.html",
    "/search.html": "panel/search.html",
    "/cubase": "panel/cubase.html",
    "/cubase.html": "panel/cubase.html",
    "/embed": "panel/embed.html",
    "/embed.html": "panel/embed.html",
}


def _content_type(path: Path) -> str:
    ext = path.suffix.lower()
    if ext == ".js":
        return "application/javascript; charset=utf-8"
    if ext == ".css":
        return "text/css; charset=utf-8"
    if ext == ".html":
        return "text/html; charset=utf-8"
    guessed, _ = mimetypes.guess_type(str(path))
    return guessed or "application/octet-stream"


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

        def _send_bytes(self, data: bytes, content_type: str, status: int = 200) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _resolve_static(self, rel: str) -> Path | None:
            base = STATIC_DIR.resolve()
            full = (STATIC_DIR / rel).resolve()
            if not str(full).startswith(str(base)):
                return None
            if not full.is_file():
                return None
            return full

        def _serve_static_file(self, rel: str) -> bool:
            full = self._resolve_static(rel)
            if full is None:
                return False
            data = full.read_bytes()
            self._send_bytes(data, _content_type(full))
            return True

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
            path = parsed.path

            if path in PANEL_PAGES:
                if self._serve_static_file(PANEL_PAGES[path]):
                    return
                self._json({"error": "panel page missing"}, 500)
                return

            if path.startswith("/assets/"):
                rel = path[len("/assets/") :]
                if self._serve_static_file(rel):
                    return
                self._json({"error": "not found"}, 404)
                return

            stream_match = re.fullmatch(r"/api/stream/(\d+)", path)
            if stream_match:
                self._stream_file(int(stream_match.group(1)))
                return

            file_match = re.fullmatch(r"/api/file/(\d+)", path)
            if file_match:
                self._file_meta(int(file_match.group(1)))
                return

            if path == "/api/search":
                q = qs.get("q", [""])[0]
                limit = min(int(qs.get("limit", ["30"])[0]), 100)
                results = search.search(q, limit=limit)
                self._json({"query": q, "results": results})
                return

            if path == "/api/stats":
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

            if path == "/api/cubase":
                cpr_path = qs.get("path", [""])[0]
                if not cpr_path or not Path(cpr_path).exists():
                    self._json({"error": "path not found"}, 404)
                    return
                result = bridge.on_project_open(cpr_path)
                self._json(result)
                return

            if path == "/api/libraries":
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

            if path == "/api/browse":
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

            if path == "/api/status":
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
    print(f"Music Brain Panel → http://{host}:{port}")
    print(f"  מוזיקה:  http://{host}:{port}/music")
    print(f"  סמפלים:  http://{host}:{port}/samples")
    server.serve_forever()
