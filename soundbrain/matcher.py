"""Stage 4 — the matcher engine.

The interesting claim in the plan is that two sounds can fit even when they are
not in the same key, because pitch relation, envelope interlock and transient
behaviour often matter more. That is exactly how the weights below are set: the
Camelot-wheel key term is worth 6 % of a kick/bass verdict, while envelope
interlock and spectral separation together are worth almost half of it.

Every score comes back with a breakdown and a plain-language explanation, so a
recommendation can always be argued with.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

import numpy as np

from .audio.key import interval_consonance, key_distance, semitone_interval
from .db import Database

LOW_BANDS = ("band_20_60", "band_60_120", "band_120_250")
CLICK_BANDS = ("band_2000_4000", "band_4000_8000")

#: weights for the kick <-> bass verdict; they sum to 1.0
KICK_BASS_WEIGHTS = {
    "envelope_interlock": 0.26,
    "spectral_separation": 0.22,
    "transient_clarity": 0.18,
    "pitch_relation": 0.15,
    "tempo_fit": 0.09,
    "key_fit": 0.06,
    "level_fit": 0.04,
}


@dataclass
class MatchScore:
    score: float = 0.0
    components: dict[str, float] = field(default_factory=dict)
    reasons: list[str] = field(default_factory=list)
    verdict: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "score": round(self.score, 4),
            "components": {k: round(v, 4) for k, v in self.components.items()},
            "reasons": self.reasons,
            "verdict": self.verdict,
        }


def _f(features: dict[str, Any], key: str, default: float = 0.0) -> float:
    try:
        return float(features.get(key, default) or 0.0)
    except (TypeError, ValueError):
        return default


def _band_profile(features: dict[str, Any], bands: Sequence[str]) -> np.ndarray:
    values = np.array([_f(features, band) for band in bands], dtype=np.float64)
    total = values.sum()
    return values / total if total > 0 else values


# ---------------------------------------------------------------------------
# kick <-> bass
# ---------------------------------------------------------------------------


def spectral_separation(kick: dict[str, Any], bass: dict[str, Any]) -> tuple[float, str]:
    """1.0 when the two sounds occupy different parts of the low end."""
    k = _band_profile(kick, LOW_BANDS)
    b = _band_profile(bass, LOW_BANDS)
    if k.sum() == 0 or b.sum() == 0:
        return 0.5, "no low-band information for one of the two sounds"
    overlap = float(np.minimum(k, b).sum())
    score = float(np.clip(1.0 - overlap, 0.0, 1.0))
    dominant = ("20-60 Hz", "60-120 Hz", "120-250 Hz")
    k_dom = dominant[int(np.argmax(k))]
    b_dom = dominant[int(np.argmax(b))]
    if score > 0.55:
        reason = f"kick sits mainly in {k_dom}, bass in {b_dom} — {overlap*100:.0f}% low-end overlap"
    else:
        reason = f"both fight over {k_dom} — {overlap*100:.0f}% low-end overlap"
    return score, reason


def envelope_interlock(kick: dict[str, Any], bass: dict[str, Any]) -> tuple[float, str]:
    """Does the bass leave room for the kick and arrive when the kick is gone?"""
    kick_tail = _f(kick, "release_ms") or _f(kick, "decay_ms")
    bass_attack = _f(bass, "attack_ms")
    bass_gate = _f(bass, "gate_ratio")
    bass_sustain = _f(bass, "sustain_ratio")

    if kick_tail <= 0:
        return 0.5, "kick tail could not be measured"

    # room = how much of the kick tail has passed before the bass reaches full level
    room = bass_attack / kick_tail if kick_tail > 0 else 0.0
    room_score = float(np.clip(room / 0.6, 0.0, 1.0))
    # a gated / rolling bass also creates room even with a fast attack
    gate_score = float(np.clip(bass_gate / 0.35, 0.0, 1.0))
    # a bass that never gets out of the way is the worst case
    sustain_penalty = float(np.clip((bass_sustain - 0.75) * 2.0, 0.0, 0.5))

    score = float(np.clip(max(room_score, gate_score) * 0.85 + min(room_score, gate_score) * 0.15 - sustain_penalty, 0.0, 1.0))
    if gate_score >= room_score:
        reason = (
            f"bass is gated {bass_gate*100:.0f}% of the time, so the {kick_tail:.0f} ms kick tail has a gap to live in"
        )
    else:
        reason = f"bass takes {bass_attack:.0f} ms to arrive against a {kick_tail:.0f} ms kick tail"
    if sustain_penalty > 0:
        reason += "; it does sustain heavily, so sidechain will still be needed"
    return score, reason


def transient_clarity(kick: dict[str, Any], bass: dict[str, Any]) -> tuple[float, str]:
    """Will the kick's click survive on top of this bass?"""
    kick_transient = _f(kick, "transient")
    bass_transient = _f(bass, "transient")
    bass_click = sum(_f(bass, band) for band in CLICK_BANDS)
    kick_click = sum(_f(kick, band) for band in CLICK_BANDS)
    headroom = kick_click - bass_click
    score = float(np.clip(0.5 + 0.5 * (kick_transient - 0.6 * bass_transient) + 2.0 * headroom, 0.0, 1.0))
    if headroom >= 0:
        reason = f"kick keeps {headroom*100:.1f}% more 2-8 kHz energy than the bass, so its click stays audible"
    else:
        reason = f"bass has {abs(headroom)*100:.1f}% more 2-8 kHz energy than the kick and will blur its click"
    return score, reason


