"""Tests for reference → project matching panel."""

from __future__ import annotations

import json
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import wave
from pathlib import Path
from unittest.mock import patch

import numpy as np

from music_brain.database.knowledge_db import KnowledgeDB
from music_brain.matcher.project_matcher import ProjectMatcher
from music_brain.models.types import AudioFeatures
from music_brain.reference.analyzer import ReferenceAnalyzer
from music_brain.reference.youtube import extract_youtube_id, is_youtube_url
from music_brain.web.server import STATIC_DIR, serve


def _write_test_wav(path: Path) -> None:
    sr = 22050
    t = np.linspace(0, 2.0, int(sr * 2.0))
    samples = (np.sin(2 * np.pi * 440 * t) * 32767).astype(np.int16)
    with wave.open(str(path), "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(samples.tobytes())


def test_youtube_id_extraction():
    assert extract_youtube_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert extract_youtube_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert is_youtube_url("https://youtu.be/abc123XYZ01")
    assert not is_youtube_url("D:\\track.wav")


def test_project_matcher_scores_by_bpm_and_key():
    with tempfile.TemporaryDirectory() as tmp:
        db = KnowledgeDB(Path(tmp) / "test.db")
        db.save_project_dna(
            "H:\\Projects\\Good.cpr",
            "Cubase",
            {"bpm": 142.0, "key": "F#", "genre": "psytrance"},
        )
        db.save_project_dna(
            "H:\\Projects\\Far.cpr",
            "Cubase",
            {"bpm": 128.0, "key": "C", "genre": "prog"},
        )
        matcher = ProjectMatcher(db)
        hits = matcher.find_matches(bpm=142.0, key="F#", limit=5)
        assert hits
        assert hits[0]["project_path"].endswith("Good.cpr")
        assert hits[0]["score"] >= hits[1]["score"]
        db.close()


def test_reference_analyzer_local_file():
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "ref.wav"
        _write_test_wav(wav)
        analyzer = ReferenceAnalyzer(
            cache_dir=Path(tmp) / "refs",
            registry_path=Path(tmp) / "registry.json",
        )
        mock_features = AudioFeatures(bpm=142.0, key="F#", lufs=-12.0)
        with patch.object(analyzer._analyzer, "analyze", return_value=mock_features):
            result = analyzer.analyze(str(wav))
        assert result["source_type"] == "local"
        assert result["id"].startswith("local_")
        assert result["bpm"] == 142.0
        assert result["preview_url"].startswith("/api/reference/")
        assert analyzer.resolve_audio_path(result["id"]) == wav.resolve()


def test_match_panel_and_api():
    assert (STATIC_DIR / "panel" / "match.html").is_file()
    assert (STATIC_DIR / "js" / "match.js").is_file()

    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "track.wav"
        cpr = Path(tmp) / "MyTrack.cpr"
        _write_test_wav(wav)
        cpr.write_text("<?xml version='1.0'?><Project tempo value='142.0'/>", encoding="utf-8")

        db = KnowledgeDB(Path(tmp) / "test.db")
        db.save_project_dna(
            str(cpr),
            "Cubase",
            {"bpm": 142.0, "key": "A", "genre": "psytrance"},
        )

        cfg = {
            "reference_match": {
                "cache_dir": str(Path(tmp) / "refs"),
                "registry_path": str(Path(tmp) / "registry.json"),
                "sidecar_dir": str(Path(tmp) / "links"),
            }
        }

        thread = threading.Thread(
            target=serve,
            args=(db, cfg),
            kwargs={"host": "127.0.0.1", "port": 18788},
            daemon=True,
        )
        thread.start()
        time.sleep(0.35)

        try:
            mock_features = AudioFeatures(bpm=142.0, key="A", lufs=-10.0)
            with patch(
                "music_brain.analyzer.audio_analyzer.AudioAnalyzer.analyze",
                return_value=mock_features,
            ):
                q = urllib.parse.urlencode({"source": str(wav)})
                url = f"http://127.0.0.1:18788/api/match/analyze?{q}"
                with urllib.request.urlopen(url) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
            assert "reference" in data
            assert data["matches"]
            ref_id = data["reference"]["id"]

            with urllib.request.urlopen(
                f"http://127.0.0.1:18788/api/reference/{ref_id}/stream"
            ) as resp:
                assert resp.status == 200
                assert len(resp.read()) > 100

            open_body = json.dumps({
                "project_path": str(cpr),
                "reference_id": ref_id,
                "reference_source": data["reference"]["source_url"],
                "reference_title": data["reference"]["title"],
                "link_only": True,
            }).encode("utf-8")
            req = urllib.request.Request(
                "http://127.0.0.1:18788/api/match/open",
                data=open_body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req) as resp:
                opened = json.loads(resp.read().decode("utf-8"))
            assert opened["link"]["ok"] is True
        finally:
            db.close()
