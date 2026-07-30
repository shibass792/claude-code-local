"""Background watcher — scan + analyze on new/changed files."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Callable

from music_brain.database.knowledge_db import KnowledgeDB
from music_brain.services.pipeline import analyze_batch, run_scan


class MusicBrainWatcher:
    """Poll-based watcher (works everywhere). Optional watchdog for events."""

    def __init__(
        self,
        db: KnowledgeDB,
        cfg: dict[str, Any],
        interval_sec: int = 300,
        analyze_limit: int = 50,
        on_tick: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self.db = db
        self.cfg = cfg
        self.interval_sec = interval_sec
        self.analyze_limit = analyze_limit
        self.on_tick = on_tick
        self._running = False

    def tick(self) -> dict[str, Any]:
        scan_stats = run_scan(self.db, self.cfg)
        analyze_stats = analyze_batch(self.db, limit=self.analyze_limit)
        result = {"scan": scan_stats, "analyze": analyze_stats}
        if self.on_tick:
            self.on_tick(result)
        return result

    def run_forever(self) -> None:
        self._running = True
        while self._running:
            self.tick()
            time.sleep(self.interval_sec)

    def stop(self) -> None:
        self._running = False


def run_watchdog(
    db: KnowledgeDB,
    cfg: dict[str, Any],
    analyze_limit: int = 20,
    debounce_sec: float = 5.0,
) -> None:
    """Event-driven watcher using watchdog (pip install watchdog)."""
    try:
        from watchdog.events import FileSystemEventHandler
        from watchdog.observers import Observer
    except ImportError as e:
        raise ImportError(
            "Install watchdog: pip install music-brain[watch]"
        ) from e

    last_run = 0.0

    class Handler(FileSystemEventHandler):
        def on_any_event(self, event: object) -> None:
            nonlocal last_run
            if getattr(event, "is_directory", False):
                return
            now = time.time()
            if now - last_run < debounce_sec:
                return
            last_run = now
            run_scan(db, cfg)
            analyze_batch(db, limit=analyze_limit)

    observer = Observer()
    handler = Handler()
    for root in cfg.get("scan_paths", []):
        p = Path(root)
        if p.exists():
            observer.schedule(handler, str(p), recursive=True)
    observer.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
