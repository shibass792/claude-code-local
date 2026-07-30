"""Matcher engine (Stage 4) — kick↔bass fit beyond key, using envelope/transient/pitch."""

from __future__ import annotations

import math
from typing import Any

from music_brain.db import KnowledgeDB


def _feat(row: dict[str, Any], key: str, default: float = 0.0) -> float:
    feats = row.get("features") or {}
    if key in row and row[key] is not None:
        try:
            return float(row[key])
        except (TypeError, ValueError):
            pass
    val = feats.get(key, default)
    try:
        return float(val if val is not None else default)
    except (TypeError, ValueError):
        return default


def compatibility_score(
    a: dict[str, Any],
    b: dict[str, Any],
    *,
    prefer_same_key: bool = False,
) -> dict[str, Any]:
    """Score how well two sounds work together (0..1).

    Pitch/Key is only one signal — envelope, transient, and spectrum often matter more
    for kick+bass glue in psytrance.
    """
    parts: dict[str, float] = {}

    # Transient complementarity: kick high transient + bass lower = good glue
    ta, tb = _feat(a, "transient_ratio"), _feat(b, "transient_ratio")
    t_diff = abs(ta - tb)
    # Reward difference (complementary), penalize similar punchy collisions
    parts["transient"] = min(1.0, t_diff * 1.6)

    aa, ab = _feat(a, "attack_ms", 30), _feat(b, "attack_ms", 30)
    # Prefer kick faster than bass (ordered complementarity)
    faster, slower = min(aa, ab), max(aa, ab)
    parts["attack"] = min(1.0, (slower - faster) / 40.0)
    if abs(aa - ab) < 3:
        parts["attack"] *= 0.35  # near-identical attacks → masking risk

    ra, rb = _feat(a, "release_ms", 100), _feat(b, "release_ms", 100)
    # Mild preference for different release lengths
    parts["envelope"] = min(1.0, abs(ra - rb) / 250.0)

    ca, cb = _feat(a, "spectral_centroid_mean", 1000), _feat(b, "spectral_centroid_mean", 1000)
    # Prefer non-overlapping centroids (kick low vs bass mid, etc.)
    sep = abs(ca - cb)
    parts["spectrum"] = min(1.0, sep / 800.0)
    if sep < 80:
        parts["spectrum"] *= 0.25  # heavy mud penalty

    da, db = _feat(a, "dynamic_range_db", 6), _feat(b, "dynamic_range_db", 6)
    parts["dynamics"] = 1.0 - min(1.0, abs(da - db) / 20.0)

    bpma, bpmb = a.get("bpm"), b.get("bpm")
    if bpma and bpmb:
        parts["tempo"] = 1.0 - min(1.0, abs(float(bpma) - float(bpmb)) / 20.0)
    else:
        parts["tempo"] = 0.5

    ka, kb = a.get("key"), b.get("key")
    if ka and kb:
        parts["key"] = 1.0 if _keys_compatible(str(ka), str(kb)) else 0.55
    else:
        parts["key"] = 0.5

    # Rebalance: spectrum + transient dominate over key for kick/bass glue
    weights = {
        "transient": 0.24,
        "attack": 0.16,
        "envelope": 0.12,
        "spectrum": 0.26,
        "dynamics": 0.08,
        "tempo": 0.08,
        "key": 0.06,
    }
    if prefer_same_key:
        weights["key"] = 0.18
        weights["spectrum"] = 0.20
        weights["transient"] = 0.20

    total = sum(parts[k] * weights[k] for k in weights)
    return {
        "score": round(total, 4),
        "parts": {k: round(v, 4) for k, v in parts.items()},
        "weights": weights,
    }


def _keys_compatible(a: str, b: str) -> bool:
    if a == b:
        return True
    # Relative major/minor rough check
    order = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

    def root(k: str) -> tuple[str, bool]:
        k = k.strip()
        minor = k.endswith("m") and not k.lower().endswith("maj")
        core = k[:-1] if minor and len(k) > 1 else k
        core = core.replace("maj", "").replace("min", "")
        return core, minor

    ra, ma = root(a)
    rb, mb = root(b)
    if ra not in order or rb not in order:
        return a[0].upper() == b[0].upper()
    ia, ib = order.index(ra), order.index(rb)
    # same root, relative (3 semitones), or fifth
    return ia == ib or abs(ia - ib) % 12 in {3, 4, 5, 7}


def match_for(
    db: KnowledgeDB,
    *,
    target_family: str,
    reference: dict[str, Any] | None = None,
    key: str | None = None,
    bpm: float | None = None,
    bpm_tolerance: float = 6.0,
    style: str | None = None,
    limit: int = 25,
    prefer_same_key: bool = False,
) -> list[dict[str, Any]]:
    """Find best matching samples of target_family for a reference sound / project context."""
    candidates = db.samples_with_analysis(style_family=target_family, style=style, limit=5000)
    if key and prefer_same_key:
        keyed = [c for c in candidates if c.get("key") == key]
        if keyed:
            candidates = keyed

    if bpm is not None:
        lo, hi = bpm - bpm_tolerance, bpm + bpm_tolerance
        near = [
            c
            for c in candidates
            if c.get("bpm") is None or (lo <= float(c["bpm"]) <= hi)
        ]
        if near:
            candidates = near

    scored: list[dict[str, Any]] = []
    for c in candidates:
        if reference:
            detail = compatibility_score(reference, c, prefer_same_key=prefer_same_key)
            score = detail["score"]
            parts = detail["parts"]
        else:
            # Context-only: prefer matching key/bpm/style
            score = 0.5
            parts = {}
            if key and c.get("key") == key:
                score += 0.25
            if bpm and c.get("bpm"):
                score += max(0, 0.25 - abs(float(c["bpm"]) - bpm) / 40.0)
            if style and c.get("style") == style:
                score += 0.2
        scored.append({**c, "match_score": round(min(1.0, score), 4), "match_parts": parts})

    scored.sort(key=lambda x: x["match_score"], reverse=True)
    return scored[:limit]


def match_bass_for_kick(
    db: KnowledgeDB,
    kick_path: str | None = None,
    kick_features: dict[str, Any] | None = None,
    *,
    key: str | None = None,
    bpm: float | None = None,
    limit: int = 26,
) -> list[dict[str, Any]]:
    """Stage 7 helper — 'מצאתי 26 באסים שמתאימים'."""
    ref = kick_features
    if kick_path and ref is None:
        rows = db.samples_with_analysis(style_family="kick", limit=5000)
        ref = next((r for r in rows if r["path"] == kick_path), None)
        if ref is None:
            from music_brain.analyzer.audio import analyze_file

            ref = analyze_file(kick_path, role_hint="kick")
    return match_for(
        db,
        target_family="bass",
        reference=ref,
        key=key,
        bpm=bpm,
        limit=limit,
        prefer_same_key=False,
    )


def match_melodies_same_key(
    db: KnowledgeDB,
    key: str,
    *,
    limit: int = 9,
) -> list[dict[str, Any]]:
    return match_for(
        db,
        target_family="lead",
        key=key,
        prefer_same_key=True,
        limit=limit,
    )


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    n = min(len(a), len(b))
    dot = sum(a[i] * b[i] for i in range(n))
    na = math.sqrt(sum(a[i] * a[i] for i in range(n))) + 1e-12
    nb = math.sqrt(sum(b[i] * b[i] for i in range(n))) + 1e-12
    return dot / (na * nb)
