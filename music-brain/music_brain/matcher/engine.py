"""Step 4 — compatibility matcher (key-agnostic bass ↔ kick)."""

from __future__ import annotations

import json
import math
from typing import Any

import numpy as np

from music_brain.database.knowledge_db import KnowledgeDB
from music_brain.models.types import AudioFeatures, MatchResult, SoundCategory

# Relative key compatibility (Camelot-style simplified)
COMPATIBLE_KEYS: dict[str, list[str]] = {
    "C": ["C", "Am", "F", "G", "Em"],
    "C#": ["C#", "A#m", "F#", "G#", "Fm"],
    "D": ["D", "Bm", "G", "A", "F#m"],
    "D#": ["D#", "Cm", "G#", "A#", "Gm"],
    "E": ["E", "C#m", "A", "B", "G#m"],
    "F": ["F", "Dm", "A#", "C", "Am"],
    "F#": ["F#", "D#m", "B", "C#", "A#m"],
    "G": ["G", "Em", "C", "D", "Bm"],
    "G#": ["G#", "Fm", "C#", "D#", "Cm"],
    "A": ["A", "F#m", "D", "E", "C#m"],
    "A#": ["A#", "Gm", "D#", "F", "Dm"],
    "B": ["B", "G#m", "E", "F#", "D#m"],
}


def _key_distance(k1: str | None, k2: str | None) -> float:
    if not k1 or not k2:
        return 0.5  # neutral when unknown
    if k1 == k2:
        return 1.0
    compat = COMPATIBLE_KEYS.get(k1, [k1])
    if k2 in compat or k2.replace("m", "") in [c.replace("m", "") for c in compat]:
        return 0.75
    return 0.3


def _bpm_score(b1: float | None, b2: float | None, tolerance: float = 3.0) -> float:
    if b1 is None or b2 is None:
        return 0.5
    diff = abs(b1 - b2)
    if diff <= tolerance:
        return 1.0
    if diff <= tolerance * 2:
        return 0.6
    return max(0.0, 1.0 - diff / 30.0)


def _spectral_complement(
    centroid_a: float, centroid_b: float, category_a: str, category_b: str
) -> float:
    """Kick + bass should occupy different spectral zones."""
    if category_a == "kick" and category_b == "bass":
        if centroid_b > centroid_a * 1.5:
            return 1.0
        return 0.5
    if category_a == "bass" and category_b == "kick":
        if centroid_a > centroid_b * 1.2:
            return 0.9
        return 0.5
    # Similar categories — want spectral closeness
    ratio = min(centroid_a, centroid_b) / (max(centroid_a, centroid_b) + 1e-9)
    return float(ratio)


def _transient_complement(ts_kick: float, ts_bass: float) -> float:
    """Strong kick transient + softer bass attack = good fit."""
    if ts_kick > 0.5 and ts_bass < 0.5:
        return 1.0
    if ts_kick > ts_bass:
        return 0.7 + 0.3 * (ts_kick - ts_bass)
    return 0.4


def _envelope_fit(attack_kick: float, attack_bass: float, release_bass: float) -> float:
    """Bass should start after kick attack."""
    if attack_bass > attack_kick:
        return min(1.0, 0.6 + (attack_bass - attack_kick) / 100.0)
    return 0.5


def _mfcc_similarity(m1: list[float], m2: list[float]) -> float:
    if not m1 or not m2:
        return 0.5
    a, b = np.array(m1[:13]), np.array(m2[:13])
    dist = float(np.linalg.norm(a - b))
    return max(0.0, 1.0 - dist / 50.0)


