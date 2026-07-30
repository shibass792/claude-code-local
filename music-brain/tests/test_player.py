"""SHIBASS S1 player panel API tests."""

from __future__ import annotations

import json
import threading
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

from music_brain.db import KnowledgeDB
from music_brain.pipeline import full_pipeline
from music_brain.player import build_handler
from music_brain.player.media import list_media
from music_brain.scanner import scan

from tests.fixtures.build_fixtures import build_fixture_tree


@pytest.fixture()
def library(tmp_path: Path) -> Path:
    return build_fixture_tree(tmp_path / "library")


@pytest.fixture()
def served(tmp_path: Path, library: Path):
    db = KnowledgeDB(tmp_path / "player.db")
    full_pipeline(db, roots=[str(library)], force=True)
    handler = build_handler(db)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield db, port, library
    httpd.shutdown()


def _get(port: int, path: str):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5) as r:
        return r.status, r.read(), r.headers


def test_player_serves_ui(served):
    _, port, _ = served
    status, body, headers = _get(port, "/")
    assert status == 200
    html = body.decode("utf-8")
    assert "SHIBASS" in html
    assert "WAVEFORM" in html
    assert "SPECTRUM" in html
    assert "PLAYLIST" in html
    assert "BROWSER" in html


def test_player_static_css_js(served):
    _, port, _ = served
    status, body, _ = _get(port, "/static/css/shibass.css")
    assert status == 200
    assert b"--cyan" in body
    status, body, _ = _get(port, "/static/js/app.js")
    assert status == 200
    assert b"playItem" in body


def test_library_lists_midi_and_wav(served):
    db, port, library = served
    midi = list_media(db, category="midi", limit=50)
    assert any(i["name"].endswith(".mid") for i in midi)

    status, body, _ = _get(port, "/api/library?category=wav&limit=50")
    data = json.loads(body)
    assert data["count"] >= 1
    assert all(i["category"] in {"wav", "samples"} or i["extension"] in {".wav", ".flac", ".aiff", ".aif"} for i in data["items"])

    status, body, _ = _get(port, "/api/browser")
    tree = json.loads(body)
    assert "midi" in tree and "wav" in tree and "music" in tree and "samples" in tree


def test_stream_wav(served):
    db, port, library = served
    wav = next(library.rglob("*.wav"))
    # ensure indexed path
    scan(db, roots=[str(library)], force=True)
    q = urllib.parse.urlencode({"path": str(wav)})
    status, body, headers = _get(port, f"/api/stream?{q}")
    assert status == 200
    assert len(body) > 100
    assert "audio" in (headers.get("Content-Type") or "")


def test_health_mentions_player(served):
    _, port, _ = served
    _, body, _ = _get(port, "/health")
    data = json.loads(body)
    assert data["ok"] is True
    assert data.get("service") == "shibass-s1"
