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
from music_brain.bridge.daw_launcher import open_project
from music_brain.bridge.reference_links import ReferenceLinks
from music_brain.database.knowledge_db import KnowledgeDB
from music_brain.library.classifier import LIBRARY_LABELS_HE, SAMPLE_SUB_LABELS_HE
from music_brain.matcher.engine import MatcherEngine
from music_brain.matcher.project_matcher import ProjectMatcher
from music_brain.reference.analyzer import ReferenceAnalyzer
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
    "/match": "panel/match.html",
    "/match.html": "panel/match.html",
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
    ref_cfg = cfg.get("reference_match", {})
    ref_analyzer = ReferenceAnalyzer(
        cache_dir=ref_cfg.get("cache_dir", "data/references"),
        registry_path=ref_cfg.get("registry_path", "data/reference_registry.json"),
        max_analyze_sec=float(ref_cfg.get("max_analyze_sec", 90)),
    )
    project_matcher = ProjectMatcher(db)
    ref_links = ReferenceLinks(
        db,
        sidecar_dir=ref_cfg.get("sidecar_dir", "data/project_links"),
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

        def _read_json_body(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                return {}
            raw = self.rfile.read(length)
            try:
                return json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError:
                return {}

        def _handle_match_analyze(self, source: str, daw: str | None) -> None:
            try:
                reference = ref_analyzer.analyze(source)
            except (ValueError, FileNotFoundError, RuntimeError) as exc:
                self._json({"error": str(exc)}, 400)
                return

            matches = project_matcher.find_matches(
                bpm=reference.get("bpm"),
                key=reference.get("key"),
                title=reference.get("title"),
                daw=daw,
                limit=20,
            )
            recent_links = ref_links.list_recent(limit=5)
            self._json({
                "reference": reference,
                "matches": matches,
                "message_he": (
                    f"ניתחתי: {reference.get('title')} — "
                    f"{reference.get('bpm') or '?'} BPM, Key {reference.get('key') or '?'}. "
                    f"נמצאו {len(matches)} פרויקטים מתאימים."
                ),
                "recent_links": recent_links,
            })

        def _handle_match_open(
            self,
            project_path: str,
            reference_id: str | None = None,
            reference_source: str | None = None,
            reference_title: str | None = None,
            bpm: float | None = None,
            key: str | None = None,
            link_only: bool = False,
        ) -> None:
            result: dict[str, Any] = {"project_path": project_path}
            if reference_id and reference_source:
                link_result = ref_links.link(
                    reference_id=reference_id,
                    reference_source=reference_source,
                    reference_title=reference_title or reference_id,
                    project_path=project_path,
                    bpm=bpm,
                    key=key,
                )
                result["link"] = link_result

            if not link_only:
                open_result = open_project(project_path)
                result["open"] = open_result
                if not open_result.get("ok"):
                    self._json(result, 400)
                    return

            self._json({
                **result,
                "message_he": "הפרויקט שויך לטראק ונפתח ב-Cubase" if not link_only else "הפרויקט שויך לטראק",
            })

        def _stream_reference(self, ref_id: str) -> None:
            path = ref_analyzer.resolve_audio_path(ref_id)
            if path is None:
                self._json({"error": "reference not found"}, 404)
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

        def do_POST(self) -> None:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            body = self._read_json_body()

            if path == "/api/match/analyze":
                source = str(body.get("source") or "").strip()
                daw = body.get("daw")
                if not source:
                    self._json({"error": "source required"}, 400)
                    return
                self._handle_match_analyze(source, daw)
                return

            if path == "/api/match/open":
                project_path = str(body.get("project_path") or "").strip()
                if not project_path:
                    self._json({"error": "project_path required"}, 400)
                    return
                self._handle_match_open(
                    project_path=project_path,
                    reference_id=body.get("reference_id"),
                    reference_source=body.get("reference_source"),
                    reference_title=body.get("reference_title"),
                    bpm=body.get("bpm"),
                    key=body.get("key"),
                    link_only=bool(body.get("link_only")),
                )
                return

            self._json({"error": "not found"}, 404)

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

            if path == "/api/match/analyze":
                source = qs.get("source", [""])[0]
                daw = qs.get("daw", [None])[0]
                if not source:
                    self._json({"error": "source required"}, 400)
                    return
                self._handle_match_analyze(source, daw)
                return

            if path == "/api/match/open":
                project_path = qs.get("project", [""])[0]
                if not project_path:
                    self._json({"error": "project required"}, 400)
                    return
                self._handle_match_open(
                    project_path=project_path,
                    reference_id=qs.get("ref_id", [None])[0],
                    reference_source=qs.get("ref_source", [None])[0],
                    reference_title=qs.get("ref_title", [None])[0],
                    bpm=float(qs["bpm"][0]) if qs.get("bpm") else None,
                    key=qs.get("key", [None])[0],
                )
                return

            if path == "/api/match/links":
                project = qs.get("project", [None])[0]
                links = ref_links.list_for_project(project) if project else ref_links.list_recent()
                self._json({"links": links})
                return

            ref_stream = re.fullmatch(r"/api/reference/([^/]+)/stream", path)
            if ref_stream:
                self._stream_reference(ref_stream.group(1))
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
    print(f"  חיפוש:   http://{host}:{port}/search")
    print(f"  התאמה:   http://{host}:{port}/match")
    server.serve_forever()
