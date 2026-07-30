"""Stage 4: does the matcher really weigh the pocket above the key."""

from __future__ import annotations

import copy

from soundbrain import matcher
from soundbrain.db import Database


def _get(db: Database, fragment: str) -> dict:
    for features in db.iter_analyzed():
        if fragment.lower() in str(features["name"]).lower():
            return features
    raise AssertionError(f"no analysed file matching {fragment}")


def test_weights_sum_to_one_and_favour_structure_over_key():
    assert abs(sum(matcher.KICK_BASS_WEIGHTS.values()) - 1.0) < 1e-9
    structural = (
        matcher.KICK_BASS_WEIGHTS["envelope_interlock"]
        + matcher.KICK_BASS_WEIGHTS["spectral_separation"]
        + matcher.KICK_BASS_WEIGHTS["transient_clarity"]
    )
    assert structural > 0.6
    assert matcher.KICK_BASS_WEIGHTS["key_fit"] < 0.1


def test_a_gated_rolling_bass_beats_a_wall_of_sustain(indexed: Database):
    kick = _get(indexed, "Kick FullOn")
    rolling = matcher.match_kick_bass(kick, _get(indexed, "Rolling Bass"))
    sustained = matcher.match_kick_bass(kick, _get(indexed, "Sustained Bass"))
    assert rolling.score > sustained.score
    assert rolling.components["envelope_interlock"] > sustained.components["envelope_interlock"]
    assert rolling.verdict.startswith(("strong", "usable"))


def test_changing_only_the_key_barely_moves_the_score(indexed: Database):
    kick = _get(indexed, "Kick FullOn")
    bass = _get(indexed, "Rolling Bass")
    same_key = copy.deepcopy(bass)
    same_key["musical_key"] = kick.get("musical_key") or "C major"
    same_key["key_conf"] = 1.0
    other_key = copy.deepcopy(bass)
    other_key["musical_key"] = "D# major" if same_key["musical_key"] != "D# major" else "A minor"
    other_key["key_conf"] = 1.0

    delta = matcher.match_kick_bass(kick, same_key).score - matcher.match_kick_bass(kick, other_key).score
    assert 0.0 <= delta <= matcher.KICK_BASS_WEIGHTS["key_fit"] + 1e-6


def test_a_mismatched_key_still_reports_a_fit_when_the_pocket_works(indexed: Database):
    kick = _get(indexed, "Kick FullOn")
    bass = copy.deepcopy(_get(indexed, "Rolling Bass"))
    bass["musical_key"] = "D# major"
    bass["key_conf"] = 1.0
    result = matcher.match_kick_bass(kick, bass)
    assert "different key" in result.verdict
    assert result.score > 0.55


def test_low_key_confidence_is_not_used_against_a_candidate(indexed: Database):
    kick = _get(indexed, "Kick FullOn")
    bass = copy.deepcopy(_get(indexed, "Rolling Bass"))
    bass["musical_key"] = "D# major"
    unsure, sure = copy.deepcopy(bass), copy.deepcopy(bass)
    unsure["key_conf"] = 0.05
    sure["key_conf"] = 1.0
    assert matcher.key_fit(kick, unsure)[0] >= matcher.key_fit(kick, sure)[0]


def test_every_component_comes_with_an_explanation(indexed: Database):
    result = matcher.match_kick_bass(_get(indexed, "Kick FullOn"), _get(indexed, "Rolling Bass"))
    assert set(result.components) == set(matcher.KICK_BASS_WEIGHTS)
    assert len(result.reasons) == len(matcher.KICK_BASS_WEIGHTS)
    assert all(":" in reason for reason in result.reasons)


def test_spectral_separation_penalises_overlap():
    kick = {"band_20_60": 0.7, "band_60_120": 0.25, "band_120_250": 0.05}
    complementary = {"band_20_60": 0.05, "band_60_120": 0.25, "band_120_250": 0.7}
    clashing = dict(kick)
    assert matcher.spectral_separation(kick, complementary)[0] > matcher.spectral_separation(kick, clashing)[0]


def test_tempo_fit_accepts_half_and_double_time():
    same = matcher.tempo_fit({"bpm": 145.0}, {"bpm": 145.0})[0]
    double = matcher.tempo_fit({"bpm": 145.0}, {"bpm": 290.0})[0]
    unrelated = matcher.tempo_fit({"bpm": 145.0}, {"bpm": 122.0})[0]
    assert same == 1.0
    assert double > unrelated