def pitch_relation(kick: dict[str, Any], bass: dict[str, Any]) -> tuple[float, str]:
    """Octave-folded consonance between the two fundamentals."""
    kick_hz = _f(kick, "fundamental_hz")
    bass_hz = _f(bass, "fundamental_hz")
    if kick_hz <= 0 or bass_hz <= 0:
        return 0.5, "one of the sounds has no measurable fundamental"
    interval = semitone_interval(kick_hz, bass_hz)
    score = interval_consonance(interval)
    folded = abs(interval) % 12.0
    folded = min(folded, 12.0 - folded)
    names = {0: "unison/octave", 1: "semitone", 2: "whole tone", 3: "minor third", 4: "major third", 5: "fourth", 6: "tritone"}
    label = names.get(int(round(folded)), f"{folded:.1f} semitones")
    reason = f"kick at {kick_hz:.0f} Hz and bass at {bass_hz:.0f} Hz are a {label} apart"
    return score, reason


def tempo_fit(a: dict[str, Any], b: dict[str, Any]) -> tuple[float, str]:
    bpm_a, bpm_b = _f(a, "bpm"), _f(b, "bpm")
    if bpm_a <= 0 or bpm_b <= 0:
        return 0.7, "one of the sounds is a one-shot, so tempo does not constrain it"
    ratio = abs(math.log2(bpm_b / bpm_a))
    octave_folded = min(ratio, abs(ratio - 1.0))
    score = float(np.clip(1.0 - octave_folded * 6.0, 0.0, 1.0))
    if octave_folded < 0.02:
        reason = f"both run at {bpm_a:.0f} BPM"
    elif ratio > 0.9:
        reason = f"{bpm_a:.0f} vs {bpm_b:.0f} BPM — a half/double-time relation, usable"
    else:
        reason = f"{bpm_a:.0f} vs {bpm_b:.0f} BPM — needs time-stretching"
    return score, reason


def key_fit(a: dict[str, Any], b: dict[str, Any]) -> tuple[float, str]:
    key_a, key_b = str(a.get("musical_key") or ""), str(b.get("musical_key") or "")
    conf = min(_f(a, "key_conf"), _f(b, "key_conf"))
    if not key_a or not key_b:
        return 0.6, "no reliable key on one side"
    distance = key_distance(key_a, key_b)
    raw = 1.0 - distance
    # a weak key estimate should not drag the verdict either way
    score = float(0.6 + (raw - 0.6) * np.clip(conf / 0.5, 0.0, 1.0))
    if distance == 0:
        reason = f"same key ({key_a})"
    elif distance <= 0.3:
        reason = f"{key_a} and {key_b} are neighbours on the wheel"
    else:
        reason = f"{key_a} vs {key_b} are unrelated keys (weighted lightly on purpose)"
    return float(np.clip(score, 0.0, 1.0)), reason


def level_fit(a: dict[str, Any], b: dict[str, Any]) -> tuple[float, str]:
    lufs_a, lufs_b = _f(a, "lufs", -70.0), _f(b, "lufs", -70.0)
    delta = abs(lufs_a - lufs_b)
    score = float(np.clip(1.0 - delta / 18.0, 0.0, 1.0))
    return score, f"{delta:.1f} LU apart in level"


