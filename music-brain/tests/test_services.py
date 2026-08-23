"""Tests for backup and pipeline."""

import tempfile
from pathlib import Path

from music_brain.database.backup import backup_database
from music_brain.database.knowledge_db import KnowledgeDB
from music_brain.services.pipeline import run_scan


def test_backup_database():
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "music_brain.db"
        db = KnowledgeDB(db_path)
        db.upsert_file("/a.wav", "audio", 100, 1.0, "hash1")
        db.close()

        dest = backup_database(db_path, Path(tmp) / "backups")
        assert dest.exists()
        assert dest.stat().st_size > 0


def test_pipeline_scan_empty_paths():
    with tempfile.TemporaryDirectory() as tmp:
        db = KnowledgeDB(Path(tmp) / "test.db")
        cfg = {
            "scan_paths": [str(Path(tmp) / "nonexistent")],
            "audio_extensions": [".wav"],
            "project_extensions": [".cpr"],
            "preset_extensions": [".fxp"],
            "plugins": {},
            "incremental": True,
        }
        stats = run_scan(db, cfg)
        assert stats["found"] == 0
        db.close()
