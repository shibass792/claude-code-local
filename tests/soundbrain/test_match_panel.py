"""Match Panel: YouTube/song → ARP + project matching, download, Cubase open."""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path

from conftest import write_cpr

from soundbrain import analyzer, learner, reference, scanner, server, session, studio_match
from soundbrain.config import Config
from soundbrain.db import Database


def test_split_title_and_youtube_detection():
    artist, title = reference.split_title_artist("Astrix - Deep Jungle (Official Video)")
    assert "Astrix" in artist
    assert "Deep Jungle" in title
    assert reference.is_youtube_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    assert reference.youtube_video_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert not reference.is_youtube_url("just a song name 145")


def test_resolve_text_and_path(indexed: Database, cfg: Config, library: Path):
    ref = reference.resolve(indexed, cfg, "Astrix style rolling 145 F#m")
    assert ref.source == "text"
    assert ref.bpm == 145.0
    assert ref.search_query()

    path = library / "Samples" / "Zenhiser Psytrance" / "Leads" / "Arp Sequence 145 F#m.wav"
    ref2 = reference.resolve(indexed, cfg, str(path))
    assert ref2.source == "path"
    assert ref2.file_id is not None
    assert ref2.features


def test_resolve_youtube_uses_oembed(monkeypatch, indexed: Database, cfg: Config):
    def fake_meta(url: str, timeout: float = 8.0) -> dict:
        return {
            "video_id": "abc123",
            "url": "https://www.youtube.com/watch?v=abc123",
            "title": "Vini Vici - The Tribe 145",
            "channel": "Vini Vici",
            "thumbnail": "",
        }

    monkeypatch.setattr(reference, "fetch_youtube_meta", fake_meta)
    ref = reference.resolve(indexed, cfg, "https://youtube.com/watch?v=abc123")
    assert ref.source == "youtube"
    assert ref.bpm == 145.0
    assert "Tribe" in ref.title or "Tribe" in ref.query


def test_match_track_finds_arps_and_projects(tmp_path: Path, library: Path):
    cfg = Config(roots=[str(library), str(tmp_path / "Projects")], home=str(tmp_path / "home"))
    cfg.ensure_dirs()
    projects = tmp_path / "Projects"
    projects.mkdir()
    write_cpr(projects / "Night Arp 145 F#m.cpr", bpm=145.0)
    # midi arp
    midi = library / "Samples" / "Zenhiser Psytrance" / "Leads" / "Melodic Arp 145.mid"
    midi.write_bytes(b"MThd\x00\x00\x00\x06\x00\x01\x00\x01\x00\x60MTrk\x00\x00\x00\x04\x00\xff\x2f\x00")

    db = Database(cfg.db_path)
    try:
        scanner.scan(db, cfg)
        analyzer.analyze_pending(db, cfg)
        learner.ingest_projects(db, cfg)

        result = studio_match.match_track(db, cfg, "arp sequence 145 F#m")
        assert result["counts"]["arps"] >= 1
        assert any("arp" in (h["name"] + h.get("subtype", "")).lower() for h in result["arps"])
        assert result["counts"]["projects"] >= 1
        assert result["best"]["project"]["name"]
        assert "ARP" in result["message_he"] or "arp" in result["message_en"].lower()
    finally:
        db.close()


def test_download_and_open_cubase_session(tmp_path: Path, library: Path, monkeypatch):
    cfg = Config(roots=[str(library)], home=str(tmp_path / "home"))
    cfg.ensure_dirs()
    projects = tmp_path / "Projects"
    projects.mkdir()
    project = write_cpr(projects / "OpenMe 145.cpr", bpm=145.0)
    arp = library / "Samples" / "Zenhiser Psytrance" / "Leads" / "Arp Sequence 145 F#m.wav"

    db = Database(cfg.db_path)
    try:
        scanner.scan(db, cfg)
        launched = {}

        def fake_launch(daw: str, project_path: str | None):
            launched["daw"] = daw
            launched["project"] = project_path
            return {"launched": True, "cmd": ["fake", project_path or ""], "daw": "Cubase", "notes": []}

        monkeypatch.setattr(session, "launch_daw", fake_launch)

        pack = session.download_hits(
            cfg,
            [{"path": str(arp), "name": arp.name}],
            label="test-arp",
        )
        assert pack["count"] == 1
        assert Path(pack["folder"]).exists()

        result = session.open_in_cubase(
            db,
            cfg,
            reference={"title": "Test Track", "source": "text", "query": "Test Track"},
            project_path=str(project),
            arp_paths=[str(arp)],
            open_daw=True,
        )
        assert result["launched"] is True
        assert launched["project"] == str(project)
        session_dir = Path(result["session_dir"])
        assert (session_dir / "session.json").exists()
        assert (session_dir / "arps" / arp.name).exists()
        assert project.with_suffix(".soundbrain-session.json").exists()
        payload = json.loads((session_dir / "session.json").read_text(encoding="utf-8"))
        assert payload["reference"]["title"] == "Test Track"
    finally:
        db.close()


def test_http_match_download_open_endpoints(tmp_path: Path, library: Path, monkeypatch):
    cfg = Config(roots=[str(library), str(tmp_path / "Projects")], home=str(tmp_path / "home"))
    cfg.ensure_dirs()
    projects = tmp_path / "Projects"
    projects.mkdir()
    project = write_cpr(projects / "Panel 145 F#m.cpr", bpm=145.0)

    db = Database(cfg.db_path)
    scanner.scan(db, cfg)
    analyzer.analyze_pending(db, cfg)
    learner.ingest_projects(db, cfg)

    monkeypatch.setattr(
        session,
        "launch_daw",
        lambda daw, project_path: {
            "launched": True,
            "cmd": ["noop"],
            "daw": "Cubase",
            "notes": [],
        },
    )

    httpd, _thread = server.serve_in_thread(db, cfg, port=0)
    base = f"http://127.0.0.1:{httpd.server_address[1]}"
    try:
        with urllib.request.urlopen(base + "/api/match-track?q=" + urllib.parse.quote("145 F#m arp"), timeout=15) as resp:
            matched = json.loads(resp.read().decode("utf-8"))
        assert matched["counts"]["projects"] >= 1
        assert matched["reference"]["query"] or matched["reference"]["title"]

        hits = (matched.get("arps") or [])[:2] + (matched.get("projects") or [])[:1]
        req = urllib.request.Request(
            base + "/api/download",
            data=json.dumps({"hits": hits, "label": "panel-pack"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            downloaded = json.loads(resp.read().decode("utf-8"))
        assert downloaded["count"] >= 1

        best = matched["best"]["project"] or {"path": str(project), "file_id": None}
        open_body = {
            "reference": matched["reference"],
            "project_path": best.get("path"),
            "project_file_id": best.get("file_id"),
            "arp_file_ids": [a["file_id"] for a in (matched.get("arps") or [])[:2]],
            "open_daw": True,
        }
        req = urllib.request.Request(
            base + "/api/open-cubase",
            data=json.dumps(open_body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            opened = json.loads(resp.read().decode("utf-8"))
        assert opened["session_dir"]
        assert opened["copied"] or opened["project_path"]
    finally:
        httpd.shutdown()
        httpd.server_close()
        db.close()
