"""Step 9 — natural language search over your library."""

from __future__ import annotations

import re
from typing import Any

from music_brain.database.knowledge_db import KnowledgeDB
from music_brain.matcher.engine import MatcherEngine

# Artist / style reference → feature targets
STYLE_REFERENCES: dict[str, dict[str, Any]] = {
    "astrix": {
        "category": "bass",
        "sub_style": "rolling_bass",
        "bpm_range": (138, 145),
        "spectral_centroid_range": (1000, 3000),
        "transient_range": (0.2, 0.5),
    },
    "ranji": {
        "category": "lead",
        "sub_style": "acid_lead",
        "bpm_range": (140, 148),
        "spectral_centroid_range": (2000, 6000),
    },
    "vini vici": {
        "category": "bass",
        "sub_style": "fullon_bass",
        "bpm_range": (142, 148),
    },
    "infected mushroom": {
        "category": "bass",
        "sub_style": "psy_bass",
        "bpm_range": (140, 150),
    },
}

GENRE_BPM: dict[str, tuple[float, float]] = {
    "full on": (142, 148),
    "fullon": (142, 148),
    "progressive": (128, 138),
    "goa": (138, 145),
    "dark psy": (145, 160),
    "psytrance": (138, 148),
}


def _parse_query(query: str) -> dict[str, Any]:
    q = query.lower().strip()
    intent: dict[str, Any] = {"raw": query}

    # Category
    for cat in ["bass", "lead", "kick", "pad", "fx", "vocal"]:
        if cat in q:
            intent["category"] = cat
            break

    # "like Artist"
    like_match = re.search(r"כמו\s+(\w+)|like\s+(\w+)", q)
    if like_match:
        artist = (like_match.group(1) or like_match.group(2) or "").lower()
        intent["reference_artist"] = artist
        if artist in STYLE_REFERENCES:
            intent.update(STYLE_REFERENCES[artist])

    # BPM — explicit "145 bpm" or bare number before genre (e.g. "145 full on")
    bpm_match = re.search(r"(\d{2,3})\s*bpm", q)
    if not bpm_match:
        bpm_match = re.search(r"\b(1[2-6]\d)\b", q)
    if bpm_match:
        intent["bpm"] = float(bpm_match.group(1))

    # Genre BPM (only if no explicit BPM)
    if "bpm" not in intent:
        for genre, (lo, hi) in GENRE_BPM.items():
            if genre in q:
                intent["bpm_min"] = lo
                intent["bpm_max"] = hi
                intent["genre"] = genre
                break

    # Sub-styles
    styles = [
        "rolling_bass", "offbeat_bass", "fullon_bass", "progressive_bass",
        "dark_bass", "goa_bass", "fullon_kick", "psy_kick",
    ]
    for style in styles:
        token = style.replace("_", " ")
        if token in q or style in q:
            intent["sub_style"] = style
            break

    # Key
    key_match = re.search(r"\b([a-g][#b]?)\b", q, re.IGNORECASE)
    if key_match:
        intent["key"] = key_match.group(1).upper().replace("B", "#")

    # Hebrew keywords
    hebrew_map = {
        "באס": "bass",
        "ליד": "lead",
        "קיק": "kick",
        "פאד": "pad",
        "ווקאל": "vocal",
    }
    for he, en in hebrew_map.items():
        if he in q:
            intent["category"] = en

    return intent


class AISearch:
    def __init__(self, db: KnowledgeDB, matcher: MatcherEngine) -> None:
        self.db = db
        self.matcher = matcher

    def search(self, query: str, limit: int = 30) -> list[dict[str, Any]]:
        intent = _parse_query(query)
        category = intent.get("category")
        bpm_min = intent.get("bpm_min")
        bpm_max = intent.get("bpm_max")
        if intent.get("bpm"):
            bpm_min = intent["bpm"] - 2
            bpm_max = intent["bpm"] + 2

        rows = self.db.search_by_features(
            category=category,
            bpm_min=bpm_min,
            bpm_max=bpm_max,
            key=intent.get("key"),
            sub_style=intent.get("sub_style"),
            limit=limit * 3,
        )

        results: list[dict[str, Any]] = []
        for row in rows:
            import json

            features = json.loads(row["features_json"])
            score = 1.0
            reasons: list[str] = []

            if intent.get("reference_artist"):
                ref = STYLE_REFERENCES.get(intent["reference_artist"], {})
                sc_range = ref.get("spectral_centroid_range")
                if sc_range:
                    sc = features.get("spectral_centroid", 0)
                    lo, hi = sc_range
                    if lo <= sc <= hi:
                        score += 0.3
                        reasons.append(f"Spectral match for {intent['reference_artist']}")
                ts_range = ref.get("transient_range")
                if ts_range:
                    ts = features.get("transient_strength", 0)
                    lo, hi = ts_range
                    if lo <= ts <= hi:
                        score += 0.2
                        reasons.append("Transient profile match")

            if intent.get("sub_style") and row["sub_style"] == intent["sub_style"]:
                score += 0.5
                reasons.append(f"Style: {intent['sub_style']}")

            results.append(
                {
                    "path": row["path"],
                    "category": row["category"],
                    "sub_style": row["sub_style"],
                    "bpm": row["bpm"],
                    "key": row["key"],
                    "lufs": row["lufs"],
                    "score": score,
                    "reasons": reasons or ["Metadata match"],
                }
            )

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:limit]
