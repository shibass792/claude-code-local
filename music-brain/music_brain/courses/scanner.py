"""Scan videos and guide documents for the course transcriber."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Iterator

from music_brain.courses.classifier import (
    classify_guide_category,
    classify_video_category,
    detect_daw_topic,
)
from music_brain.database.knowledge_db import KnowledgeDB
from music_brain.models.types import FileKind


def _file_hash(path: Path, size: int, mtime: float) -> str:
    h = hashlib.sha256()
    h.update(f"{size}:{mtime}".encode())
    try:
        with open(path, "rb") as f:
            h.update(f.read(8192))
    except OSError:
        pass
    return h.hexdigest()[:32]


def _should_skip_dir(dirname: str) -> bool:
    skip = {
        "$recycle.bin",
        "system volume information",
        "windows",
        "program files",
        "program files (x86)",
        "programdata",
        "node_modules",
        ".git",
        "__pycache__",
        "cache",
        "caches",
        ".venv",
        "appdata\\local\\temp",
    }
    d = dirname.lower().replace("/", "\\")
    return any(s in d for s in skip)


def iter_media_files(
    roots: list[str],
    video_ext: list[str],
    guide_ext: list[str],
) -> Iterator[tuple[Path, FileKind]]:
    video_set = {e.lower() for e in video_ext}
    guide_set = {e.lower() for e in guide_ext}
    all_ext = video_set | guide_set

    for root in roots:
        root_path = Path(root)
        if not root_path.exists():
            continue
        try:
            for dirpath, dirnames, filenames in os.walk(root_path, topdown=True):
                dirnames[:] = [
                    d for d in dirnames if not _should_skip_dir(os.path.join(dirpath, d))
                ]
                for name in filenames:
                    p = Path(dirpath) / name
                    ext = p.suffix.lower()
                    if ext in video_set:
                        yield p, FileKind.VIDEO
                    elif ext in guide_set:
                        yield p, FileKind.GUIDE
        except (PermissionError, OSError):
            continue


class CourseScanner:
    def __init__(
        self,
        db: KnowledgeDB,
        scan_paths: list[str],
        video_extensions: list[str],
        guide_extensions: list[str],
        path_keywords: list[str] | None = None,
        include_all_videos: bool = True,
        include_all_guides: bool = True,
    ) -> None:
        self.db = db
        self.scan_paths = scan_paths
        self.video_extensions = video_extensions
        self.guide_extensions = guide_extensions
        self.path_keywords = path_keywords or []
        self.include_all_videos = include_all_videos
        self.include_all_guides = include_all_guides

    def _should_index(self, path: Path, kind: FileKind) -> bool:
        if kind == FileKind.VIDEO and self.include_all_videos:
            return True
        if kind == FileKind.GUIDE and self.include_all_guides:
            return True
        blob = str(path).lower()
        return any(kw.lower() in blob for kw in self.path_keywords)

    def scan(self) -> dict[str, int]:
        found = 0
        new = 0
        updated = 0
        run_id = self.db.start_scan_run(self.scan_paths)

        for path, kind in iter_media_files(
            self.scan_paths,
            self.video_extensions,
            self.guide_extensions,
        ):
            if not self._should_index(path, kind):
                continue
            try:
                stat = path.stat()
            except OSError:
                continue

            found += 1
            content_hash = _file_hash(path, stat.st_size, stat.st_mtime)
            if kind == FileKind.VIDEO:
                library = classify_video_category(path, self.path_keywords)
            else:
                library = classify_guide_category(path)
            library_sub = detect_daw_topic(path) or library

            file_id, is_new = self.db.upsert_file(
                path=str(path.resolve()),
                kind=kind.value,
                size_bytes=stat.st_size,
                mtime=stat.st_mtime,
                content_hash=content_hash,
                library=library,
                library_sub=library_sub,
            )
            if is_new:
                new += 1
            else:
                updated += 1

        self.db.finish_scan_run(run_id, found, new, updated)
        return {"found": found, "new": new, "updated": updated}
