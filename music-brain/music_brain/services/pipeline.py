"""Shared scan → learn → analyze pipeline."""

from __future__ import annotations

from typing import Any

from music_brain.analyzer.audio_analyzer import AudioAnalyzer
from music_brain.brain.learner import Brain
from music_brain.database.knowledge_db import KnowledgeDB
from music_brain.library.service import refine_after_analysis, reclassify_all
from music_brain.scanner.file_scanner import Scanner


def run_scan(db: KnowledgeDB, cfg: dict[str, Any]) -> dict[str, int]:
    scanner = Scanner(
        db=db,
        scan_paths=cfg["scan_paths"],
        audio_extensions=cfg["audio_extensions"],
        project_extensions=cfg["project_extensions"],
        preset_extensions=cfg["preset_extensions"],
        plugins=cfg.get("plugins", {}),
        incremental=cfg.get("incremental", True),
    )
    return scanner.scan()


def learn_projects(db: KnowledgeDB) -> int:
    brain = Brain(db)
    rows = db._conn.execute(
        "SELECT path FROM files WHERE kind='project'"
    ).fetchall()
    learned = 0
    for row in rows:
        try:
            brain.learn_from_project(row["path"])
            learned += 1
        except Exception:
            continue
    return learned


def analyze_batch(
    db: KnowledgeDB,
    limit: int = 100,
    workers: int = 1,
) -> dict[str, int]:
    rows = db.get_unanalyzed_files(limit=limit)
    if not rows:
        return {"analyzed": 0, "failed": 0}

    if workers <= 1:
        return _analyze_sequential(db, rows)

    from concurrent.futures import ProcessPoolExecutor, as_completed

    jobs = [(row["id"], row["path"], row["category_hint"]) for row in rows]
    ok = 0
    failed = 0
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_analyze_one, job): job for job in jobs}
        for fut in as_completed(futures):
            job = futures[fut]
            try:
                file_id, payload = fut.result()
                if payload is None:
                    failed += 1
                    continue
                db.save_analysis(file_id, **payload)
                row = db.get_file_by_id(file_id)
                if row:
                    refine_after_analysis(db, file_id, row["path"], payload["features"])
                ok += 1
            except Exception:
                failed += 1
    return {"analyzed": ok, "failed": failed}


def _analyze_sequential(db: KnowledgeDB, rows: list) -> dict[str, int]:
    analyzer = AudioAnalyzer()
    ok = 0
    failed = 0
    for row in rows:
        try:
            features = analyzer.analyze(row["path"], row["category_hint"])
            db.save_analysis(
                file_id=int(row["id"]),
                features=features.to_dict(),
                category=features.category.value,
                sub_style=features.sub_style,
                bpm=features.bpm,
                key=features.key,
                lufs=features.lufs,
            )
            refine_after_analysis(
                db, int(row["id"]), row["path"], features.to_dict()
            )
            ok += 1
        except Exception:
            failed += 1
    return {"analyzed": ok, "failed": failed}


def _analyze_one(job: tuple[int, str, str | None]) -> tuple[int, dict[str, Any] | None]:
    file_id, path, hint = job
    try:
        analyzer = AudioAnalyzer()
        features = analyzer.analyze(path, hint)
        return file_id, {
            "features": features.to_dict(),
            "category": features.category.value,
            "sub_style": features.sub_style,
            "bpm": features.bpm,
            "key": features.key,
            "lufs": features.lufs,
        }
    except Exception:
        return file_id, None


def run_full_pipeline(
    db: KnowledgeDB,
    cfg: dict[str, Any],
    analyze_limit: int = 500,
    workers: int = 1,
) -> dict[str, Any]:
    scan_stats = run_scan(db, cfg)
    projects_learned = learn_projects(db)
    analyze_stats = analyze_batch(db, limit=analyze_limit, workers=workers)
    reclassified = reclassify_all(db)
    return {
        "scan": scan_stats,
        "projects_learned": projects_learned,
        "analyze": analyze_stats,
        "reclassified": reclassified,
    }
