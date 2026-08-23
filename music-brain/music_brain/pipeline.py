"""End-to-end pipelines: scan → analyze → DNA → brain."""

from __future__ import annotations

from typing import Callable

from music_brain.analyzer.audio import analyze_file
from music_brain.analyzer.project_dna import extract_project_dna
from music_brain.brain import ingest_project, learn_summary
from music_brain.db import KnowledgeDB
from music_brain.scanner import scan

ProgressCb = Callable[[str], None]


def run_analyze(
    db: KnowledgeDB,
    *,
    force: bool = False,
    limit: int | None = None,
    progress: ProgressCb | None = None,
) -> dict[str, int]:
    """Analyze samples that are new or changed; extract DNA for projects."""
    stats = {"samples_analyzed": 0, "projects_dna": 0, "skipped": 0}

    rows = db._conn.execute(
        "SELECT id, path, kind, role_hint, mtime_ns FROM files WHERE kind IN ('sample','project')"
    ).fetchall()

    done = 0
    for row in rows:
        if limit is not None and done >= limit:
            break
        file_id = int(row["id"])
        path = row["path"]
        kind = row["kind"]
        mtime_ns = int(row["mtime_ns"])

        if kind == "sample":
            if not force and not db.needs_analysis(file_id, mtime_ns):
                stats["skipped"] += 1
                continue
            if progress:
                progress(f"analyze sample {path}")
            result = analyze_file(path, role_hint=row["role_hint"])
            db.upsert_analysis(file_id, result)
            stats["samples_analyzed"] += 1
            done += 1
        elif kind == "project":
            if progress:
                progress(f"dna project {path}")
            try:
                ingest_project(db, path)
            except Exception:
                dna = extract_project_dna(path)
                db.upsert_project_dna(file_id, dna)
            stats["projects_dna"] += 1
            done += 1

    return stats


def full_pipeline(
    db: KnowledgeDB,
    roots: list[str] | None = None,
    *,
    force: bool = False,
    progress: ProgressCb | None = None,
) -> dict:
    scan_stats = scan(db, roots, force=force, progress=progress)
    analyze_stats = run_analyze(db, force=force, progress=progress)
    brain = learn_summary(db)
    return {
        "scan": scan_stats.__dict__,
        "analyze": analyze_stats,
        "brain": brain,
    }
