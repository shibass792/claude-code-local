"""Re-classify files into music / samples libraries."""

from __future__ import annotations

import json

from music_brain.database.knowledge_db import KnowledgeDB
from music_brain.library.classifier import classify_path


def refine_file_library(
    db: KnowledgeDB,
    file_id: int,
    path: str,
    category_hint: str | None = None,
    duration_sec: float | None = None,
) -> None:
    kind, library, library_sub = classify_path(path, category_hint, duration_sec)
    db.update_file_library(file_id, kind, library, library_sub)


def refine_after_analysis(db: KnowledgeDB, file_id: int, path: str, features: dict) -> None:
    duration = features.get("duration_sec")
    category = features.get("category")
    refine_file_library(
        db,
        file_id,
        path,
        category_hint=category,
        duration_sec=float(duration) if duration is not None else None,
    )


def reclassify_all(db: KnowledgeDB, limit: int = 500000) -> int:
    """Re-run library classification on all indexed audio files."""
    rows = db.get_all_audio_files(limit=limit)
    updated = 0
    for row in rows:
        duration: float | None = None
        analysis = db._conn.execute(
            "SELECT features_json FROM audio_analysis WHERE file_id=?",
            (row["id"],),
        ).fetchone()
        if analysis:
            try:
                feats = json.loads(analysis["features_json"])
                duration = feats.get("duration_sec")
            except (json.JSONDecodeError, TypeError):
                duration = None

        kind, library, library_sub = classify_path(
            row["path"],
            row["category_hint"],
            float(duration) if duration is not None else None,
        )
        if (
            row["kind"] != kind
            or row["library"] != library
            or row["library_sub"] != library_sub
        ):
            db.update_file_library(int(row["id"]), kind, library, library_sub)
            updated += 1
    return updated
