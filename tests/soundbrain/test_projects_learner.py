"""Stages 5 and 6: reading projects, then learning usage shares and chains."""

from __future__ import annotations

import os
from pathlib import Path

from conftest import write_als, write_cpr, write_rpp, write_song

from soundbrain import learner, projects, scanner
from soundbrain.config import Config
from soundbrain.db import Database


# ---------------------------------------------------------------------------
# parsers
# ---------------------------------------------------------------------------


def test_ableton_parser_reads_tempo_tracks_and_chains(tmp_path: Path):
    path = write_als(tmp_path / "Set.als", bpm=138.5, samples=("H:/Samples/kick.wav",))
    parsed = projects.parse(path)
    assert parsed is not None
    assert parsed.daw == "Ableton Live"
    assert parsed.bpm == 138.5
    assert "Serum" in parsed.plugins and "Pro-Q 3" in parsed.plugins
    assert [t.name for t in parsed.tracks] == ["Bass", "Lead", "Kick"]
    bass_track = parsed.tracks[0]
    assert bass_track.instrument == "Serum"
    assert bass_track.chain[:3] == ["Serum", "Pro-Q 3", "Saturn"]
    assert parsed.samples == ["H:/Samples/kick.wav"]


def test_cubase_parser_mines_plugins_tempo_and_samples(tmp_path: Path):
    path = write_cpr(tmp_path / "Night Track.cpr", bpm=145.0, samples=("H:\\Samples\\Bass\\roll.wav",))
    parsed = projects.parse(path)
    assert parsed is not None
    assert parsed.daw == "Cubase"
    assert parsed.bpm == 145.0
    assert "Serum" in parsed.plugins
    assert "Soothe" in parsed.plugins
    assert parsed.samples == ["H:/Samples/Bass/roll.wav"]
    chains = [chain for _track, chain in parsed.chains]
    assert any(chain[0] == "Serum" for chain in chains)
    assert any("Pro-Q 3" in chain for chain in chains)


def test_cubase_parser_recovers_long_sample_paths(tmp_path: Path):
    """A path longer than one run of printable bytes must not be truncated.

    Regression: the string tokeniser capped runs at 64 characters, which split
    real library paths in half and left the parser resolving "#m.wav".
    """
    deep = "H:\\Samples\\" + "\\".join(f"Very Long Folder Name {i}" for i in range(6)) + "\\Rolling Bass 145 F#m.wav"
    path = write_cpr(tmp_path / "Deep.cpr", samples=(deep,))
    parsed = projects.parse(path)
    assert parsed.samples == [deep.replace("\\", "/")]
    assert Path(parsed.samples[0]).name == "Rolling Bass 145 F#m.wav"


def test_cubase_chain_keeps_the_serialised_order(tmp_path: Path):
    tracks = (("Bass", "Serum", ("Pro-Q 3", "Saturn", "Soothe", "Serial Clipper")),)
    path = write_cpr(tmp_path / "Order.cpr", tracks=tracks)
    parsed = projects.parse(path)
    chain = parsed.chains[0][1]
    assert chain == ["Serum", "Pro-Q 3", "Saturn", "Soothe", "Serial Clipper"]


def test_studio_one_parser_reads_the_archive(tmp_path: Path):
    path = write_song(tmp_path / "Song.song", bpm=136.0)
    parsed = projects.parse(path)
    assert parsed is not None
    assert parsed.daw == "Studio One"
    assert parsed.bpm == 136.0
    assert "Serum" in parsed.plugins
    assert parsed.notes  # the parser is explicit about its limitation


def test_reaper_parser_reads_per_track_chains(tmp_path: Path):
    path = write_rpp(tmp_path / "Sketch.rpp", bpm=142.0)
    parsed = projects.parse(path)
    assert parsed.bpm == 142.0
    assert parsed.tracks[0].name == "Bass"
    assert parsed.tracks[0].chain[0] == "Serum"


def test_unknown_project_formats_return_none(tmp_path: Path):
    path = tmp_path / "song.flp"
    path.write_bytes(b"FLhd")
    assert projects.parse(path) is None


def test_plugin_name_cleaning_and_canonicalisation():
    assert projects.clean_plugin_name("VST3: FabFilter Pro-Q 3 (FabFilter)") == "FabFilter Pro-Q 3"
    assert projects.canonical_tool("VST3: FabFilter Pro-Q 3") == ("Pro-Q 3", "effect")
    assert projects.canonical_tool("Xfer Records Serum") == ("Serum", "instrument")
    assert projects.canonical_tool("Some Unknown Thing") is None
    assert projects.normalise_names(["Serum", "serum", "  ", "Pro-Q 3"]) == ["Serum", "Pro-Q 3"]


def test_corrupt_project_files_are_reported_not_raised(tmp_path: Path):
    broken_als = tmp_path / "broken.als"
    broken_als.write_bytes(b"definitely not gzip xml")
    parsed = projects.parse(broken_als)
    assert parsed is not None and parsed.notes

    broken_song = tmp_path / "broken.song"
    broken_song.write_bytes(b"not a zip")
    assert projects.parse(broken_song).notes


# ---------------------------------------------------------------------------
# ingestion and statistics
# ---------------------------------------------------------------------------


def _index_projects(db: Database, cfg: Config, folder: Path) -> None:
    scanner.scan(db, cfg, roots=[str(folder)])
    learner.ingest_projects(db, cfg)


