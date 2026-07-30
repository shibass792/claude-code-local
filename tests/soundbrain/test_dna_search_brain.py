"""Stages 8, 9 and 10: Project DNA, AI search and Brain Mode."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from conftest import make_rolling_bass, write_als, write_cpr

from soundbrain import brain, dna as dna_mod, learner, scanner, search as search_mod
from soundbrain.audio.io import write_wav
from soundbrain.config import Config
from soundbrain.db import Database


# ---------------------------------------------------------------------------
# stage 8 — DNA
# ---------------------------------------------------------------------------


def test_dna_describes_a_project_end_to_end(indexed: Database, cfg: Config, tmp_path: Path, project_samples):
    project = write_cpr(tmp_path / "Projects" / "Night Track 145 F#m.cpr", bpm=145.0, samples=project_samples)
    dna = dna_mod.build_dna(indexed, cfg, project)

    assert dna["bpm"] == 145.0
    assert dna["genre"] == "full-on psytrance"
    assert dna["daw"] == "Cubase"
    assert dna["kick_type"] == "fullon"
    assert dna["bass_style"] == "rolling"
    assert dna["resolved_samples"] == 3
    assert "Serum" in dna["instrument_list"]
    assert "Soothe" in dna["plugin_list"]
    assert dna["chains"]
    assert dna["role_breakdown"]["bass"] == 1
    assert "145 BPM" in dna["fingerprint"]
    assert "rolling bass" in dna["fingerprint"]
    json.dumps(dna)  # DNA must be storable as-is


def test_dna_is_cached_and_refreshable(indexed: Database, cfg: Config, tmp_path: Path, project_samples):
    project = write_als(tmp_path / "Projects" / "Live 138.als", bpm=138.0, samples=project_samples)
    scanner.scan(indexed, cfg, roots=[str(tmp_path / "Projects")])
    learner.ingest_projects(indexed, cfg)

    first = dna_mod.dna_or_build(indexed, cfg, project)
    dna_mod.store_dna(indexed, project, first)
    assert dna_mod.load_dna(indexed, project) is not None
    cached = dna_mod.dna_or_build(indexed, cfg, project)
    assert cached["fingerprint"] == first["fingerprint"]
    refreshed = dna_mod.dna_or_build(indexed, cfg, project, refresh=True)
    assert refreshed["bpm"] == 138.0


def test_dna_reads_the_mixdown_when_one_exists(indexed: Database, cfg: Config, tmp_path: Path, project_samples):
    folder = tmp_path / "Projects"
    project = write_cpr(folder / "With Mix 145.cpr", bpm=145.0, samples=project_samples)
    mixdown = folder / "Mixdown"
    mixdown.mkdir(parents=True, exist_ok=True)
    loud = np.clip(make_rolling_bass() * 6.0, -1.0, 1.0)
    write_wav(mixdown / "With Mix 145.wav", np.stack([loud, loud], axis=1))

    dna = dna_mod.build_dna(indexed, cfg, project)
    assert dna["mix"]["source"].endswith("With Mix 145.wav")
    assert dna["mix"]["lufs"] is not None
    assert dna["compression"] in (
        "heavily compressed / limited",
        "moderately compressed",
        "lightly compressed",
        "open dynamics",
    )
    assert dna["stereo"] in ("mono", "narrow", "natural width", "wide", "very wide (watch mono compatibility)")


def test_genre_and_mood_labels_follow_tempo_and_energy():
    assert dna_mod.genre_label(145.0, ["rolling"]) == "full-on psytrance"
    assert dna_mod.genre_label(136.0, ["offbeat"]) == "progressive psytrance"
    assert dna_mod.genre_label(128.0, ["sub"]) == "progressive house / techno"
    assert dna_mod.genre_label(155.0, ["hitech"]) == "hi-tech psytrance"
    assert dna_mod.mood_label("minor", 0.8, 1200.0) == "dark and driving"
    assert dna_mod.mood_label("major", 0.8, 1200.0) == "euphoric and driving"
    assert dna_mod.mood_label("major", 0.1, 500.0) == "ambient and still"
    assert dna_mod.compression_label(6.0, 3.0) == "heavily compressed / limited"
    assert dna_mod.compression_label(20.0, 12.0) == "open dynamics"


def test_dna_lines_are_readable(indexed: Database, cfg: Config, tmp_path: Path, project_samples):
    project = write_cpr(tmp_path / "Projects" / "Readable 145.cpr", samples=project_samples)
    lines = dna_mod.dna_lines(dna_mod.build_dna(indexed, cfg, project))
    assert any("styles:" in line for line in lines)
    assert any("samples:" in line for line in lines)


# ---------------------------------------------------------------------------
# stage 9 — AI search
# ---------------------------------------------------------------------------


def test_query_parsing_understands_an_artist_reference(indexed: Database):
    plan = search_mod.parse_query("I want a bass like Astrix", indexed)
    assert plan.role == "bass"
    assert plan.reference == "Astrix"
    assert plan.reference_kind == "artist"
    assert plan.subtype == "rolling"
    assert plan.bpm and 140 <= plan.bpm <= 146
    assert plan.energy and plan.energy > 0.7


def test_query_parsing_understands_a_lead_reference(indexed: Database):
    plan = search_mod.parse_query("Lead like Ranji", indexed)
    assert plan.role == "lead"
    assert plan.reference == "Ranji"
    assert plan.subtype == "pluck"


def test_query_parsing_understands_a_genre_and_tempo(indexed: Database):
    plan = search_mod.parse_query("Kick that fits 145 Full On", indexed)
    assert plan.role == "kick"
    assert plan.bpm == 145.0
    assert plan.subtype == "fullon"


def test_query_parsing_works_in_hebrew(indexed: Database):
    plan = search_mod.parse_query("אני רוצה באס rolling ב-145", indexed)
    assert plan.role == "bass"
    assert plan.subtype == "rolling"
    assert plan.bpm == 145.0


def test_query_parsing_reads_an_explicit_key(indexed: Database):
    plan = search_mod.parse_query("pad in F#m", indexed)
    assert plan.role == "pad"
    assert plan.key == "F# minor"


def test_search_returns_ranked_library_hits(indexed: Database, cfg: Config):
    result = search_mod.search(indexed, cfg, "rolling bass at 145", limit=5)
    assert result["count"] >= 1
    assert result["results"][0]["role"] == "bass"
    assert result["results"][0]["subtype"] == "rolling"
    scores = [entry["score"] for entry in result["results"]]
    assert scores == sorted(scores, reverse=True)
    assert result["results"][0]["reasons"]


def test_search_narrows_by_role(indexed: Database, cfg: Config):
    result = search_mod.search(indexed, cfg, "kick for 145 full on", limit=10)
    assert {entry["role"] for entry in result["results"]} == {"kick"}


def test_reference_vector_uses_your_own_library(indexed: Database, cfg: Config, tmp_path: Path, library: Path):
    astrix_folder = library / "Samples" / "Astrix Signature Sounds" / "Bass"
    astrix_folder.mkdir(parents=True)
    write_wav(astrix_folder / "Astrix Rolling Bass 145.wav", np.stack([make_rolling_bass()] * 2, axis=1))
    from soundbrain import analyzer

    scanner.scan(indexed, cfg)
    analyzer.analyze_pending(indexed, cfg)

    vector = search_mod.reference_vector(indexed, "Astrix", role="bass")
    assert vector and len(vector) == 30
    plan = search_mod.parse_query("bass like Astrix", indexed)
    assert plan.vector
    assert any("reference vector" in note for note in plan.notes)


def test_llm_refinement_only_fills_gaps():
    plan = search_mod.QueryPlan(query="bass at 145", role="bass", bpm=145.0)
    merged = search_mod.merge_llm(plan, {"role": "lead", "bpm": 90.0, "key": "A minor", "energy": 0.4})
    assert merged.role == "bass"  # never overwritten
    assert merged.bpm == 145.0
    assert merged.key == "A minor"  # filled, because it was empty
    assert merged.energy == 0.4
    assert any("local model filled in" in note for note in merged.notes)


def test_llm_is_optional_and_failures_are_silent(cfg: Config):
    cfg.llm_url = "http://127.0.0.1:9/no-such-endpoint"
    cfg.llm_timeout = 0.2
    assert search_mod.llm_refine("bass like Astrix", cfg) == {}


def test_reference_data_ships_with_the_expected_artists():
    data = search_mod.reference_data()
    names = {entry["name"] for entry in data["artists"]}
    assert {"Astrix", "Ranji"} <= names
    for entry in data["artists"]:
        assert entry["bpm"][0] < entry["bpm"][1]
        assert 0.0 <= entry["energy"] <= 1.0


# ---------------------------------------------------------------------------
# stage 10 — Brain Mode
# ---------------------------------------------------------------------------


def test_brain_learns_instruments_keys_and_tempos(indexed: Database, cfg: Config, tmp_path: Path, project_samples):
    folder = tmp_path / "Projects"
    for index in range(3):
        write_cpr(
            folder / f"Serum Night {index} 145 F#m.cpr",
            bpm=145.0,
            tracks=(("Bass", "Serum", ("Pro-Q 3", "Saturn")),),
            samples=project_samples,
        )
    write_cpr(
        folder / "Sylenth Day 136 Am.cpr",
        bpm=136.0,
        tracks=(("Lead", "Sylenth1", ("Pro-Q 3",)),),
        samples=project_samples,
    )
    scanner.scan(indexed, cfg, roots=[str(folder)])
    learner.ingest_projects(indexed, cfg)

    result = brain.observe_all(indexed, cfg)
    assert result["observed"] == 4
    profile = brain.profile(indexed)
    assert profile.observations == 4
    assert profile.instruments[0]["name"] == "Serum"
    assert profile.keys[0]["name"] == "F# minor"
    assert profile.bpms[0]["name"] == "145"
    assert "bass" in profile.roles_learned
    assert profile.subtypes["bass"][0]["name"] == "rolling"

    lines = brain.profile_lines(profile)
    assert any("instruments:" in line for line in lines)
    assert any("פרויקטים" in line for line in brain.profile_lines(profile, lang="he"))


def test_observing_the_same_project_twice_decays_old_weight(indexed: Database, cfg: Config, tmp_path: Path, project_samples):
    project = write_cpr(tmp_path / "Projects" / "Once 145.cpr", samples=project_samples)
    brain.observe_project(indexed, cfg, project)
    first = brain.load_state(indexed)["instruments"]["Serum"]
    brain.observe_project(indexed, cfg, project)
    second = brain.load_state(indexed)["instruments"]["Serum"]
    assert second > first
    assert second < 2 * first  # decay applied before the new observation


def test_brain_suggests_a_starting_point_in_your_style(indexed: Database, cfg: Config, tmp_path: Path, project_samples):
    folder = tmp_path / "Projects"
    for index in range(2):
        write_cpr(folder / f"Night {index} 145 F#m.cpr", bpm=145.0, samples=project_samples)
    scanner.scan(indexed, cfg, roots=[str(folder)])
    learner.ingest_projects(indexed, cfg)
    brain.observe_all(indexed, cfg)

    suggestion = brain.suggest(indexed, cfg, limit=3)
    assert suggestion["bpm"] == 145.0
    assert suggestion["key"] == "F# minor"
    assert suggestion["instrument"] == "Serum"
    assert suggestion["chain"][0] == "Serum"
    assert suggestion["kicks"]
    assert suggestion["kick_bass_pairs"]
    pair = suggestion["kick_bass_pairs"][0]
    assert pair["kick"]["role"] == "kick" and pair["bass"]["role"] == "bass"
    assert suggestion["why"]


def test_liking_a_sound_moves_the_taste_model(indexed: Database, cfg: Config):
    bass = next(f for f in indexed.iter_analyzed(role="bass"))
    result = brain.like(indexed, int(bass["file_id"]))
    assert result["ok"] and result["role"] == "bass"
    reference = brain.role_reference(indexed, "bass")
    assert reference["observations"] == 1
    assert len(reference["vector"]) == 30
    assert brain.like(indexed, 999999)["ok"] is False


def test_personalized_search_uses_the_learned_vector(indexed: Database, cfg: Config):
    bass = next(f for f in indexed.iter_analyzed(role="bass"))
    brain.like(indexed, int(bass["file_id"]))
    results = brain.personalized_search(indexed, "bass", limit=5)
    assert results
    assert results[0]["role"] == "bass"
    assert brain.personalized_search(indexed, "vocal") == []


def test_timeline_records_what_was_learned(indexed: Database, cfg: Config, tmp_path: Path, project_samples):
    project = write_cpr(tmp_path / "Projects" / "Logged 145.cpr", samples=project_samples)
    brain.observe_project(indexed, cfg, project)
    entries = brain.timeline(indexed)
    assert entries and entries[-1]["project"] == "Logged 145"
    assert indexed.events(kind="observe")
