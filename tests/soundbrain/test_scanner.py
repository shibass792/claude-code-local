"""Stage 1: multi-drive scanning, classification and incremental behaviour."""

from __future__ import annotations

from pathlib import Path

from soundbrain import scanner
from soundbrain.config import Config
from soundbrain.db import Database


def test_scan_indexes_the_library(db: Database, cfg: Config):
    stats = scanner.scan(db, cfg)
    assert stats.seen == 8
    assert stats.added == 8
    assert stats.by_kind["audio"] == 8
    assert stats.errors == 0


def test_second_scan_reports_everything_unchanged(db: Database, cfg: Config):
    scanner.scan(db, cfg)
    second = scanner.scan(db, cfg)
    assert second.added == 0
    assert second.changed == 0
    assert second.unchanged == 8


def test_touching_a_file_marks_it_changed_and_pending(db: Database, cfg: Config, library: Path):
    scanner.scan(db, cfg)
    target = next((library / "Samples" / "Zenhiser Psytrance" / "Bass").glob("Rolling*"))
    data = target.read_bytes()
    target.write_bytes(data + b"\x00" * 64)
    third = scanner.scan(db, cfg)
    assert third.changed == 1
    pending = [Path(str(row["path"])).name for row in db.pending_analysis("audio")]
    assert target.name in pending


def test_deleted_files_are_flagged_missing_not_dropped(db: Database, cfg: Config, library: Path):
    scanner.scan(db, cfg)
    victim = next((library / "Samples" / "Zenhiser Psytrance" / "FX").glob("*.wav"))
    victim.unlink()
    stats = scanner.scan(db, cfg)
    assert stats.missing == 1
    assert len(db.files(kind="audio")) == 7
    assert len(db.files(kind="audio", include_missing=True)) == 8


def test_multiple_roots_are_all_indexed(db: Database, cfg: Config, tmp_path: Path, library: Path):
    from soundbrain.audio.io import write_wav
    import numpy as np

    second_drive = tmp_path / "D_drive" / "Kontakt Libraries" / "Damage 2"
    second_drive.mkdir(parents=True)
    write_wav(second_drive / "Boom.wav", np.zeros(4410, dtype=np.float32))
    (second_drive / "Damage 2.nki").write_bytes(b"fake kontakt instrument")

    stats = scanner.scan(db, cfg, roots=[str(library), str(tmp_path / "D_drive")])
    assert stats.by_kind["audio"] == 9
    assert stats.by_kind["preset"] == 1
    drives = {str(row["drive"]) for row in db.files()}
    assert len(drives) >= 1
    nki = db.conn.execute("SELECT tool FROM files WHERE ext='.nki'").fetchone()
    assert nki["tool"] == "Kontakt"


def test_skip_rules_keep_system_folders_out(db: Database, cfg: Config, tmp_path: Path):
    junk = tmp_path / "C_drive" / "Windows" / "System32"
    junk.mkdir(parents=True)
    (junk / "driver.wav").write_bytes(b"RIFF....WAVEfmt ")
    keep = tmp_path / "C_drive" / "Users" / "shibass" / "Documents"
    keep.mkdir(parents=True)
    (keep / "note.mid").write_bytes(b"MThd")

    stats = scanner.scan(db, cfg, roots=[str(tmp_path / "C_drive")])
    paths = [str(row["path"]) for row in db.files(include_missing=True)]
    assert not any("System32" in p for p in paths)
    assert any(p.endswith("note.mid") for p in paths)
    assert stats.by_kind.get("midi") == 1