def test_tempo_fit_wording_matches_the_size_of_the_difference():
    assert "both run at 145 BPM" in matcher.tempo_fit({"bpm": 145.0}, {"bpm": 145.0})[1]
    assert "close enough to drop in" in matcher.tempo_fit({"bpm": 145.0}, {"bpm": 143.0})[1]
    assert "half/double-time" in matcher.tempo_fit({"bpm": 145.0}, {"bpm": 72.5})[1]
    assert "time-stretching" in matcher.tempo_fit({"bpm": 145.0}, {"bpm": 122.0})[1]


def test_transient_clarity_is_neutral_when_neither_sound_has_highs():
    quiet_top = {"transient": 0.9, "band_2000_4000": 0.0, "band_4000_8000": 0.0}
    bass = {"transient": 0.4, "band_2000_4000": 0.0, "band_4000_8000": 0.0}
    _score, reason = matcher.transient_clarity(quiet_top, bass)
    assert "neither sound carries much" in reason
    assert "will blur" not in reason


def test_candidates_report_which_library_they_came_from(indexed: Database):
    kick = _get(indexed, "Kick FullOn")
    candidates = matcher.find_partners_for_kick(indexed, kick, role="bass", min_score=0.0)
    assert candidates
    assert all(c.as_dict()["library"] == "Zenhiser Psytrance" for c in candidates)


def test_pitch_relation_prefers_consonant_intervals():
    kick = {"fundamental_hz": 55.0}
    octave = matcher.pitch_relation(kick, {"fundamental_hz": 110.0})[0]
    semitone = matcher.pitch_relation(kick, {"fundamental_hz": 58.27})[0]
    assert octave > semitone


def test_find_partners_ranks_the_library(indexed: Database):
    kick = _get(indexed, "Kick FullOn")
    candidates = matcher.find_partners_for_kick(indexed, kick, role="bass", limit=10, min_score=0.0)
    assert candidates
    names = [candidate.name for candidate in candidates]
    assert "Rolling Bass 145 F#m.wav" in names
    rolling = next(c for c in candidates if c.name.startswith("Rolling"))
    sustained = next(c for c in candidates if c.name.startswith("Sustained"))
    assert rolling.score > sustained.score
    assert all(c.reasons for c in candidates)


def test_find_partners_respects_the_subtype_filter(indexed: Database):
    kick = _get(indexed, "Kick FullOn")
    only_rolling = matcher.find_partners_for_kick(indexed, kick, role="bass", subtype="rolling", min_score=0.0)
    assert only_rolling
    assert {c.subtype for c in only_rolling} == {"rolling"}


def test_find_in_key_returns_the_matching_and_neighbouring_keys(indexed: Database):
    results = matcher.find_in_key(indexed, "A minor", limit=20)
    assert results
    assert any(c.musical_key == "A minor" for c in results)
    strict = matcher.find_in_key(indexed, "A minor", limit=20, allow_neighbours=False)
    assert all(c.musical_key == "A minor" for c in strict)


def test_similarity_is_reflexive_and_bounded(indexed: Database):
    bass = _get(indexed, "Rolling Bass")
    assert abs(matcher.timbre_similarity(bass, bass) - 1.0) < 1e-6
    other = _get(indexed, "Pad Warm")
    assert -1.0 <= matcher.timbre_similarity(bass, other) <= 1.0


def test_find_similar_puts_same_role_material_first(indexed: Database):
    bass = _get(indexed, "Rolling Bass")
    results = matcher.find_similar(indexed, bass, limit=5)
    assert results
    assert all(c.role == "bass" for c in results)
    assert bass["file_id"] not in [c.file_id for c in results]


def test_profile_scoring_uses_only_the_given_constraints(indexed: Database):
    tight = matcher.match_profile(indexed, {"role": "bass", "subtype": "rolling", "bpm": 145.0}, limit=5)
    assert tight and tight[0].subtype == "rolling"
    loose = matcher.match_profile(indexed, {"role": "kick"}, limit=5)
    assert loose and all(c.role == "kick" for c in loose)


def test_profile_scoring_explains_itself(indexed: Database):
    features = _get(indexed, "Rolling Bass")
    score, reasons = matcher.score_against_profile(features, {"bpm": 145.0, "subtype": "rolling", "energy": 0.5})
    assert 0.0 <= score <= 1.0
    assert any("subtype" in reason for reason in reasons)
