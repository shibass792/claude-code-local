"""Tests for library DB browse."""

import tempfile
from pathlib import Path

from music_brain.database.knowledge_db import KnowledgeDB


def test_browse_library():
    with tempfile.TemporaryDirectory() as tmp:
        db = KnowledgeDB(Path(tmp) / "test.db")
        db.upsert_file(
            r"H:\Music\Artist\song.mp3", "music", 1000, 1.0, "h1",
            library="music", library_sub="Artist",
        )
        db.upsert_file(
            r"H:\Samples\kick.wav", "sample", 500, 1.0, "h2",
            library="samples", library_sub="kick",
        )
        stats = db.get_library_stats()
        assert stats["total"] == 2
        assert stats["libraries"]["music"]["total"] == 1
        music = db.browse_library("music")
        assert len(music) == 1
        kicks = db.browse_library("samples", library_sub="kick")
        assert len(kicks) == 1
        db.close()


def test_fresh_db_opens():
    with tempfile.TemporaryDirectory() as tmp:
        db = KnowledgeDB(Path(tmp) / "fresh.db")
        assert db.count_files() == {}
        db.close()
