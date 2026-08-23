"""Regression: opening an older DB without library columns must migrate cleanly."""

import sqlite3
import tempfile
from pathlib import Path

from music_brain.database.knowledge_db import KnowledgeDB


def test_migrate_old_db_without_library_columns():
    """Reproduce: CREATE INDEX on library before ALTER → OperationalError."""
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "legacy.db"
        conn = sqlite3.connect(str(db_path))
        conn.executescript(
            """
            CREATE TABLE files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT UNIQUE NOT NULL,
                kind TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                mtime REAL NOT NULL,
                content_hash TEXT NOT NULL,
                plugin_hint TEXT,
                category_hint TEXT,
                scanned_at REAL NOT NULL,
                analyzed_at REAL
            );
            INSERT INTO files (path, kind, size_bytes, mtime, content_hash, scanned_at)
            VALUES ('H:/a.wav', 'audio', 100, 1.0, 'abc', 1.0);
            """
        )
        conn.commit()
        conn.close()

        # Must not raise sqlite3.OperationalError: no such column: library
        db = KnowledgeDB(db_path)
        cols = {row[1] for row in db._conn.execute("PRAGMA table_info(files)")}
        assert "library" in cols
        assert "library_sub" in cols
        row = db.get_file_by_path("H:/a.wav")
        assert row is not None
        db.close()
