"""Stages 2 and 3: what kind of sound is this, and are the features sane."""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from soundbrain import analyzer, taxonomy
from soundbrain.audio.io import AudioLoadError
from soundbrain.config import Config
from soundbrain.db import Database


# ---------------------------------------------------------------------------
# name parsing
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name,expected",
    [
        ("Rolling Bass 145 F#m.wav", 145.0),
        ("kick_140bpm_fullon.wav", 140.0),
        ("Lead - 138 BPM - Am.wav", 138.0),
        ("Pad Warm.wav", None),
        ("Sample 03 of 12.wav", None),
    ],
)
def test_bpm_from_name(name: str, expected: float | None):
    assert taxonomy.bpm_from_name(name) == expected


@pytest.mark.parametrize(
    "name,expected",
    [
        ("Rolling Bass 145 F#m.wav", "F# minor"),
        ("Lead 138 Am.wav", "A minor"),
        ("Pad Cmaj.wav", "C major"),
        ("Bass Bbm 145.wav", "A# minor"),
        ("Riser Uplifter.wav", None),
    ],
)
def test_key_from_name(name: str, expected: str | None):
    assert taxonomy.key_from_name(name) == expected


def test_role_keywords_work_in_hebrew():
    scores = taxonomy.name_role_scores("באס rolling 145")
    assert "bass" in scores
    assert taxonomy.name_role_scores("קיק fullon")["kick"][0] > 0.5


def test_subtype_keywords_pick_the_longest_match():
    subtype = taxonomy.name_subtype("bass", "H:/Packs/FullOn Rolling Bass 145.wav")
    assert subtype is not None
    assert subtype[0] in ("rolling", "fullon")


def test_classification_falls_back_to_features_when_the_name_says_nothing():
    features = {
        "duration": 0.4,
        "fundamental_hz": 48.0,
        "band_20_60": 0.6,
        "band_60_120": 0.3,
        "transient": 0.9,
        "attack_ms": 2.0,
        "release_ms": 120.0,
        "decay_ms": 60.0,
        "onset_times": [0.0],
        "sustain_ratio": 0.05,
    }
    result = taxonomy.classify(features, path="H:/Unsorted/track 07 export.wav")
    assert result.role == "kick"
    assert result.evidence


def test_name_and_features_agreeing_raises_confidence():
    features = {
        "duration": 4.0,
        "bpm": 145.0,
        "onsets_per_beat": 3.0,
        "sixteenth_ratio": 0.6,
        "gate_ratio": 0.3,
        "fundamental_hz": 55.0,
        "band_20_60": 0.4,
        "band_60_120": 0.3,
        "sustain_ratio": 0.3,
        "centroid_hz": 300.0,
        "onset_times": [0.0, 0.1, 0.2, 0.3],
    }
    named = taxonomy.classify(features, path="H:/Packs/Rolling Bass 145.wav")
    unnamed = taxonomy.classify(features, path="H:/Packs/audio 12.wav")
    assert named.role == "bass" and named.subtype == "rolling"
    assert named.subtype_conf > unnamed.subtype_conf


def test_loop_versus_oneshot_tagging():
    loop = taxonomy.classify({"duration": 4.0, "onset_times": [0, 0.5, 1.0, 1.5, 2.0]}, path="loop.wav")
    shot = taxonomy.classify({"duration": 0.3, "onset_times": [0.0]}, path="hit.wav")
    assert loop.is_loop and "loop" in loop.tags
    assert not shot.is_loop and "oneshot" in shot.tags


# ---------------------------------------------------------------------------
# analyser
# ---------------------------------------------------------------------------


def _by_name(db: Database, fragment: str) -> dict:
    for features in db.iter_analyzed():
        if fragment.lower() in str(features["name"]).lower():
            return features
    raise AssertionError(f"no analysed file matching {fragment}")


def test_analysis_assigns_the_expected_roles(indexed: Database):
    assert _by_name(indexed, "Kick FullOn")["role"] == "kick"
    assert _by_name(indexed, "Rolling Bass")["role"] == "bass"
    assert _by_name(indexed, "Lead Acid")["role"] == "lead"
    assert _by_name(indexed, "Pad Warm")["role"] == "pad"
    assert _by_name(indexed, "Riser")["role"] == "fx"


