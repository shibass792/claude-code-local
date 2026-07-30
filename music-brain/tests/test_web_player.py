"""Tests for web audio streaming."""

import tempfile
import threading
import time
import urllib.request
import wave
from pathlib import Path

import numpy as np

from music_brain.database.knowledge_db import KnowledgeDB
from music_brain.web.audio_stream import (
    mime_for_path,
    read_file_range,
    resolve_indexed_file,
)
from music_brain.web.server import STATIC_DIR, serve


def _write_test_wav(path: Path) -> None:
    sr = 22050
    t = np.linspace(0, 0.2, int(sr * 0.2))
    samples = (np.sin(2 * np.pi * 440 * t) * 32767).astype(np.int16)
    with wave.open(str(path), "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(samples.tobytes())


def test_audio_stream_helpers():
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "tone.wav"
        _write_test_wav(wav)
        assert mime_for_path(wav) == "audio/wav"
        data = read_file_range(wav, 0, 99)
        assert len(data) == 100


def test_resolve_indexed_file():
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "kick.wav"
        _write_test_wav(wav)
        db = KnowledgeDB(Path(tmp) / "test.db")
        file_id, _ = db.upsert_file(str(wav), "audio", wav.stat().st_size, 1.0, "h1")
        assert resolve_indexed_file(db, file_id) == wav
        assert resolve_indexed_file(db, 9999) is None
        db.close()


def test_stream_endpoint():
    assert (STATIC_DIR / "panel" / "index.html").is_file()
    assert (STATIC_DIR / "js" / "api.js").is_file()
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "play.wav"
        _write_test_wav(wav)
        db = KnowledgeDB(Path(tmp) / "test.db")
        file_id, _ = db.upsert_file(str(wav), "audio", wav.stat().st_size, 1.0, "h2")

        thread = threading.Thread(
            target=serve,
            args=(db, {}),
            kwargs={"host": "127.0.0.1", "port": 18787},
            daemon=True,
        )
        thread.start()
        time.sleep(0.3)

        try:
            meta_url = f"http://127.0.0.1:18787/api/file/{file_id}"
            with urllib.request.urlopen(meta_url) as resp:
                meta = resp.read().decode("utf-8")
            assert "play.wav" in meta

            stream_url = f"http://127.0.0.1:18787/api/stream/{file_id}"
            req = urllib.request.Request(stream_url, headers={"Range": "bytes=0-99"})
            with urllib.request.urlopen(req) as resp:
                assert resp.status == 206
                body = resp.read()
            assert len(body) == 100
        finally:
            db.close()
