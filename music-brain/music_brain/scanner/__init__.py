"""Incremental multi-drive scanner for DAWs, plugins, presets, and samples."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

from music_brain.config import (
    DAW_NAMES,
    PRESET_EXTENSIONS,
    PROJECT_EXTENSIONS,
    ROLE_HINTS,
    SAMPLE_EXTENSIONS,
    SKIP_DIR_NAMES,
    SYNTH_PLUGINS,
    resolve_roots,
)
from music_brain.db import KnowledgeDB

ProgressCb = Callable[[str], None]


@dataclass
class ScanStats:
    roots: list[str]
    seen: int = 0
    inserted: int = 0
    skipped_unchanged: int = 0
    samples: int = 0
    presets: int = 0
    projects: int = 0
    plugin_refs: int = 0


def _norm(s: str) -> str:
    return s.lower().replace("_", " ").replace("-", " ")


def detect_role_hint(path: Path) -> str | None:
    text = _norm(str(path))
    # Prefer more specific / longer matches by scanning families in order.
    for role, hints in ROLE_HINTS.items():
        for h in hints:
            if re.search(rf"(^|[^a-z0-9]){re.escape(h)}([^a-z0-9]|$)", text):
                return role
    return None


def detect_plugin(path: Path) -> str | None:
    text = _norm(str(path))
    # Longer names first so "Massive X" beats "Massive", "Kick 3" beats noise.
    for name in sorted(SYNTH_PLUGINS, key=len, reverse=True):
        needle = _norm(name)
        if needle in text:
            return name
    return None


def detect_daw(path: Path) -> str | None:
    text = _norm(str(path))
    for daw in DAW_NAMES:
        if _norm(daw) in text:
            return daw
    ext = path.suffix.lower()
    if ext in {".cpr", ".npr"}:
        return "Cubase"
    if ext in {".als", ".alp"}:
        return "Ableton"
    if ext == ".song":
        return "Studio One"
    if ext == ".bwproject":
        return "Bitwig"
    if ext == ".flp":
        return "FL Studio"
    if ext == ".rpp":
        return "Reaper"
    return None


def classify_kind(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in SAMPLE_EXTENSIONS:
        return "sample"
    if ext in PRESET_EXTENSIONS:
        return "preset"
    if ext in PROJECT_EXTENSIONS:
        return "project"
    # Plugin install / library folders without a clear extension.
    if detect_plugin(path) and path.is_dir():
        return "plugin_ref"
    name = path.name.lower()
    if any(p.lower() in name for p in SYNTH_PLUGINS):
        return "plugin_ref"
    return "other"


def _should_skip_dir(name: str) -> bool:
    return name.lower() in SKIP_DIR_NAMES or name.startswith(".")


def iter_files(roots: Iterable[Path], progress: ProgressCb | None = None) -> Iterable[tuple[Path, Path]]:
    """Yield (root, file_path) for every interesting file under roots."""
    interesting = SAMPLE_EXTENSIONS | PRESET_EXTENSIONS | PROJECT_EXTENSIONS
    for root in roots:
        if progress:
            progress(f"scanning {root}")
        for dirpath, dirnames, filenames in os.walk(root):
            # prune in-place
            dirnames[:] = [d for d in dirnames if not _should_skip_dir(d)]
            # Also capture plugin folders as refs
            for d in list(dirnames):
                dp = Path(dirpath) / d
                if detect_plugin(dp):
                    yield root, dp
            for fn in filenames:
                p = Path(dirpath) / fn
                if p.suffix.lower() in interesting or detect_plugin(p):
                    yield root, p


def scan(
    db: KnowledgeDB,
    roots: list[str] | None = None,
    *,
    force: bool = False,
    progress: ProgressCb | None = None,
) -> ScanStats:
    """Incremental scan — only re-index new or mtime-changed files."""
    resolved = resolve_roots(roots)
    if not resolved:
        raise SystemExit(
            "No scan roots found. Set MUSIC_BRAIN_ROOTS or pass --root. "
            f"Tried defaults for this OS."
        )

    stats = ScanStats(roots=[str(r) for r in resolved])
    per_root_counts: dict[str, int] = {str(r): 0 for r in resolved}

    for root, path in iter_files(resolved, progress=progress):
        try:
            st = path.stat() if path.exists() else None
        except OSError:
            continue
        if st is None:
            continue

        mtime_ns = getattr(st, "st_mtime_ns", int(st.st_mtime * 1e9))
        size = st.st_size if path.is_file() else 0
        path_str = str(path)
        stats.seen += 1
        per_root_counts[str(root)] = per_root_counts.get(str(root), 0) + 1

        if not force:
            prev = db.get_file_mtime(path_str)
            if prev is not None and prev == mtime_ns:
                stats.skipped_unchanged += 1
                continue

        kind = classify_kind(path)
        meta = {
            "path": path_str,
            "root": str(root),
            "kind": kind,
            "extension": path.suffix.lower() if path.is_file() else None,
            "size_bytes": size,
            "mtime_ns": mtime_ns,
            "role_hint": detect_role_hint(path),
            "daw": detect_daw(path),
            "plugin": detect_plugin(path),
        }
        db.upsert_file(meta)
        stats.inserted += 1
        if kind == "sample":
            stats.samples += 1
        elif kind == "preset":
            stats.presets += 1
        elif kind == "project":
            stats.projects += 1
        elif kind == "plugin_ref":
            stats.plugin_refs += 1

        if progress and stats.seen % 500 == 0:
            progress(f"… {stats.seen} seen, {stats.inserted} updated")

    for root_str, count in per_root_counts.items():
        db.mark_scan(root_str, count)

    return stats
