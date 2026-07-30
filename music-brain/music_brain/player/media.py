"""Media library helpers for the SHIBASS player panel."""

from __future__ import annotations

import mimetypes
import os
import re
from pathlib import Path
from typing import Any, Iterable

from music_brain.config import SAMPLE_EXTENSIONS, resolve_roots
from music_brain.db import KnowledgeDB

AUDIO_EXTENSIONS = SAMPLE_EXTENSIONS | {".m4a", ".aac", ".wma", ".opus"}
MIDI_EXTENSIONS = {".mid", ".midi"}
MEDIA_EXTENSIONS = AUDIO_EXTENSIONS | MIDI_EXTENSIONS

FOLDER_CATEGORIES = {
    "midi": MIDI_EXTENSIONS,
    "wav": {".wav", ".aiff", ".aif", ".flac"},
    "music": {".mp3", ".m4a", ".aac", ".ogg", ".opus", ".wma", ".flac"},
    "samples": SAMPLE_EXTENSIONS,
}


def classify_media(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in MIDI_EXTENSIONS:
        return "midi"
    if ext in {".wav", ".aiff", ".aif"}:
        return "wav"
    if ext in {".mp3", ".m4a", ".aac", ".ogg", ".opus", ".wma"}:
        return "music"
    if ext in SAMPLE_EXTENSIONS:
        return "samples"
    return "other"


def ensure_media_indexed(db: KnowledgeDB, roots: list[str] | None = None) -> dict[str, int]:
    """Light pass: index audio + MIDI under roots into the knowledge DB."""
    resolved = resolve_roots(roots)
    stats = {"seen": 0, "inserted": 0}
    for root in resolved:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [
                d
                for d in dirnames
                if not d.startswith(".")
                and d.lower() not in {"$recycle.bin", "system volume information", "node_modules"}
            ]
            for fn in filenames:
                p = Path(dirpath) / fn
                ext = p.suffix.lower()
                if ext not in MEDIA_EXTENSIONS:
                    continue
                stats["seen"] += 1
                try:
                    st = p.stat()
                except OSError:
                    continue
                mtime_ns = getattr(st, "st_mtime_ns", int(st.st_mtime * 1e9))
                prev = db.get_file_mtime(str(p))
                if prev is not None and prev == mtime_ns:
                    continue
                kind = "midi" if ext in MIDI_EXTENSIONS else "sample"
                if ext in {".mp3", ".m4a", ".flac", ".ogg", ".opus", ".wma", ".aac"}:
                    kind = "track"
                from music_brain.scanner import detect_daw, detect_plugin, detect_role_hint

                db.upsert_file(
                    {
                        "path": str(p),
                        "root": str(root),
                        "kind": kind,
                        "extension": ext,
                        "size_bytes": st.st_size,
                        "mtime_ns": mtime_ns,
                        "role_hint": detect_role_hint(p),
                        "daw": detect_daw(p),
                        "plugin": detect_plugin(p),
                    }
                )
                stats["inserted"] += 1
    return stats


def list_media(
    db: KnowledgeDB,
    *,
    category: str | None = None,
    q: str | None = None,
    extension: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> list[dict[str, Any]]:
    clauses = [
        "lower(ifnull(f.extension,'')) IN ({})".format(
            ",".join("?" for _ in MEDIA_EXTENSIONS)
        )
    ]
    params: list[Any] = [e for e in sorted(MEDIA_EXTENSIONS)]

    if category and category.lower() in FOLDER_CATEGORIES:
        exts = FOLDER_CATEGORIES[category.lower()]
        clauses.append(
            "lower(ifnull(f.extension,'')) IN ({})".format(",".join("?" for _ in exts))
        )
        params.extend(sorted(exts))

    if extension:
        ext = extension if extension.startswith(".") else f".{extension}"
        clauses.append("lower(f.extension) = ?")
        params.append(ext.lower())

    if q:
        clauses.append("(f.path LIKE ? OR ifnull(a.style,'') LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like])

    where = " AND ".join(clauses)
    params.extend([limit, offset])
    rows = db._conn.execute(
        f"""
        SELECT f.id, f.path, f.kind, f.extension, f.size_bytes, f.role_hint, f.plugin,
               a.style, a.style_family, a.key, a.bpm, a.duration_sec
        FROM files f
        LEFT JOIN analyses a ON a.file_id = f.id
        WHERE {where}
        ORDER BY f.path
        LIMIT ? OFFSET ?
        """,
        params,
    ).fetchall()
    out = []
    for r in rows:
        p = Path(r["path"])
        out.append(
            {
                "id": r["id"],
                "path": r["path"],
                "name": p.name,
                "stem": p.stem,
                "folder": str(p.parent),
                "kind": r["kind"],
                "category": classify_media(p),
                "extension": r["extension"],
                "size_bytes": r["size_bytes"],
                "role_hint": r["role_hint"],
                "plugin": r["plugin"],
                "style": r["style"],
                "style_family": r["style_family"],
                "key": r["key"],
                "bpm": r["bpm"],
                "duration_sec": r["duration_sec"],
                "playable": p.suffix.lower() in AUDIO_EXTENSIONS,
                "is_midi": p.suffix.lower() in MIDI_EXTENSIONS,
            }
        )
    return out


def browser_tree(db: KnowledgeDB, limit_per_cat: int = 80) -> dict[str, list[dict[str, Any]]]:
    return {
        "midi": list_media(db, category="midi", limit=limit_per_cat),
        "wav": list_media(db, category="wav", limit=limit_per_cat),
        "music": list_media(db, category="music", limit=limit_per_cat),
        "samples": list_media(db, category="samples", limit=limit_per_cat),
    }


def resolve_media_path(db: KnowledgeDB, raw: str) -> Path | None:
    """Resolve a media path by id or absolute/relative path; must be indexed or under a root."""
    if not raw:
        return None
    if raw.isdigit():
        row = db._conn.execute("SELECT path FROM files WHERE id = ?", (int(raw),)).fetchone()
        if not row:
            return None
        p = Path(row["path"])
    else:
        p = Path(raw)
    try:
        p = p.resolve()
    except OSError:
        return None
    if not p.is_file():
        return None
    if p.suffix.lower() not in MEDIA_EXTENSIONS:
        return None
    # Allow if indexed
    if db.get_file_mtime(str(p)) is not None:
        return p
    # Or under a configured root
    for root in resolve_roots(None):
        try:
            p.relative_to(root.resolve())
            return p
        except ValueError:
            continue
    # Also allow exact path string match variants (Windows)
    row = db._conn.execute(
        "SELECT path FROM files WHERE lower(path) = lower(?)", (str(p),)
    ).fetchone()
    if row:
        return Path(row["path"])
    return None


def guess_mime(path: Path) -> str:
    ext = path.suffix.lower()
    mapping = {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
        ".aiff": "audio/aiff",
        ".aif": "audio/aiff",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".opus": "audio/opus",
        ".mid": "audio/midi",
        ".midi": "audio/midi",
    }
    if ext in mapping:
        return mapping[ext]
    mime, _ = mimetypes.guess_type(str(path))
    return mime or "application/octet-stream"