def test_classification_covers_the_requested_tools(tmp_path: Path):
    cases = {
        "H:/Presets/Serum Presets/Bass/Rolling.fxp": ("preset", "Serum"),
        "H:/Presets/Vital/Lead.vital": ("preset", "Vital"),
        "H:/Spectrasonics/Omnisphere/Patches/Pad.prt_omn": ("preset", "Omnisphere"),
        "H:/Native Instruments/Kontakt/Damage.nki": ("preset", "Kontakt"),
        "H:/Native Instruments/Massive/Bass.nmsv": ("preset", "Massive"),
        "H:/Native Instruments/Battery 4/Kit.nbkt": ("preset", "Battery"),
        "H:/Sonic Academy/Kick 3/Presets/Fullon.kick3": ("preset", "Kick 3"),
        "H:/Reveal Sound/Spire/Bank.sbf": ("preset", "Spire"),
        "H:/u-he/Diva/Presets/Warm.h2p": ("preset", "Diva"),
        "H:/Arturia/Pigments/Lead.pgtx": ("preset", "Pigments"),
        "H:/reFX/Nexus/Bass.nxp": ("preset", "Nexus"),
        "H:/LennarDigital/Sylenth1/Bank.fxb": ("preset", "Sylenth1"),
        "H:/Steinberg/Groove Agent/Kit.gak": ("preset", "Groove Agent"),
        "H:/Projects/Cubase/Track.cpr": ("project", "Cubase"),
        "H:/Projects/Ableton/Set.als": ("project", "Ableton Live"),
        "H:/Projects/Studio One/Song.song": ("project", "Studio One"),
        "H:/Samples/Pack/Bass/roll.wav": ("audio", None),
    }
    root = Path("H:/") if False else tmp_path
    for raw, (expected_kind, expected_tool) in cases.items():
        path = tmp_path / raw.replace("H:/", "")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"x" * 16)
        record = scanner.classify(path, root, path.stat())
        assert record is not None, raw
        assert record.kind == expected_kind, raw
        if expected_tool:
            assert record.tool == expected_tool, f"{raw} -> {record.tool}"


def test_stray_dlls_are_ignored_but_plugin_folders_are_not(tmp_path: Path):
    stray = tmp_path / "Program Files" / "Something" / "helper.dll"
    stray.parent.mkdir(parents=True)
    stray.write_bytes(b"MZ")
    assert scanner.classify(stray, tmp_path, stray.stat()) is None

    plugin = tmp_path / "VstPlugins" / "Sylenth1.dll"
    plugin.parent.mkdir(parents=True)
    plugin.write_bytes(b"MZ")
    record = scanner.classify(plugin, tmp_path, plugin.stat())
    assert record is not None and record.kind == "plugin" and record.tool == "Sylenth1"


def test_library_name_skips_generic_folders(tmp_path: Path):
    path = tmp_path / "Samples" / "Zenhiser Psytrance" / "Bass" / "roll.wav"
    path.parent.mkdir(parents=True)
    path.write_bytes(b"x")
    assert scanner.library_of(path, tmp_path) == "Zenhiser Psytrance"


def test_inventory_reports_coverage_and_libraries(db: Database, cfg: Config, tmp_path: Path):
    presets = tmp_path / "H_drive" / "Presets"
    for name in ("Serum/Bass.fxp", "Vital/Lead.vital", "Kick 3/K.kick3"):
        target = presets / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"x")
    scanner.scan(db, cfg, roots=[str(tmp_path / "H_drive")])
    data = scanner.inventory(db)
    assert data["counts"]["audio"] == 8
    assert "Serum" in {t["name"] for t in data["tools"].get("instrument", [])}
    assert "Kick 3" in {t["name"] for t in data["tools"].get("drum", [])}
    assert "Cubase" in data["coverage"]
    assert isinstance(data["coverage_missing"], list)


def test_bak_files_only_count_when_a_cpr_exists(tmp_path: Path):
    lonely = tmp_path / "Backup.bak"
    lonely.write_bytes(b"x")
    assert scanner.classify(lonely, tmp_path, lonely.stat()) is None

    paired = tmp_path / "Track.bak"
    paired.write_bytes(b"x")
    (tmp_path / "Track.cpr").write_bytes(b"x")
    record = scanner.classify(paired, tmp_path, paired.stat())
    assert record is not None and record.kind == "project"