def test_analysis_assigns_the_expected_subtypes(indexed: Database):
    assert _by_name(indexed, "Rolling Bass")["subtype"] == "rolling"
    assert _by_name(indexed, "Offbeat Bass")["subtype"] == "offbeat"
    assert _by_name(indexed, "Kick FullOn")["subtype"] == "fullon"
    assert _by_name(indexed, "Kick Progressive")["subtype"] == "progressive"
    assert _by_name(indexed, "Riser")["subtype"] == "riser"


def test_rolling_bass_rhythm_is_measured_not_guessed(indexed: Database):
    features = _by_name(indexed, "Rolling Bass")
    assert abs(features["bpm"] - 145.0) < 2.0
    assert features["onsets_per_beat"] > 2.4
    assert features["gate_ratio"] > 0.1


def test_offbeat_bass_is_less_dense_than_the_roll(indexed: Database):
    rolling = _by_name(indexed, "Rolling Bass")
    offbeat = _by_name(indexed, "Offbeat Bass")
    assert offbeat["onsets_per_beat"] < rolling["onsets_per_beat"]
    assert offbeat["release_ms"] > rolling["release_ms"]


def test_kick_is_low_and_transient_while_pad_is_neither(indexed: Database):
    kick = _by_name(indexed, "Kick FullOn")
    pad = _by_name(indexed, "Pad Warm")
    assert kick["band_20_60"] + kick["band_60_120"] > 0.7
    assert kick["transient"] > pad["transient"]
    assert pad["attack_ms"] > kick["attack_ms"] * 10
    assert pad["duration"] > kick["duration"]


def test_stereo_width_is_detected_on_the_widened_files(indexed: Database):
    assert _by_name(indexed, "Pad Warm")["stereo_width"] > 0.2
    assert _by_name(indexed, "Kick FullOn")["stereo_width"] < 0.05


def test_feature_record_is_complete_and_json_safe(indexed: Database):
    features = _by_name(indexed, "Rolling Bass")
    for field in (
        "mfcc_mean", "mfcc_std", "chroma", "tonnetz", "contrast_mean", "lufs", "rms_db",
        "peak_db", "crest_db", "dynamic_range", "attack_ms", "release_ms", "transient",
        "rolloff85_hz", "stereo_width", "bpm_conf", "key_conf", "energy", "vector",
    ):
        assert field in features, field
    assert len(features["mfcc_mean"]) == 13
    assert len(features["chroma"]) == 12
    assert len(features["tonnetz"]) == 6
    assert len(features["contrast_mean"]) == 7
    assert len(features["vector"]) == 30
    serialised = json.dumps(features)  # must not contain NaN / Infinity
    assert "NaN" not in serialised and "Infinity" not in serialised
    assert all(math.isfinite(v) for v in features["vector"])


def test_key_from_the_filename_is_used_only_when_the_audio_is_unsure(indexed: Database):
    pad = _by_name(indexed, "Pad Warm")
    assert pad["musical_key"] == "A minor"
    assert pad["key_conf"] > 0.5
    assert pad["key_source"] in ("audio", "filename")


def test_analysis_is_incremental(db: Database, cfg: Config, library: Path):
    from soundbrain import scanner

    scanner.scan(db, cfg)
    first = analyzer.analyze_pending(db, cfg)
    assert first["analyzed"] == 8
    assert analyzer.analyze_pending(db, cfg)["total"] == 0

    target = next((library / "Samples" / "Zenhiser Psytrance" / "Bass").glob("Rolling*"))
    target.write_bytes(target.read_bytes() + b"\x00" * 32)
    scanner.scan(db, cfg)
    again = analyzer.analyze_pending(db, cfg)
    assert again["total"] == 1 and again["analyzed"] == 1


def test_analyze_file_on_a_broken_file_raises_cleanly(tmp_path: Path, cfg: Config):
    broken = tmp_path / "broken.wav"
    broken.write_bytes(b"not really a wav file")
    with pytest.raises(AudioLoadError):
        analyzer.analyze_file(broken, cfg)


def test_broken_files_do_not_stop_a_batch(db: Database, cfg: Config, library: Path):
    from soundbrain import scanner

    (library / "Samples" / "broken.wav").write_bytes(b"RIFFnope")
    scanner.scan(db, cfg)
    result = analyzer.analyze_pending(db, cfg)
    assert result["failed"] == 1
    assert result["analyzed"] == 8
    assert result["failures"][0]["path"].endswith("broken.wav")
