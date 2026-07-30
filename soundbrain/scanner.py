"""Stage 1 — the scanner.

Walks every configured root (``H:\\``, ``D:\\``, ``F:\\``,
``C:\\Users\\shibass\\`` ...), classifies what it finds, and records it in the
knowledge database. Only new or modified files are reported as work for the
analyser, which is what keeps repeat scans of a multi-terabyte sample
collection fast.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from pathlib import Path, PurePath
from typing import Callable, Iterable, Iterator, Sequence

from .config import (
    ARCHIVE_EXTENSIONS,
    AUDIO_EXTENSIONS,
    Config,
    MIDI_EXTENSIONS,
    PLUGIN_BINARY_EXTENSIONS,
    PRESET_EXTENSIONS,
    PRESET_EXT_TO_TOOL,
    PROJECT_EXTENSIONS,
    REQUIRED_COVERAGE,
    TOOLS,
)
from .db import Database, FileRecord

ProgressFn = Callable[[str, int], None]

#: folder names that hint "this is a plugin folder", used to avoid indexing
#: every .dll on the machine
PLUGIN_DIR_HINTS = ("vstplugins", "vst3", "vstplugin", "plugins", "common files\\vst", "common files/vst", "steinberg")

#: folders that usually mean "this audio file is part of a project", not a
#: reusable sample
PROJECT_AUDIO_HINTS = ("audio", "freeze", "bounces", "images", "edits", "samples/recorded")


@dataclass
class ScanStats:
    seen: int = 0
    added: int = 0
    changed: int = 0
    unchanged: int = 0
    skipped: int = 0
    errors: int = 0
    dirs: int = 0
    missing: int = 0
    by_kind: dict[str, int] = field(default_factory=dict)
    elapsed: float = 0.0

    def as_dict(self) -> dict[str, object]:
        return {
            "seen": self.seen,
            "added": self.added,
            "changed": self.changed,
            "unchanged": self.unchanged,
            "skipped": self.skipped,
            "errors": self.errors,
            "dirs": self.dirs,
            "missing": self.missing,
            "by_kind": dict(sorted(self.by_kind.items())),
            "elapsed": round(self.elapsed, 2),
        }


def _norm(path: str) -> str:
    return path.replace("\\", "/").lower()


def _drive_of(path: Path) -> str:
    drive = path.drive
    if drive:
        return drive.rstrip(":\\/").upper() + ":"
    parts = path.parts
    return parts[1] if len(parts) > 1 else "/"


def detect_tool(path: Path) -> tuple[str | None, str | None]:
    """Guess which tool a path belongs to.

    Returns ``(tool_name, tool_kind)``. The extension is authoritative when it
    is exclusive to one tool (``.nki`` -> Kontakt); otherwise we look for tool
    names in the folder chain, longest signature first so that "Massive X"
    beats "Massive".
    """
    ext = path.suffix.lower()
    normalized = _norm(str(path))

    by_ext = PRESET_EXT_TO_TOOL.get(ext)
    best: tuple[str, str] | None = None
    best_len = 0
    for tool in TOOLS:
        for sig in tool.signatures:
            if sig and sig in normalized and len(sig) > best_len:
                best = (tool.name, tool.kind)
                best_len = len(sig)
    if best:
        return best
    if by_ext:
        spec = next((t for t in TOOLS if t.name == by_ext), None)
        return by_ext, (spec.kind if spec else "instrument")
    generic = PRESET_EXTENSIONS.get(ext)
    if generic:
        return generic, "instrument"
    return None, None


def library_of(path: Path, root: Path) -> str | None:
    """The top-level collection folder a sample belongs to.

    ``H:/Samples/Zenhiser Psytrance/Bass/roll_01.wav`` -> ``Zenhiser Psytrance``.
    """
    try:
        rel = path.relative_to(root)
    except ValueError:
        rel = PurePath(path.name)
    parts = list(rel.parts[:-1])
    generic = {"samples", "sample", "sounds", "audio", "packs", "pack", "library", "libraries", "loops", "one shots", "oneshots"}
    for part in parts:
        if part.lower() not in generic and not part.startswith("$"):
            return part
    return parts[0] if parts else None


def classify(path: Path, root: Path, stat: os.stat_result) -> FileRecord | None:
    """Turn a path into a :class:`FileRecord`, or ``None`` if it is not ours."""
    ext = path.suffix.lower()
    normalized = _norm(str(path))
    kind: str | None = None
    daw: str | None = None

    if ext in PROJECT_EXTENSIONS:
        if ext == ".bak" and not path.with_suffix(".cpr").exists():
            return None
        kind = "project"
        daw = PROJECT_EXTENSIONS[ext]
    elif ext in AUDIO_EXTENSIONS:
        kind = "audio"
    elif ext in PRESET_EXTENSIONS:
        kind = "preset"
    elif ext in PLUGIN_BINARY_EXTENSIONS:
        if ext in (".dll", ".vst") and not any(hint in normalized for hint in PLUGIN_DIR_HINTS):
            return None
        kind = "plugin"
    elif ext in MIDI_EXTENSIONS:
        kind = "midi"
    elif ext in ARCHIVE_EXTENSIONS:
        kind = "archive"
    else:
        return None

    tool, _tool_kind = detect_tool(path)
    if kind == "project" and daw:
        tool = tool or daw
    if kind == "audio":
        library = library_of(path, root)
    else:
        library = library_of(path, root)

    return FileRecord(
        path=str(path),
        root=str(root),
        drive=_drive_of(path),
        name=path.name,
        ext=ext,
        kind=kind,
        size=int(stat.st_size),
        mtime_ns=int(stat.st_mtime_ns),
        tool=tool,
        daw=daw if kind == "project" else None,
        library=library,
    )


def _should_skip_dir(path: Path, cfg: Config) -> bool:
    normalized = _norm(str(path))
    name = path.name.lower()
    if name in {n.lower() for n in cfg.skip_names}:
        return True
    return any(pattern in normalized for pattern in (p.lower() for p in cfg.skip_dirs))


def walk(root: Path, cfg: Config, stats: ScanStats | None = None) -> Iterator[tuple[Path, os.stat_result]]:
    """Depth-limited, error-tolerant directory walk."""
    stack: list[tuple[Path, int]] = [(root, 0)]
    while stack:
        current, depth = stack.pop()
        if depth > cfg.max_depth:
            continue
        try:
            entries = list(os.scandir(current))
        except (PermissionError, FileNotFoundError, NotADirectoryError, OSError):
            if stats:
                stats.errors += 1
            continue
        if stats:
            stats.dirs += 1
        for entry in entries:
            try:
                if entry.is_dir(follow_symlinks=cfg.follow_symlinks):
                    child = Path(entry.path)
                    if _should_skip_dir(child, cfg):
                        if stats:
                            stats.skipped += 1
                        continue
                    stack.append((child, depth + 1))
                elif entry.is_file(follow_symlinks=cfg.follow_symlinks):
                    yield Path(entry.path), entry.stat(follow_symlinks=cfg.follow_symlinks)
            except OSError:
                if stats:
                    stats.errors += 1
                continue


def scan(
    db: Database,
    cfg: Config,
    roots: Sequence[str] | None = None,
    progress: ProgressFn | None = None,
    commit_every: int = 500,
) -> ScanStats:
    """Stage 1: index every root, incrementally."""
    targets = [Path(r).expanduser() for r in (roots or cfg.roots)]
    stats = ScanStats()
    started = time.time()
    run_id = db.start_scan([str(t) for t in targets])
    tool_examples: dict[str, tuple[str, str]] = {}

    for root in targets:
        if not root.exists():
            continue
        for path, stat in walk(root, cfg, stats):
            rec = classify(path, root, stat)
            if rec is None:
                continue
            try:
                _file_id, status = db.upsert_file(rec)
            except Exception:  # pragma: no cover - sqlite level failure
                stats.errors += 1
                continue
            stats.seen += 1
            stats.by_kind[rec.kind] = stats.by_kind.get(rec.kind, 0) + 1
            if status == "new":
                stats.added += 1
            elif status == "changed":
                stats.changed += 1
            else:
                stats.unchanged += 1

            # Attribute both what the path says and what the record concluded, so
            # a DAW recognised only by its project extension (an .als in a folder
            # that never spells out "Ableton") still shows up in the inventory.
            tool, tool_kind = detect_tool(path)
            if tool:
                tool_examples[tool] = (tool_kind or "instrument", str(path))
            if rec.tool and rec.tool not in tool_examples:
                spec = next((t for t in TOOLS if t.name == rec.tool), None)
                tool_examples[rec.tool] = (spec.kind if spec else ("daw" if rec.daw else "instrument"), str(path))

            if progress and stats.seen % commit_every == 0:
                progress(str(path), stats.seen)
            if stats.seen % commit_every == 0:
                db.commit()

    for name, (kind, example) in tool_examples.items():
        db.bump_tool(name, kind, example)

    stats.missing = db.mark_missing([str(t) for t in targets], started)
    stats.elapsed = time.time() - started
    db.commit()
    db.finish_scan(
        run_id,
        {
            "seen": stats.seen,
            "added": stats.added,
            "changed": stats.changed,
            "skipped": stats.skipped,
            "errors": stats.errors,
        },
    )
    return stats


def inventory(db: Database) -> dict[str, object]:
    """What the scanner found, grouped for a human: DAWs, instruments, coverage."""
    tools = db.tools()
    by_kind: dict[str, list[dict[str, object]]] = {}
    found_names = set()
    for row in tools:
        entry = {"name": row["name"], "hits": int(row["hits"]), "example": row["example"]}
        by_kind.setdefault(str(row["kind"] or "other"), []).append(entry)
        found_names.add(str(row["name"]))

    drive_rows = db.conn.execute(
        """SELECT drive, kind, COUNT(*) AS n, SUM(size) AS bytes FROM files
           WHERE missing=0 GROUP BY drive, kind ORDER BY drive"""
    )
    drives: dict[str, dict[str, object]] = {}
    for row in drive_rows:
        drive = str(row["drive"] or "?")
        bucket = drives.setdefault(drive, {"files": 0, "bytes": 0, "kinds": {}})
        bucket["files"] = int(bucket["files"]) + int(row["n"])  # type: ignore[index]
        bucket["bytes"] = int(bucket["bytes"]) + int(row["bytes"] or 0)  # type: ignore[index]
        bucket["kinds"][str(row["kind"])] = int(row["n"])  # type: ignore[index]

    libraries = [
        {"library": str(row["library"]), "files": int(row["n"])}
        for row in db.conn.execute(
            """SELECT library, COUNT(*) AS n FROM files
               WHERE kind='audio' AND missing=0 AND library IS NOT NULL
               GROUP BY library ORDER BY n DESC LIMIT 40"""
        )
    ]

    coverage = {name: name in found_names for name in REQUIRED_COVERAGE}
    return {
        "counts": db.counts(),
        "drives": drives,
        "tools": by_kind,
        "libraries": libraries,
        "coverage": coverage,
        "coverage_missing": [name for name, ok in coverage.items() if not ok],
    }
