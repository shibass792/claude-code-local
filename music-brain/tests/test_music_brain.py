"""Music Brain integration tests — scan → analyze → match → search → brain → bridge."""

from __future__ import annotations

import json
import threading
import urllib.request
from pathlib import Path

import pytest

from music_brain.analyzer.audio import analyze_file
from music_brain.analyzer.project_dna import extract_project_dna
from music_brain.analyzer.styles import classify_style
from music_brain.brain import ingest_project, learn_summary, recommend_chain
from music_brain.cubase import build_handler
from music_brain.db import KnowledgeDB
from music_brain.matcher import compatibility_score, match_bass_for_kick, match_melodies_same_key
from music_brain.pipeline import full_pipeline
from music_brain.scanner import detect_plugin, detect_role_hint, scan
from music_brain.search import parse_query, search

from tests.fixtures.build_fixtures import build_fixture_tree


@pytest.fixture()
def library(tmp_path: Path) -> Path:
    return build_fixture_tree(tmp_path / "library")


@pytest.fixture()
def db(tmp_path: Path, library: Path) -> KnowledgeDB:
    knowledge = KnowledgeDB(tmp_path / "knowledge.db")
    scan(knowledge, roots=[str(library)], force=True)
    return knowledge


def test_role_and_plugin_detection():
    assert detect_role_hint(Path("Samples/Bass/FullOn_Bass.wav")) == "bass"
    assert detect_role_hint(Path("Kicks/bd_hard.wav")) == "kick"
    assert detect_plugin(Path("Presets/Serum/x.fxp")) == "Serum"
    assert detect_plugin(Path("VST/Sylenth1")) == "Sylenth1"


def test_style_classification_from_path():
    style, fam = classify_style("Samples/Bass/FullOn_Bass_F#.wav", "bass")
    assert fam == "bass"
    assert style == "FullOn Bass"
    style, fam = classify_style("Rolling_Bass_Am.wav", "bass")
    assert style == "Rolling Bass"


def test_scan_indexes_samples_presets_projects(db: KnowledgeDB, library: Path):
    counts = db.count_by_kind()
    assert counts.get("sample", 0) >= 8
    assert counts.get("preset", 0) >= 2
    assert counts.get("project", 0) >= 1
    plugins = dict(db.plugin_usage())
    assert "Serum" in plugins


def test_wav_analyze_extracts_envelope_features(library: Path):
    kick = library / "Samples/Kicks/FullOn_Kick_142bpm.wav"
    result = analyze_file(kick, role_hint="kick")
    assert result["style_family"] == "kick"
    assert result["bpm"] == 142.0
    feats = result["features"]
    assert "attack_ms" in feats
    assert "rms_mean" in feats
    assert "transient_ratio" in feats
    assert feats["duration_sec"] > 0


def test_project_dna_and_fx_chain(library: Path):
    cpr = next((library / "Projects/Cubase").glob("*.cpr"))
    dna = extract_project_dna(cpr)
    assert dna["bpm"] == 142.0
    assert dna["key"] in {"F#", "F"}
    assert any("Serum" == p or "Serum" in p for p in dna["plugin_list"])
    assert dna["fx_chains"], "expected at least one synth→FX chain"
    chain = dna["fx_chains"][0]["chain"]
    assert chain[0] == "Serum"
    assert any("Pro-Q" in x or "Pro Q" in x or "Saturn" in x for x in chain)


def test_pipeline_match_search_brain(tmp_path: Path, library: Path):
    db = KnowledgeDB(tmp_path / "kb.db")
    result = full_pipeline(db, roots=[str(library)], force=True)
    assert result["scan"]["samples"] >= 8
    assert result["analyze"]["samples_analyzed"] >= 8

    basses = match_bass_for_kick(db, bpm=142, limit=26)
    assert len(basses) >= 1
    assert basses[0]["style_family"] == "bass"

    melodies = match_melodies_same_key(db, "F#", limit=9)
    # filename key detection should yield F# leads
    assert isinstance(melodies, list)

    q = search(db, "באס כמו Astrix")
    assert q["intent"]["family"] == "bass"
    assert q["intent"]["artist"] == "astrix"
    assert q["intent"]["style"] == "FullOn Bass"

    q2 = search(db, "Kick שמתאים ל־145 Full On")
    assert q2["intent"]["family"] == "kick"
    assert q2["intent"]["bpm"] == 145

    summary = learn_summary(db)
    assert "narrative" in summary
    assert summary["file_counts"].get("sample", 0) >= 8

    # ingest project into brain
    cpr = next((library / "Projects/Cubase").glob("*.cpr"))
    ingest_project(db, str(cpr))
    chain = recommend_chain(db, "Serum")
    assert chain is not None
    assert chain["chain"][0] == "Serum"


def test_compatibility_prefers_spectral_separation():
    kick = {
        "bpm": 142,
        "key": "F#",
        "features": {
            "transient_ratio": 0.8,
            "attack_ms": 4,
            "release_ms": 80,
            "spectral_centroid_mean": 200,
            "dynamic_range_db": 12,
        },
    }
    good_bass = {
        "bpm": 142,
        "key": "A",  # different key — still OK
        "features": {
            "transient_ratio": 0.1,
            "attack_ms": 15,
            "release_ms": 200,
            "spectral_centroid_mean": 900,
            "dynamic_range_db": 8,
        },
    }
    muddy = {
        "bpm": 142,
        "key": "F#",
        "features": {
            "transient_ratio": 0.75,
            "attack_ms": 4,
            "release_ms": 80,
            "spectral_centroid_mean": 210,
            "dynamic_range_db": 12,
        },
    }
    s_good = compatibility_score(kick, good_bass)["score"]
    s_bad = compatibility_score(kick, muddy)["score"]
    assert s_good > s_bad


def test_parse_query_hebrew_and_artist():
    intent = parse_query("אני רוצה ליד כמו Ranji")
    assert intent["family"] == "lead"
    assert intent["artist"] == "ranji"
    assert intent["style"] == "Supersaw Lead"


def test_cubase_bridge_endpoints(tmp_path: Path, library: Path):
    from http.server import ThreadingHTTPServer

    db = KnowledgeDB(tmp_path / "bridge.db")
    full_pipeline(db, roots=[str(library)], force=True)
    handler = build_handler(db)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=5) as r:
            assert json.loads(r.read())["ok"] is True
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/match/bass?bpm=142&limit=10", timeout=5
        ) as r:
            data = json.loads(r.read())
            assert data["count"] >= 1
            assert "באסים" in data["message"]
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/search?q=bass+like+Astrix", timeout=5
        ) as r:
            data = json.loads(r.read())
            assert data["intent"]["style"] == "FullOn Bass"
        cpr = next((library / "Projects/Cubase").glob("*.cpr"))
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/project/open",
            data=json.dumps({"path": str(cpr)}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read())
            assert data["bpm"] == 142.0
            assert len(data["messages"]) >= 1
    finally:
        httpd.shutdown()
