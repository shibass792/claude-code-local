"""Cubase Companion — auto-detect project saves and emit recommendations."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Callable

from music_brain.config import resolve_data_path
from music_brain.bridge.cubase_bridge import CubaseBridge
from music_brain.brain.learner import Brain
from music_brain.database.knowledge_db import KnowledgeDB
from music_brain.matcher.engine import MatcherEngine


class CubaseCompanion:
    """
    Watches Cubase project folders. When a .cpr is saved:
    - Learns Project DNA
    - Generates bass/lead/kick recommendations
    - Writes JSON for UI / future VST plugin
    """

    def __init__(
        self,
        db: KnowledgeDB,
        cfg: dict[str, Any],
        on_recommendations: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self.db = db
        self.cfg = cfg
        self.on_recommendations = on_recommendations
        companion_cfg = cfg.get("cubase_companion", {})
        self.watch_folders = companion_cfg.get("watch_folders", [])
        self.output_file = Path(
            companion_cfg.get("recommendations_file", "data/cubase_recommendations.json")
        )
        if not self.output_file.is_absolute():
            self.output_file = resolve_data_path(str(self.output_file))

        matcher = MatcherEngine(db, cfg.get("matcher_weights"))
        brain = Brain(db)
        bridge_cfg = cfg.get("cubase_bridge", {})
        self.bridge = CubaseBridge(
            db, matcher, brain,
            enabled=bridge_cfg.get("enabled", False),
            osc_host=bridge_cfg.get("osc_host", "127.0.0.1"),
            osc_port=bridge_cfg.get("osc_port", 9000),
        )
        self._seen: dict[str, float] = {}

    def process_project(self, project_path: str) -> dict[str, Any]:
        result = self.bridge.on_project_open(project_path)
        self._write_output(result)
        if self.on_recommendations:
            self.on_recommendations(result)
        return result

    def _write_output(self, data: dict[str, Any]) -> None:
        self.output_file.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "updated_at": time.time(),
            **data,
        }
        self.output_file.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def scan_once(self) -> list[dict[str, Any]]:
        """Check all watch folders for new/modified .cpr files."""
        results: list[dict[str, Any]] = []
        for folder in self.watch_folders:
            root = Path(folder)
            if not root.exists():
                continue
            for cpr in root.rglob("*.cpr"):
                try:
                    mtime = cpr.stat().st_mtime
                except OSError:
                    continue
                key = str(cpr)
                if self._seen.get(key) == mtime:
                    continue
                self._seen[key] = mtime
                results.append(self.process_project(key))
        return results

    def run_forever(self, interval_sec: int = 10) -> None:
        while True:
            self.scan_once()
            time.sleep(interval_sec)


def run_cubase_watchdog(
    db: KnowledgeDB,
    cfg: dict[str, Any],
    on_recommendations: Callable[[dict[str, Any]], None] | None = None,
) -> None:
    """Event-driven .cpr watcher via watchdog."""
    try:
        from watchdog.events import FileSystemEventHandler
        from watchdog.observers import Observer
    except ImportError as e:
        raise ImportError("pip install music-brain[watch]") from e

    companion = CubaseCompanion(db, cfg, on_recommendations=on_recommendations)

    class Handler(FileSystemEventHandler):
        def on_modified(self, event: object) -> None:
            path = getattr(event, "src_path", "")
            if str(path).lower().endswith(".cpr"):
                companion.process_project(str(path))

        def on_created(self, event: object) -> None:
            self.on_modified(event)

    observer = Observer()
    handler = Handler()
    for folder in companion.watch_folders:
        p = Path(folder)
        if p.exists():
            observer.schedule(handler, str(p), recursive=True)
    observer.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