class MatcherEngine:
    """
    Step 4: Match bass to kick even across keys.
    Weights: transient + envelope + spectral often beat strict key match.
    """

    def __init__(self, db: KnowledgeDB, weights: dict[str, float] | None = None) -> None:
        self.db = db
        self.weights = weights or {
            "key": 0.15,
            "bpm": 0.15,
            "spectral": 0.20,
            "transient": 0.20,
            "envelope": 0.15,
            "stereo": 0.05,
            "category": 0.10,
        }

    def _load_features(self, row: Any) -> AudioFeatures:
        data = json.loads(row["features_json"])
        f = AudioFeatures()
        for k, v in data.items():
            if hasattr(f, k):
                if k == "category":
                    try:
                        setattr(f, k, SoundCategory(v))
                    except ValueError:
                        setattr(f, k, SoundCategory.UNKNOWN)
                else:
                    setattr(f, k, v)
        return f

    def score_pair(
        self, source: AudioFeatures, target: AudioFeatures
    ) -> tuple[float, list[str]]:
        reasons: list[str] = []
        w = self.weights

        key_s = _key_distance(source.key, target.key)
        if key_s < 0.5 and source.transient_strength + target.transient_strength > 0.8:
            reasons.append("Key differs but transient/envelope may still fit")
        reasons.append(f"Key compatibility: {key_s:.0%}")

        bpm_s = _bpm_score(source.bpm, target.bpm)
        reasons.append(f"BPM match: {bpm_s:.0%}")

        spec_s = _spectral_complement(
            source.spectral_centroid,
            target.spectral_centroid,
            source.category.value,
            target.category.value,
        )
        reasons.append(f"Spectral fit: {spec_s:.0%}")

        ts_s = _transient_complement(
            source.transient_strength
            if source.category == SoundCategory.KICK
            else target.transient_strength,
            target.transient_strength
            if source.category == SoundCategory.KICK
            else source.transient_strength,
        )
        reasons.append(f"Transient complement: {ts_s:.0%}")

        env_s = _envelope_fit(
            source.attack_ms if source.category == SoundCategory.KICK else target.attack_ms,
            target.attack_ms if source.category == SoundCategory.BASS else source.attack_ms,
            target.release_ms if target.category == SoundCategory.BASS else source.release_ms,
        )
        reasons.append(f"Envelope fit: {env_s:.0%}")

        stereo_s = 1.0 - abs(source.stereo_width - target.stereo_width) / 2.0
        cat_s = 1.0 if (
            (source.category == SoundCategory.KICK and target.category == SoundCategory.BASS)
            or (source.category == target.category)
        ) else 0.3

        total = (
            w.get("key", 0.15) * key_s
            + w.get("bpm", 0.15) * bpm_s
            + w.get("spectral", 0.20) * spec_s
            + w.get("transient", 0.20) * ts_s
            + w.get("envelope", 0.15) * env_s
            + w.get("stereo", 0.05) * stereo_s
            + w.get("category", 0.10) * cat_s
        )
        return total, reasons

    def find_matches_for_file(
        self,
        file_id: int,
        target_category: str | None = None,
        limit: int = 26,
    ) -> list[MatchResult]:
        row = self.db._conn.execute(
            """SELECT a.*, f.path FROM audio_analysis a
               JOIN files f ON f.id = a.file_id WHERE a.file_id=?""",
            (file_id,),
        ).fetchone()
        if not row:
            return []

        source = self._load_features(row)
        if target_category is None:
            if source.category == SoundCategory.KICK:
                target_category = "bass"
            elif source.category == SoundCategory.BASS:
                target_category = "kick"
            else:
                target_category = source.category.value

        candidates = self.db.search_by_features(category=target_category, limit=500)
        results: list[MatchResult] = []
        for cand in candidates:
            if cand["file_id"] == file_id:
                continue
            target = self._load_features(cand)
            score, reasons = self.score_pair(source, target)
            results.append(
                MatchResult(
                    source_id=file_id,
                    target_id=int(cand["file_id"]),
                    score=score,
                    reasons=reasons,
                )
            )

        results.sort(key=lambda r: r.score, reverse=True)
        return results[:limit]

    def find_by_bpm_key(
        self, bpm: float, key: str, category: str = "lead", limit: int = 9
    ) -> list[Any]:
        return self.db.search_by_features(
            category=category,
            bpm_min=bpm - 2,
            bpm_max=bpm + 2,
            key=key,
            limit=limit,
        )
