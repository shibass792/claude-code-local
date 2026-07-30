"""Safe audio streaming for indexed library files."""

from __future__ import annotations

import mimetypes
from pathlib import Path

from music_brain.database.knowledge_db import KnowledgeDB

AUDIO_MIME = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".aif": "audio/aiff",
    ".aiff": "audio/aiff",
}


def mime_for_path(path: Path) -> str:
    ext = path.suffix.lower()
    return AUDIO_MIME.get(ext, mimetypes.guess_type(str(path))[0] or "application/octet-stream")


def resolve_indexed_file(db: KnowledgeDB, file_id: int) -> Path | None:
    row = db.get_file_by_id(file_id)
    if row is None:
        return None
    if row["kind"] not in ("audio", "sample"):
        return None
    path = Path(row["path"])
    if not path.is_file():
        return None
    return path


def resolve_indexed_path(db: KnowledgeDB, file_path: str) -> tuple[int, Path] | None:
    row = db.get_file_by_path(file_path)
    if row is None:
        return None
    if row["kind"] not in ("audio", "sample"):
        return None
    path = Path(row["path"])
    if not path.is_file():
        return None
    return int(row["id"]), path


def read_file_range(path: Path, start: int, end: int) -> bytes:
    with open(path, "rb") as f:
        f.seek(start)
        return f.read(end - start + 1)
