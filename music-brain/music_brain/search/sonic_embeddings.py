"""Sonic fingerprint vectors — similarity search without external ML deps."""

from __future__ import annotations

import json
from typing import Any

import numpy as np

from music_brain.search.ai_search import STYLE_REFERENCES


def features_to_vector(features: dict[str, Any]) -> np.ndarray:
    """Build normalized sonic fingerprint from analyzed features."""
    parts: list[float] = []

    mfcc = features.get("mfcc") or []
    parts.extend((mfcc + [0.0] * 13)[:13])

    chroma = features.get("chroma") or []
    parts.extend((chroma + [0.0] * 12)[:12])

    tonnetz = features.get("tonnetz") or []
    parts.extend((tonnetz + [0.0] * 6)[:6])

    contrast = features.get("spectral_contrast") or []
    parts.extend((contrast + [0.0] * 7)[:7])

    sc = float(features.get("spectral_centroid") or 0) / 8000.0
    sr = float(features.get("spectral_rolloff") or 0) / 12000.0
    sb = float(features.get("spectral_bandwidth") or 0) / 6000.0
    zcr = float(features.get("zero_crossing_rate") or 0)
    ts = float(features.get("transient_strength") or 0)
    atk = min(float(features.get("attack_ms") or 0) / 200.0, 1.0)
    rel = min(float(features.get("release_ms") or 0) / 2000.0, 1.0)
    sw = float(features.get("stereo_width") or 0)
    lufs = (float(features.get("lufs") or -24) + 60) / 60.0

    parts.extend([sc, sr, sb, zcr, ts, atk, rel, sw, lufs])

    vec = np.array(parts, dtype=np.float64)
    norm = np.linalg.norm(vec)
    if norm < 1e-9:
        return vec
    return vec / norm


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    if a.shape != b.shape:
        n = min(len(a), len(b))
        a, b = a[:n], b[:n]
    return float(np.dot(a, b))


def vector_to_json(vec: np.ndarray) -> str:
    return json.dumps(vec.tolist())


def vector_from_json(raw: str) -> np.ndarray:
    return np.array(json.loads(raw), dtype=np.float64)


def style_prototype_vector(style_key: str) -> np.ndarray | None:
    """Synthetic fingerprint for artist/style references (Astrix, Ranji...)."""
    ref = STYLE_REFERENCES.get(style_key.lower())
    if not ref:
        return None

    sc_lo, sc_hi = ref.get("spectral_centroid_range", (1500, 3000))
    ts_lo, ts_hi = ref.get("transient_range", (0.3, 0.6))
    bpm_lo, bpm_hi = ref.get("bpm_range", (140, 145))

    synthetic: dict[str, Any] = {
        "mfcc": [0.0] * 13,
        "chroma": [0.1] * 12,
        "tonnetz": [0.0] * 6,
        "spectral_contrast": [0.5] * 7,
        "spectral_centroid": (sc_lo + sc_hi) / 2,
        "spectral_rolloff": sc_hi * 1.5,
        "spectral_bandwidth": (sc_lo + sc_hi) / 2,
        "zero_crossing_rate": 0.05,
        "transient_strength": (ts_lo + ts_hi) / 2,
        "attack_ms": 25.0,
        "release_ms": 400.0,
        "stereo_width": 0.3,
        "lufs": -12.0,
        "bpm": (bpm_lo + bpm_hi) / 2,
    }
    return features_to_vector(synthetic)