def match_kick_bass(kick: dict[str, Any], bass: dict[str, Any]) -> MatchScore:
    """Score a kick/bass pair the way stage 4 describes."""
    parts = {
        "envelope_interlock": envelope_interlock(kick, bass),
        "spectral_separation": spectral_separation(kick, bass),
        "transient_clarity": transient_clarity(kick, bass),
        "pitch_relation": pitch_relation(kick, bass),
        "tempo_fit": tempo_fit(kick, bass),
        "key_fit": key_fit(kick, bass),
        "level_fit": level_fit(kick, bass),
    }
    components = {name: value for name, (value, _reason) in parts.items()}
    total = sum(KICK_BASS_WEIGHTS[name] * value for name, value in components.items())
    reasons = [
        f"{name.replace('_', ' ')} {value:.2f} (x{KICK_BASS_WEIGHTS[name]:.2f}): {parts[name][1]}"
        for name, value in sorted(components.items(), key=lambda kv: -KICK_BASS_WEIGHTS[kv[0]])
    ]

    if total >= 0.72:
        verdict = "strong fit"
    elif total >= 0.58:
        verdict = "usable fit"
    else:
        verdict = "weak fit"

    # When a pair passes on structure while the keys disagree, say so out loud:
    # key_fit can only ever contribute 6 % of the verdict, so the recommendation
    # was earned by the envelope and the low end, not by the wheel.
    key_ok = components["key_fit"] >= 0.7
    if not key_ok and total >= 0.58 and components["envelope_interlock"] >= 0.6:
        verdict += " — different key, but the pocket and the low-end split work"
    return MatchScore(score=float(total), components=components, reasons=reasons, verdict=verdict)


# ---------------------------------------------------------------------------
# generic similarity search
# ---------------------------------------------------------------------------


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    va, vb = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    if va.size == 0 or vb.size == 0 or va.size != vb.size:
        return 0.0
    denom = float(np.linalg.norm(va) * np.linalg.norm(vb))
    if denom <= 1e-12:
        return 0.0
    return float(np.clip(np.dot(va, vb) / denom, -1.0, 1.0))


def timbre_similarity(a: dict[str, Any], b: dict[str, Any]) -> float:
    return cosine(a.get("vector") or [], b.get("vector") or [])


@dataclass
class Candidate:
    file_id: int
    path: str
    name: str
    score: float
    role: str = ""
    subtype: str = ""
    musical_key: str = ""
    bpm: float = 0.0
    reasons: list[str] = field(default_factory=list)
    components: dict[str, float] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "file_id": self.file_id,
            "path": self.path,
            "name": self.name,
            "score": round(self.score, 4),
            "role": self.role,
            "subtype": self.subtype,
            "key": self.musical_key,
            "bpm": round(self.bpm, 2),
            "reasons": self.reasons[:6],
            "components": {k: round(v, 3) for k, v in self.components.items()},
        }


def _candidate(features: dict[str, Any], score: float, reasons: list[str], components: dict[str, float]) -> Candidate:
    return Candidate(
        file_id=int(features.get("file_id") or 0),
        path=str(features.get("path") or ""),
        name=str(features.get("name") or ""),
        score=score,
        role=str(features.get("role") or ""),
        subtype=str(features.get("subtype") or ""),
        musical_key=str(features.get("musical_key") or ""),
        bpm=_f(features, "bpm"),
        reasons=reasons,
        components=components,
    )


def find_partners_for_kick(
    db: Database,
    kick: dict[str, Any],
    role: str = "bass",
    limit: int = 25,
    min_score: float = 0.5,
    subtype: str | None = None,
) -> list[Candidate]:
    """Stage 7's "I found 26 basses that fit this kick"."""
    out: list[Candidate] = []
    for features in db.iter_analyzed(role=role, subtype=subtype):
        if int(features.get("file_id") or 0) == int(kick.get("file_id") or -1):
            continue
        result = match_kick_bass(kick, features)
        if result.score >= min_score:
            out.append(_candidate(features, result.score, result.reasons, result.components))
    out.sort(key=lambda c: c.score, reverse=True)
    return out[:limit]


def find_similar(
    db: Database,
    seed: dict[str, Any],
    role: str | None = None,
    subtype: str | None = None,
    limit: int = 25,
    key_weight: float = 0.15,
    bpm_weight: float = 0.1,
) -> list[Candidate]:
    """Nearest neighbours by timbre, nudged by key and tempo agreement."""
    seed_role = role if role is not None else str(seed.get("role") or "") or None
    out: list[Candidate] = []
    for features in db.iter_analyzed(role=seed_role, subtype=subtype):
        if int(features.get("file_id") or 0) == int(seed.get("file_id") or -1):
            continue
        timbre = (timbre_similarity(seed, features) + 1.0) / 2.0
        key_score, key_reason = key_fit(seed, features)
        tempo_score, tempo_reason = tempo_fit(seed, features)
        total = (1.0 - key_weight - bpm_weight) * timbre + key_weight * key_score + bpm_weight * tempo_score
        out.append(
            _candidate(
                features,
                float(total),
                [f"timbre similarity {timbre:.2f}", key_reason, tempo_reason],
                {"timbre": timbre, "key_fit": key_score, "tempo_fit": tempo_score},
            )
        )
    out.sort(key=lambda c: c.score, reverse=True)
    return out[:limit]


