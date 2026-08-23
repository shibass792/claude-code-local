"""Basic tests for music-brain modules."""

import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

from music_brain.analyzer.audio_analyzer import AudioAnalyzer
from music_brain.database.knowledge_db import KnowledgeDB
from music_brain.matcher.engine import MatcherEngine
from music_brain.models.types import SoundCategory
from music_brain.search.ai_search import _parse_query


def test_parse_query_hebrew():
    intent = _parse_query("אני רוצה באס כמו Astrix")
    assert intent.get("category") == "bass"
    assert intent.get("reference_artist") == "astrix"


def test_parse_query_fullon_kick():
    intent = _parse_query("kick for 145 full on")
    assert intent.get("category") == "kick"
    assert intent.get("bpm") == 145.0


def test_knowledge_db_upsert():
    with tempfile.TemporaryDirectory() as tmp:
        db = KnowledgeDB(Path(tmp) / "test.db")
        fid, is_new = db.upsert_file(
            "/test/kick.wav", "audio", 1000, 1.0, "abc123",
            category_hint="kick",
        )
        assert is_new
        fid2, is_new2 = db.upsert_file(
            "/test/kick.wav", "audio", 1000, 1.0, "abc123",
        )
        assert fid == fid2
        assert not is_new2
        db.close()


def test_audio_analyzer_kick():
    with tempfile.TemporaryDirectory() as tmp:
        sr = 22050
        duration = 0.3
        t = np.linspace(0, duration, int(sr * duration))
        y = np.sin(2 * np.pi * 60 * t) * np.exp(-t * 20)
        path = Path(tmp) / "test_kick.wav"
        sf.write(str(path), y, sr)

        analyzer = AudioAnalyzer(max_duration_sec=0.3)
        features = analyzer.analyze(str(path), category_hint="kick")
        assert features.duration_sec > 0
        assert features.category == SoundCategory.KICK
        assert features.transient_strength >= 0


def test_matcher_score():
    with tempfile.TemporaryDirectory() as tmp:
        db = KnowledgeDB(Path(tmp) / "test.db")
        matcher = MatcherEngine(db)
        from music_brain.models.types import AudioFeatures

        kick = AudioFeatures(
            category=SoundCategory.KICK,
            bpm=142, key="F#",
            transient_strength=0.9, attack_ms=5,
            spectral_centroid=200,
        )
        bass = AudioFeatures(
            category=SoundCategory.BASS,
            bpm=142, key="A",
            transient_strength=0.3, attack_ms=40,
            spectral_centroid=800,
        )
        score, reasons = matcher.score_pair(kick, bass)
        assert 0 < score <= 1.5
        assert len(reasons) > 0
        db.close()
