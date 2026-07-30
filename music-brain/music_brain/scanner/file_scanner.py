"""Step 1 — incremental multi-drive scanner."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Iterator

from music_brain.database.knowledge_db import KnowledgeDB
from music_brain.models.types import FileKind, ScannedFile, SoundCategory

# Path keywords → category hints
CATEGORY_KEYWORDS: dict[SoundCategory, list[str]] = {
    SoundCategory.BASS: ["bass", "sub", "reese", "rolling", "offbeat", "goa", "fullon"],
    SoundCategory.LEAD: ["lead", "melody", "arp", "pluck", "stab"],
    SoundCategory.KICK: ["kick", "kicks", "bd", "bassdrum"],
    SoundCategory.PAD: ["pad", "pads", "atmosphere", "ambient"],
    SoundCategory.FX: ["fx", "sfx", "riser", "impact", "whoosh", "transition"],
    SoundCategory.VOCAL: ["vocal", "vox", "voice", "acapella"],
    SoundCategory.DRUM: ["drum", "loop", "perc", "percussion"],
}


def _file_hash(path: Path, size: int, mtime: float) -> str:
    """Fast fingerprint: size + mtime + first 8KB (for large files)."""
    h = hashlib.sha256()
    h.update(f"{size}:{mtime}".encode())
    try:
        with open(path, "rb") as f:
            h.update(f.read(8192))
    except OSError:
        pass
    return h.hexdigest()[:32]


def _detect_plugin(path: Path, plugins: dict[str, list[str]]) -> str | None:
    path_lower = str(path).lower()
    for _group, names in plugins.items():
        for name in names:
            if name.lower() in path_lower:
                return name
    return None


def _detect_category(path: Path) -> SoundCategory:
    path_lower = str(path).lower()
    for cat, keywords in CATEGORY_KEYWORDS.items():
        for kw in keywords:
            if kw in path_lower:
                return cat
    return SoundCategory.UNKNOWN


def _classify_extension(
    path: Path,
    audio_ext: set[str],
    project_ext: set[str],
    preset_ext: set[str],
) -> FileKind:
    ext = path.suffix.lower()
    if ext in audio_ext:
        return FileKind.AUDIO
    if ext in project_ext:
        return FileKind.PROJECT
    if ext in preset_ext:
        return FileKind.PRESET
    return FileKind.UNKNOWN


def _should_skip_dir(dirname: str) -> bool:
    skip = {
        "$recycle.bin",
        "system volume information",
        "windows",
        "program files",
        "program files (x86)",
        "programdata",
        "appdata\\local\\temp",
        "node_modules",
        ".git",
        "__pycache__",
        "cache",
        "caches",
    }
    d = dirname.lower().replace("/", "\\")
    return any(s in d for s in skip)


def iter_files(
    roots: list[str],
    audio_ext: list[str],
    project_ext: list[str],
    preset_ext: list[str],
) -> Iterator[Path]:
    audio_set = {e.lower() for e in audio_ext}
    project_set = {e.lower() for e in project_ext}
    preset_set = {e.lower() for e in preset_ext}
    all_ext = audio_set | project_set | preset_set

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
                    if p.suffix.lower() in all_ext:
                        yield p
        except (PermissionError, OSError):
            continue


class Scanner:
    """Scans only new or changed files when incremental=True."""

    def __init__(
        self,
        db: KnowledgeDB,
        scan_paths: list[str],
        audio_extensions: list[str],
        project_extensions: list[str],
        preset_extensions: list[str],
        plugins: dict[str, list[str]],
        incremental: bool = True,
    ) -> None:
        self.db = db
        self.scan_paths = scan_paths
        self.audio_extensions = audio_extensions
        self.project_extensions = project_extensions
        self.preset_extensions = preset_extensions
        self.plugins = plugins
        self.incremental = incremental

    def scan(self) -> dict[str, int]:
        run_id = self.db.start_scan_run(self.scan_paths)
        found = 0
        new_count = 0
        updated = 0

        for path in iter_files(
            self.scan_paths,
            self.audio_extensions,
            self.project_extensions,
            self.preset_extensions,
        ):
            found += 1
            try:
                stat = path.stat()
            except OSError:
                continue

            kind = _classify_extension(
                path,
                set(self.audio_extensions),
                set(self.project_extensions),
                set(self.preset_extensions),
            )
            if kind == FileKind.UNKNOWN:
                continue

            content_hash = _file_hash(path, stat.st_size, stat.st_mtime)
            plugin_hint = _detect_plugin(path, self.plugins)
            category = _detect_category(path)

            if self.incremental:
                existing = self.db.get_file_by_path(str(path))
                if existing and (
                    existing["mtime"] == stat.st_mtime
                    and existing["size_bytes"] == stat.st_size
                    and existing["content_hash"] == content_hash
                ):
                    continue

            file_id, is_new = self.db.upsert_file(
                path=str(path),
                kind=kind.value if kind == FileKind.AUDIO else (
                    "sample" if "sample" in str(path).lower() else kind.value
                ),
                size_bytes=stat.st_size,
                mtime=stat.st_mtime,
                content_hash=content_hash,
                plugin_hint=plugin_hint,
                category_hint=category.value,
            )
            if is_new:
                new_count += 1
            else:
                updated += 1

            if plugin_hint:
                self.db.increment_usage("plugin", plugin_hint)

        self.db.finish_scan_run(run_id, found, new_count, updated)
        return {"found": found, "new": new_count, "updated": updated}

    def scan_file(self, path: str) -> ScannedFile | None:
        p = Path(path)
        if not p.exists():
            return None
        stat = p.stat()
        kind = _classify_extension(
            p,
            set(self.audio_extensions),
            set(self.project_extensions),
            set(self.preset_extensions),
        )
        return ScannedFile(
            path=str(p),
            kind=kind,
            size_bytes=stat.st_size,
            mtime=stat.st_mtime,
            content_hash=_file_hash(p, stat.st_size, stat.st_mtime),
            plugin_hint=_detect_plugin(p, self.plugins),
            category_hint=_detect_category(p),
        )
