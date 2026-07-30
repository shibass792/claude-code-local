"""Key detection with a confidence number, plus harmonic-distance helpers.

Krumhansl-Schmuckler profiles are correlated against the mean chroma for all 24
keys. Confidence is the normalised margin between the winner and the runner-up,
so a single sustained bass note reports low confidence while a full chord
progression reports high confidence — exactly the distinction stage 4 needs
when it decides whether key should matter for a match at all.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .dsp import NOTE_NAMES

MAJOR_PROFILE = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
MINOR_PROFILE = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)

#: Camelot wheel position for every key, used for "compatible key" reasoning
CAMELOT = {
    "B major": "1B", "G# minor": "1A",
    "F# major": "2B", "D# minor": "2A",
    "C# major": "3B", "A# minor": "3A",
    "G# major": "4B", "F minor": "4A",
    "D# major": "5B", "C minor": "5A",
    "A# major": "6B", "G minor": "6A",
    "F major": "7B", "D minor": "7A",
    "C major": "8B", "A minor": "8A",
    "G major": "9B", "E minor": "9A",
    "D major": "10B", "B minor": "10A",
    "A major": "11B", "F# minor": "11A",
    "E major": "12B", "C# minor": "12A",
}


@dataclass
class KeyEstimate:
    key: str = ""
    tonic: str = ""
    mode: str = ""
    confidence: float = 0.0
    camelot: str = ""
    scores: dict[str, float] | None = None

    def as_dict(self) -> dict[str, object]:
        return {
            "musical_key": self.key,
            "key_tonic": self.tonic,
            "key_mode": self.mode,
            "key_conf": round(self.confidence, 4),
            "camelot": self.camelot,
        }


def detect_key(chroma: np.ndarray) -> KeyEstimate:
    """Estimate the key from a chromagram (12 x frames) or a 12-vector."""
    vector = np.asarray(chroma, dtype=np.float64)
    if vector.ndim == 2:
        vector = vector.mean(axis=1)
    if vector.size != 12 or vector.sum() <= 1e-9:
        return KeyEstimate()
    vector = vector / vector.sum()

    scores: dict[str, float] = {}
    for pc in range(12):
        rotated = np.roll(vector, -pc)
        for mode, profile in (("major", MAJOR_PROFILE), ("minor", MINOR_PROFILE)):
            prof = profile / profile.sum()
            corr = float(np.corrcoef(rotated, prof)[0, 1])
            if np.isnan(corr):
                corr = 0.0
            scores[f"{NOTE_NAMES[pc]} {mode}"] = corr

    ordered = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    best_name, best_score = ordered[0]
    runner_score = ordered[1][1] if len(ordered) > 1 else 0.0
    margin = max(best_score - runner_score, 0.0)
    confidence = float(np.clip(0.5 * max(best_score, 0.0) + 2.0 * margin, 0.0, 1.0))
    tonic, mode = best_name.split(" ")
    return KeyEstimate(
        key=best_name,
        tonic=tonic,
        mode=mode,
        confidence=confidence,
        camelot=CAMELOT.get(best_name, ""),
        scores={k: round(v, 4) for k, v in ordered[:5]},
    )


def _camelot_parts(key: str) -> tuple[int, str] | None:
    code = CAMELOT.get(key)
    if not code:
        return None
    return int(code[:-1]), code[-1]


def key_distance(a: str, b: str) -> float:
    """0.0 = same key, 1.0 = harmonically unrelated (Camelot wheel distance)."""
    if not a or not b:
        return 0.5
    if a == b:
        return 0.0
    pa, pb = _camelot_parts(a), _camelot_parts(b)
    if not pa or not pb:
        return 0.5
    (num_a, letter_a), (num_b, letter_b) = pa, pb
    ring = min(abs(num_a - num_b), 12 - abs(num_a - num_b))
    mode_penalty = 0.0 if letter_a == letter_b else (0.15 if ring == 0 else 0.3)
    return float(min(1.0, ring / 6.0 + mode_penalty))


def compatible_keys(key: str) -> list[str]:
    """Neighbours on the Camelot wheel: relative, dominant, sub-dominant."""
    parts = _camelot_parts(key)
    if not parts:
        return []
    num, letter = parts
    other = "A" if letter == "B" else "B"
    codes = {
        f"{num}{letter}",
        f"{num}{other}",
        f"{(num % 12) + 1}{letter}",
        f"{((num - 2) % 12) + 1}{letter}",
    }
    return [name for name, code in CAMELOT.items() if code in codes]


def semitone_interval(hz_a: float, hz_b: float) -> float:
    """Signed interval in semitones between two frequencies."""
    if hz_a <= 0 or hz_b <= 0:
        return 0.0
    return float(12.0 * np.log2(hz_b / hz_a))


def interval_consonance(semitones: float) -> float:
    """How well two fundamentals sit together, 0 .. 1.

    Unison / octave score highest, then fifth and fourth, then thirds; a
    semitone or tritone apart scores worst. Octave-invariant.
    """
    folded = abs(semitones) % 12.0
    folded = min(folded, 12.0 - folded)
    table = {
        0.0: 1.0,
        1.0: 0.15,
        2.0: 0.45,
        3.0: 0.7,
        4.0: 0.72,
        5.0: 0.8,
        6.0: 0.2,
    }
    low = int(np.floor(folded))
    high = min(low + 1, 6)
    frac = folded - low
    return float((1 - frac) * table.get(float(low), 0.5) + frac * table.get(float(high), 0.5))