def find_in_key(
    db: Database,
    musical_key: str,
    role: str | None = None,
    bpm: float | None = None,
    limit: int = 25,
    allow_neighbours: bool = True,
) -> list[Candidate]:
    """Stage 7's "I found 9 melodies in the same key"."""
    reference = {"musical_key": musical_key, "key_conf": 1.0, "bpm": bpm or 0.0}
    out: list[Candidate] = []
    for features in db.iter_analyzed(role=role):
        key_score, key_reason = key_fit(reference, features)
        if not allow_neighbours and str(features.get("musical_key")) != musical_key:
            continue
        if key_score < 0.6:
            continue
        tempo_score, tempo_reason = tempo_fit(reference, features) if bpm else (1.0, "tempo not constrained")
        total = 0.7 * key_score + 0.3 * tempo_score
        out.append(
            _candidate(
                features,
                float(total),
                [key_reason, tempo_reason],
                {"key_fit": key_score, "tempo_fit": tempo_score},
            )
        )
    out.sort(key=lambda c: c.score, reverse=True)
    return out[:limit]


def match_profile(
    db: Database,
    profile: dict[str, Any],
    limit: int = 25,
    roles: Iterable[str] | None = None,
) -> list[Candidate]:
    """Score the library against a target profile (used by AI search).

    A profile is a loose dict: ``role``, ``subtype``, ``bpm``, ``key``,
    ``energy``, ``centroid_hz``, ``brightness``, ``vector`` — any subset.
    """
    wanted_roles = list(roles) if roles else ([str(profile["role"])] if profile.get("role") else [None])
    out: list[Candidate] = []
    for role in wanted_roles:
        for features in db.iter_analyzed(role=role):
            score, reasons = score_against_profile(features, profile)
            out.append(_candidate(features, score, reasons, {}))
    out.sort(key=lambda c: c.score, reverse=True)
    return out[:limit]


def score_against_profile(features: dict[str, Any], profile: dict[str, Any]) -> tuple[float, list[str]]:
    """How well one sound matches a target description."""
    terms: list[tuple[float, float, str]] = []  # (weight, score, reason)

    if profile.get("subtype"):
        hit = str(features.get("subtype") or "") == str(profile["subtype"])
        terms.append((0.2, 1.0 if hit else 0.25, f"subtype {'matches' if hit else 'differs from'} {profile['subtype']}"))
    if profile.get("bpm"):
        score, reason = tempo_fit({"bpm": float(profile["bpm"])}, features)
        terms.append((0.2, score, reason))
    if profile.get("key"):
        score, reason = key_fit({"musical_key": str(profile["key"]), "key_conf": 1.0}, features)
        terms.append((0.15, score, reason))
    if profile.get("energy") is not None:
        delta = abs(_f(features, "energy") - float(profile["energy"]))
        terms.append((0.15, float(np.clip(1.0 - delta * 2.0, 0.0, 1.0)), f"energy {_f(features, 'energy'):.2f} vs target {float(profile['energy']):.2f}"))
    if profile.get("centroid_hz"):
        target = float(profile["centroid_hz"])
        actual = max(_f(features, "centroid_hz"), 1.0)
        octaves = abs(math.log2(actual / max(target, 1.0)))
        terms.append((0.15, float(np.clip(1.0 - octaves / 2.0, 0.0, 1.0)), f"brightness {actual:.0f} Hz vs target {target:.0f} Hz"))
    if profile.get("vector"):
        timbre = (cosine(profile["vector"], features.get("vector") or []) + 1.0) / 2.0
        terms.append((0.3, timbre, f"timbre similarity {timbre:.2f} to the reference"))
    if profile.get("tags"):
        text = " ".join(
            [str(features.get("path") or ""), str(features.get("library") or ""), str(features.get("tool") or "")]
        ).lower()
        hits = [tag for tag in profile["tags"] if str(tag).lower() in text]
        terms.append((0.1, min(len(hits) / max(len(profile["tags"]), 1), 1.0), f"name/library matches {hits or 'none of the tags'}"))

    if not terms:
        return _f(features, "energy"), ["no constraints given, ranked by energy"]
    weight_total = sum(w for w, _s, _r in terms)
    score = sum(w * s for w, s, _r in terms) / weight_total
    reasons = [r for _w, _s, r in sorted(terms, key=lambda t: -t[0])]
    return float(score), reasons
