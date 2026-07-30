"""Stage 7 plus the operator surface: reports, watcher, HTTP API and CLI."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from conftest import write_als, write_cpr

from soundbrain import bridge, cli, server
from soundbrain.config import Config
from soundbrain.db import Database


# ---------------------------------------------------------------------------
# reports
# ---------------------------------------------------------------------------


def test_report_answers_the_stage_seven_question(indexed: Database, cfg: Config, tmp_path: Path, project_samples):
    project = write_cpr(tmp_path / "Projects" / "Night 145 F#m.cpr", bpm=145.0, samples=project_samples)
    report = bridge.build_report(indexed, cfg, project)

    assert report.kick is not None
    assert "Kick FullOn" in str(report.kick["name"])
    assert report.basses
    assert report.basses[0]["verdict"]
    assert report.dna["bpm"] == 145.0

    lines = report.lines()
    assert any(line.startswith("found ") and "basses" in line for line in lines)
    assert any("melodies in the same key" in line for line in lines)

    hebrew = report.lines("he")
    assert any("באסים" in line for line in hebrew)
    assert any("מלודיות" in line for line in hebrew)


def test_report_counts_match_the_lists(indexed: Database, cfg: Config, tmp_path: Path, project_samples):
    project = write_cpr(tmp_path / "Projects" / "Counted 145.cpr", samples=project_samples)
    payload = bridge.build_report(indexed, cfg, project).as_dict()
    assert payload["counts"]["basses"] == len(payload["basses"])
    assert payload["counts"]["melodies"] == len(payload["melodies"])
    json.dumps(payload)


def test_report_is_written_next_to_the_project(indexed: Database, cfg: Config, tmp_path: Path, project_samples):
    project = write_cpr(tmp_path / "Projects" / "Written 145.cpr", samples=project_samples)
    report = bridge.build_report(indexed, cfg, project)
    written = bridge.write_report(cfg, project, report)

    beside = project.with_suffix(".soundbrain.txt")
    assert beside.exists()
    assert beside in written
    text = beside.read_text(encoding="utf-8")
    assert "SoundBrain report" in text
    assert "Top bass candidates:" in text
    assert (cfg.reports_path / "Written 145.soundbrain.json").exists()


def test_kick_reference_falls_back_to_the_library(indexed: Database, cfg: Config, tmp_path: Path):
    project = write_cpr(tmp_path / "Projects" / "No Samples 145.cpr", bpm=145.0, samples=())
    report = bridge.build_report(indexed, cfg, project)
    assert report.kick is not None
    assert report.kicks


# ---------------------------------------------------------------------------
# watcher
# ---------------------------------------------------------------------------


def test_watch_reports_new_and_resaved_projects(indexed: Database, cfg: Config, tmp_path: Path, project_samples):
    folder = tmp_path / "Projects"
    folder.mkdir(parents=True, exist_ok=True)
    snapshot = bridge.project_snapshot([folder])
    assert snapshot == {}

    project = write_cpr(folder / "Fresh 145.cpr", bpm=145.0, samples=project_samples)
    seen: list[str] = []
    snapshot, handled = bridge.watch_once(
        indexed, cfg, [folder], snapshot, on_report=lambda path, report: seen.append(path)
    )
    assert handled == [str(project)]
    assert seen == [str(project)]
    assert project.with_suffix(".soundbrain.json").exists()

    # nothing changed -> nothing reported
    snapshot, handled = bridge.watch_once(indexed, cfg, [folder], snapshot)
    assert handled == []

    # a save (mtime bumped explicitly: the test runs inside one fs timestamp tick)
    stat = project.stat()
    os.utime(project, ns=(stat.st_atime_ns, stat.st_mtime_ns + 2_000_000_000))
    snapshot, handled = bridge.watch_once(indexed, cfg, [folder], snapshot)
    assert handled == [str(project)]


def test_watch_learns_from_what_it_sees(indexed: Database, cfg: Config, tmp_path: Path, project_samples):
    from soundbrain import brain

    folder = tmp_path / "Projects"
    write_cpr(folder / "Learned 145.cpr", samples=project_samples)
    bridge.watch_once(indexed, cfg, [folder], {}, learn=True)
    assert brain.profile(indexed).observations == 1

    write_cpr(folder / "Ignored 145.cpr", samples=project_samples)
    bridge.watch_once(indexed, cfg, [folder], bridge.project_snapshot([folder]), learn=False)
    assert brain.profile(indexed).observations == 1


def test_watch_survives_a_corrupt_project(indexed: Database, cfg: Config, tmp_path: Path):
    folder = tmp_path / "Projects"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "broken.als").write_bytes(b"not gzip")
    snapshot, handled = bridge.watch_once(indexed, cfg, [folder], {})
    assert isinstance(handled, list)
    assert str(folder / "broken.als") in snapshot


def test_watch_finds_all_supported_project_types(tmp_path: Path):
    folder = tmp_path / "Projects"
    write_cpr(folder / "a.cpr")
    write_als(folder / "b.als")
    (folder / "notes.txt").write_text("hello", encoding="utf-8")
    snapshot = bridge.project_snapshot([folder])
    assert len(snapshot) == 2


# ---------------------------------------------------------------------------
# HTTP API
# ---------------------------------------------------------------------------


def _get(base: str, path: str) -> dict:
    with urllib.request.urlopen(base + path, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def test_http_api_serves_the_bridge(indexed: Database, cfg: Config, tmp_path: Path, project_samples):
    project = write_cpr(tmp_path / "Projects" / "Served 145 F#m.cpr", bpm=145.0, samples=project_samples)
    httpd, _thread = server.serve_in_thread(indexed, cfg, port=0)
    base = f"http://127.0.0.1:{httpd.server_address[1]}"
    try:
        health = _get(base, "/health")
        assert health["ok"] and health["counts"]["audio"] >= 9

        assert _get(base, "/inventory")["counts"]["audio"] == 9
        assert "usage" in _get(base, "/stats")
        assert "observations" in _get(base, "/brain")

        dna = _get(base, "/dna?path=" + urllib.parse.quote(str(project)))
        assert dna["bpm"] == 145.0

        report = _get(base, "/project?path=" + urllib.parse.quote(str(project)))
        assert report["counts"]["basses"] >= 1
        assert any("found" in line for line in report["lines"])

        results = _get(base, "/search?q=" + urllib.parse.quote("rolling bass at 145"))
        assert results["count"] >= 1

        kick = next(f for f in indexed.iter_analyzed(role="kick"))
        matches = _get(base, f"/match?file_id={kick['file_id']}&role=bass")
        assert matches["count"] >= 1
        similar = _get(base, f"/similar?file_id={kick['file_id']}")
        assert similar["count"] >= 1
        in_key = _get(base, "/inkey?key=" + urllib.parse.quote("A minor"))
        assert "results" in in_key

        listing = _get(base, "/api/routes")
        assert "/project" in listing["routes"]
        assert "/api/match-track" in listing["routes"]

        # Match Panel HTML
        with urllib.request.urlopen(base + "/panel", timeout=10) as response:
            html = response.read().decode("utf-8")
            assert response.headers.get_content_type() == "text/html"
        assert "SoundBrain" in html
        assert "btn-open-cubase" in html

        # Match-track against a library kick name as free text
        kick = next(f for f in indexed.iter_analyzed(role="kick"))
        matched = _get(base, "/api/match-track?q=" + urllib.parse.quote(str(kick["name"])))
        assert "reference" in matched
        assert "arps" in matched and "projects" in matched
        assert matched["message_he"]
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_http_api_reports_errors_without_dying(indexed: Database, cfg: Config):
    httpd, _thread = server.serve_in_thread(indexed, cfg, port=0)
    base = f"http://127.0.0.1:{httpd.server_address[1]}"
    try:
        for path, status in (("/nope", 404), ("/dna", 400), ("/dna?path=/no/such.cpr", 404), ("/search", 400)):
            try:
                urllib.request.urlopen(base + path, timeout=10)
                raise AssertionError(f"{path} should have failed")
            except urllib.error.HTTPError as exc:
                assert exc.code == status
                assert "error" in json.loads(exc.read().decode("utf-8"))
        assert _get(base, "/health")["ok"]  # still alive
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_http_like_endpoint_teaches_the_brain(indexed: Database, cfg: Config):
    from soundbrain import brain

    bass = next(f for f in indexed.iter_analyzed(role="bass"))
    httpd, _thread = server.serve_in_thread(indexed, cfg, port=0)
    base = f"http://127.0.0.1:{httpd.server_address[1]}"
    try:
        request = urllib.request.Request(
            base + "/like",
            data=json.dumps({"file_id": int(bass["file_id"])}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
        assert payload["ok"] and payload["role"] == "bass"
        assert brain.role_reference(indexed, "bass")["observations"] == 1
    finally:
        httpd.shutdown()
        httpd.server_close()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _run(args: list[str], db_path: Path) -> int:
    return cli.main(["--db", str(db_path), *args])


def test_cli_pipeline_runs_end_to_end(tmp_path: Path, library: Path, projects_dir: Path, capsys):
    db_path = tmp_path / "cli" / "soundbrain.db"
    assert _run(["--quiet", "pipeline", "--roots", str(library), str(projects_dir)], db_path) == 0
    output = capsys.readouterr().out
    assert "stage 1 — scanning" in output
    assert "analysed" in output
    assert "projects parsed" in output

    assert _run(["stats"], db_path) == 0
    stats_output = capsys.readouterr().out
    assert "projects indexed" in stats_output

    assert _run(["--json", "inventory"], db_path) == 0
    inventory = json.loads(capsys.readouterr().out)
    assert inventory["counts"]["audio"] == 9


def test_cli_scan_analyze_and_search(tmp_path: Path, library: Path, capsys):
    db_path = tmp_path / "cli" / "soundbrain.db"
    assert _run(["--quiet", "scan", "--roots", str(library)], db_path) == 0
    assert "scanned 9 files" in capsys.readouterr().out
    assert _run(["--quiet", "analyze"], db_path) == 0
    assert "analysed 9/9" in capsys.readouterr().out

    assert _run(["search", "rolling bass at 145", "--verbose"], db_path) == 0
    search_output = capsys.readouterr().out
    assert "Rolling Bass" in search_output
    assert "understood as" in search_output

    assert _run(["match", "Kick FullOn", "--role", "bass"], db_path) == 0
    assert "matches for" in capsys.readouterr().out

    assert _run(["similar", "Rolling Bass"], db_path) == 0
    assert "similar to" in capsys.readouterr().out

    assert _run(["inkey", "A minor"], db_path) == 0
    assert "in or around A minor" in capsys.readouterr().out


def test_cli_project_report_and_brain(tmp_path: Path, library: Path, projects_dir: Path, capsys):
    db_path = tmp_path / "cli" / "soundbrain.db"
    _run(["--quiet", "pipeline", "--roots", str(library), str(projects_dir)], db_path)
    capsys.readouterr()

    project = projects_dir / "Night Track 145 F#m.cpr"
    assert _run(["project", str(project), "--write", "--lang", "he"], db_path) == 0
    output = capsys.readouterr().out
    assert "מצאתי" in output
    assert project.with_suffix(".soundbrain.txt").exists()

    assert _run(["dna", str(project)], db_path) == 0
    assert "styles:" in capsys.readouterr().out

    assert _run(["brain", "profile"], db_path) == 0
    assert "learned from" in capsys.readouterr().out

    assert _run(["brain", "suggest"], db_path) == 0
    assert "start at" in capsys.readouterr().out

    assert _run(["chain", "Serum"], db_path) == 0
    assert "Serum" in capsys.readouterr().out


def test_cli_analyze_file_prints_features(tmp_path: Path, library: Path, capsys):
    sample = library / "Samples" / "Zenhiser Psytrance" / "Bass" / "Rolling Bass 145 F#m.wav"
    assert cli.main(["--db", str(tmp_path / "x" / "db.sqlite"), "analyze-file", str(sample)]) == 0
    output = capsys.readouterr().out
    assert "role" in output and "bass" in output
    assert "lufs" in output


def test_cli_reports_unindexed_files_clearly(tmp_path: Path, capsys):
    db_path = tmp_path / "cli" / "soundbrain.db"
    assert _run(["match", "nothing-here.wav"], db_path) == 1
    assert "not indexed" in capsys.readouterr().err


def test_cli_init_writes_a_config(tmp_path: Path, library: Path, capsys, monkeypatch):
    monkeypatch.setenv("SOUNDBRAIN_HOME", str(tmp_path / "home"))
    assert cli.main(["init", "--roots", str(library)]) == 0
    output = capsys.readouterr().out
    assert "config written to" in output
    config = json.loads((tmp_path / "home" / "config.json").read_text(encoding="utf-8"))
    assert config["roots"] == [str(library)]


def test_watch_cli_runs_a_bounded_number_of_cycles(tmp_path: Path, library: Path, projects_dir: Path, capsys):
    db_path = tmp_path / "cli" / "soundbrain.db"
    _run(["--quiet", "pipeline", "--roots", str(library), str(projects_dir)], db_path)
    capsys.readouterr()
    assert _run(["watch", str(projects_dir), "--cycles", "1", "--interval", "0"], db_path) == 0
    assert "watching 1 folder" in capsys.readouterr().out