def test_ingest_projects_is_incremental(db: Database, cfg: Config, projects_dir: Path):
    scanner.scan(db, cfg, roots=[str(projects_dir)])
    first = learner.ingest_projects(db, cfg)
    assert first["parsed"] == 4
    assert learner.ingest_projects(db, cfg)["total"] == 0

    # A later save. The mtime is bumped explicitly because the whole test runs
    # inside a single filesystem timestamp tick.
    resaved = write_als(projects_dir / "Live Idea 138.als", bpm=140.0)
    stat = resaved.stat()
    os.utime(resaved, ns=(stat.st_atime_ns, stat.st_mtime_ns + 2_000_000_000))
    scanner.scan(db, cfg, roots=[str(projects_dir)])
    assert learner.ingest_projects(db, cfg)["parsed"] == 1
    assert db.project_by_path(str(resaved))["bpm"] == 140.0


def test_usage_stats_report_instrument_shares(db: Database, cfg: Config, tmp_path: Path):
    folder = tmp_path / "Studio"
    # 7 projects on Serum, 2 on Sylenth1, 1 on Vital -> the 70/25/5 style view
    for index in range(7):
        write_als(folder / f"serum-{index}.als", tracks=(("Bass", "Serum", ("Pro-Q 3", "Saturn")),))
    for index in range(2):
        write_als(folder / f"sylenth-{index}.als", tracks=(("Bass", "Sylenth1", ("Pro-Q 3",)),))
    write_als(folder / "vital.als", tracks=(("Bass", "Vital", ("Pro-Q 3",)),))
    _index_projects(db, cfg, folder)

    share = {entry["name"]: entry["share"] for entry in learner.instrument_share(db)}
    assert abs(share["Serum"] - 0.7) < 0.01
    assert abs(share["Sylenth1"] - 0.2) < 0.01
    assert abs(share["Vital"] - 0.1) < 0.01

    stats = learner.usage_stats(db)
    assert stats.projects == 10
    effects = {entry["name"]: entry["share"] for entry in stats.effects}
    assert abs(effects["Pro-Q 3"] - 1.0) < 0.01
    assert abs(effects["Saturn"] - 0.7) < 0.01


def test_usage_stats_report_dominant_key_and_tempo(db: Database, cfg: Config, tmp_path: Path):
    folder = tmp_path / "Studio"
    for index in range(5):
        write_cpr(folder / f"Track {index} 142 F#m.cpr", bpm=142.0)
    write_cpr(folder / "Odd 128 Am.cpr", bpm=128.0)
    _index_projects(db, cfg, folder)

    stats = learner.usage_stats(db)
    assert stats.dominant_bpm == 142.0
    assert stats.dominant_key == "F# minor"
    assert stats.keys[0]["projects"] == 5


def test_chain_stats_find_the_chain_you_actually_build(db: Database, cfg: Config, tmp_path: Path):
    folder = tmp_path / "Studio"
    chain = ("Pro-Q 3", "Saturn", "Soothe", "Serial Clipper")
    for index in range(4):
        write_als(folder / f"chain-{index}.als", tracks=(("Bass", "Serum", chain),))
    write_als(folder / "other.als", tracks=(("Bass", "Serum", ("Pro-Q 3", "OTT")),))
    _index_projects(db, cfg, folder)

    stats = learner.chain_stats(db)
    assert stats.recommended["chain"] == "Serum > Pro-Q 3 > Saturn > Soothe > Serial Clipper"
    assert stats.recommended["uses"] == 4
    transitions = {(entry["from"], entry["to"]): entry["count"] for entry in stats.transitions}
    assert transitions[("Serum", "Pro-Q 3")] == 5
    assert transitions[("Saturn", "Soothe")] == 4
    assert "Serum" in stats.per_instrument


def test_suggest_chain_reuses_an_observed_chain(db: Database, cfg: Config, tmp_path: Path):
    folder = tmp_path / "Studio"
    for index in range(3):
        write_als(folder / f"c-{index}.als", tracks=(("Bass", "Serum", ("Pro-Q 3", "Saturn", "Soothe")),))
    _index_projects(db, cfg, folder)
    result = learner.suggest_chain(db, "Serum")
    assert result["chain"] == ["Serum", "Pro-Q 3", "Saturn", "Soothe"]
    assert result["source"] == "observed chain"


def test_suggest_chain_grows_one_from_transitions(db: Database, cfg: Config, tmp_path: Path):
    folder = tmp_path / "Studio"
    write_als(folder / "a.als", tracks=(("Bass", "Serum", ("Pro-Q 3", "Saturn")),))
    write_als(folder / "b.als", tracks=(("Lead", "Sylenth1", ("Pro-Q 3", "Valhalla")),))
    _index_projects(db, cfg, folder)
    grown = learner.suggest_chain(db, "Vital")
    assert grown["chain"][0] == "Vital"
    assert grown["source"] in ("grown from transition probabilities", "no data")


def test_report_lines_are_available_in_hebrew(db: Database, cfg: Config, tmp_path: Path):
    folder = tmp_path / "Studio"
    write_als(folder / "a 142 F#m.als", bpm=142.0, tracks=(("Bass", "Serum", ("Pro-Q 3",)),))
    _index_projects(db, cfg, folder)
    data = learner.summary(db)
    english = learner.report_lines(data, lang="en")
    hebrew = learner.report_lines(data, lang="he")
    assert any("projects indexed" in line for line in english)
    assert any("פרויקטים" in line for line in hebrew)


def test_project_sample_references_resolve_against_the_library(indexed: Database, cfg: Config, projects_dir: Path, project_samples):
    scanner.scan(indexed, cfg, roots=[str(projects_dir)])
    learner.ingest_projects(indexed, cfg)
    resolved = learner.find_project_samples(indexed, project_samples)
    assert all(entry["file_id"] for entry in resolved)
    assert learner.preset_library_usage(indexed) == []
    assert learner.sample_library_usage(indexed)[0]["library"] == "Zenhiser Psytrance"
