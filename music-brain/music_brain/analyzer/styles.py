"""Style classifiers from path hints + audio features (Stage 2)."""

from __future__ import annotations

import re
from typing import Any

from music_brain.config import (
    BASS_STYLES,
    FX_STYLES,
    KICK_STYLES,
    LEAD_STYLES,
    PAD_STYLES,
    VOCAL_STYLES,
)

BASS_STYLE_HINTS: dict[str, tuple[str, ...]] = {
    "Rolling Bass": ("rolling", "roll bass", "rollin"),
    "Offbeat Bass": ("offbeat", "off beat", "off-beat", "hoover bass"),
    "FullOn Bass": ("fullon", "full on", "full-on", "fo bass"),
    "Progressive Bass": ("progressive", "prog bass", "progpsy"),
    "Dark Bass": ("dark bass", "darkpsy", "forest bass"),
    "Goa Bass": ("goa", "goa bass", "oldschool"),
    "Reese Bass": ("reese", "neuro"),
    "Sub Bass": ("sub bass", "subbass", "808 sub", "pure sub"),
    "Acid Bass": ("acid", "303", "tb303", "squelch"),
}

LEAD_STYLE_HINTS: dict[str, tuple[str, ...]] = {
    "Supersaw Lead": ("supersaw", "super saw", "saw lead"),
    "Pluck Lead": ("pluck", "plucky"),
    "Acid Lead": ("acid lead", "303 lead", "squelch lead"),
    "Hoover Lead": ("hoover",),
    "Trance Lead": ("trance lead", "uplifting"),
    "Psy Lead": ("psy lead", "psytrance lead", "screech", "histrionic"),
}

KICK_STYLE_HINTS: dict[str, tuple[str, ...]] = {
    "FullOn Kick": ("fullon kick", "full on kick", "fo kick", "145", "148"),
    "Progressive Kick": ("progressive kick", "prog kick", "138", "140"),
    "Dark Kick": ("dark kick", "darkpsy kick", "forest kick"),
    "Techno Kick": ("techno kick", "industrial kick"),
    "Soft Kick": ("soft kick", "round kick", "deep kick"),
}


def _norm(s: str) -> str:
    return re.sub(r"[_\-]+", " ", s.lower())


def _match_hints(text: str, table: dict[str, tuple[str, ...]]) -> str | None:
    for style, hints in table.items():
        for h in hints:
            if h in text:
                return style
    return None


def classify_style(
    path: str,
    role_hint: str | None,
    features: dict[str, Any] | None = None,
) -> tuple[str | None, str | None]:
    """Return (style, style_family) using path hints + optional audio features."""
    text = _norm(path)
    features = features or {}
    family = role_hint

    if family == "bass" or (family is None and "bass" in text):
        style = _match_hints(text, BASS_STYLE_HINTS)
        if style is None and features:
            style = _bass_from_features(features)
        return style or "Unknown Bass", "bass"

    if family == "kick" or (family is None and "kick" in text):
        style = _match_hints(text, KICK_STYLE_HINTS)
        if style is None and features:
            style = _kick_from_features(features)
        return style or "Unknown Kick", "kick"

    if family == "lead" or (family is None and any(x in text for x in ("lead", "melody"))):
        style = _match_hints(text, LEAD_STYLE_HINTS)
        if style is None and features:
            style = _lead_from_features(features)
        return style or "Unknown Lead", "lead"

    if family == "pad":
        if "dark" in text:
            return "Dark Pad", "pad"
        if "bright" in text or "air" in text:
            return "Bright Pad", "pad"
        if "evolving" in text or "motion" in text:
            return "Evolving Pad", "pad"
        return "Warm Pad", "pad"

    if family == "fx":
        if "riser" in text or "uplift" in text:
            return "Riser", "fx"
        if "impact" in text or "hit" in text:
            return "Impact", "fx"
        if "sweep" in text or "noise" in text:
            return "Sweep", "fx"
        if "glitch" in text:
            return "Glitch", "fx"
        return "Atmosphere FX", "fx"

    if family == "vocal":
        if "chop" in text or "glitch" in text:
            return "Chopped Vocal", "vocal"
        if "pad" in text or "ahhs" in text:
            return "Pad Vocal", "vocal"
        if "speak" in text or "talk" in text:
            return "Spoken", "vocal"
        return "Psy Vocal", "vocal"

    return None, family


def _bass_from_features(f: dict[str, Any]) -> str | None:
    """Heuristic bass style from spectral / envelope features."""
    centroid = float(f.get("spectral_centroid_mean") or 0)
    rolloff = float(f.get("spectral_rolloff_mean") or 0)
    attack = float(f.get("attack_ms") or 0)
    rms = float(f.get("rms_mean") or 0)
    width = float(f.get("stereo_width") or 0)

    if centroid < 400 and attack > 40:
        return "Sub Bass"
    if 800 < centroid < 2500 and attack < 25 and rms > 0.05:
        return "FullOn Bass"
    if centroid > 1800 and rolloff > 4000:
        return "Acid Bass"
    if width > 0.55 and centroid < 1200:
        return "Reese Bass"
    if attack < 15 and centroid < 900:
        return "Offbeat Bass"
    if centroid < 700:
        return "Dark Bass"
    if 600 < centroid < 1400:
        return "Rolling Bass"
    return "Progressive Bass"


def _kick_from_features(f: dict[str, Any]) -> str | None:
    attack = float(f.get("attack_ms") or 0)
    centroid = float(f.get("spectral_centroid_mean") or 0)
    duration = float(f.get("duration_sec") or 0)
    punch = float(f.get("transient_ratio") or 0)

    if punch > 0.7 and attack < 12 and centroid > 150:
        if duration < 0.45:
            return "FullOn Kick"
        return "Techno Kick"
    if attack > 20 or centroid < 120:
        return "Soft Kick"
    if centroid < 180:
        return "Dark Kick"
    return "Progressive Kick"


def _lead_from_features(f: dict[str, Any]) -> str | None:
    centroid = float(f.get("spectral_centroid_mean") or 0)
    width = float(f.get("stereo_width") or 0)
    contrast = float(f.get("spectral_contrast_mean") or 0)
    if width > 0.6 and centroid > 2000:
        return "Supersaw Lead"
    if contrast > 25 and centroid > 2500:
        return "Acid Lead"
    if centroid > 3000:
        return "Psy Lead"
    if float(f.get("attack_ms") or 0) < 20:
        return "Pluck Lead"
    return "Trance Lead"


def known_styles() -> dict[str, tuple[str, ...]]:
    return {
        "bass": BASS_STYLES,
        "lead": LEAD_STYLES,
        "kick": KICK_STYLES,
        "pad": PAD_STYLES,
        "fx": FX_STYLES,
        "vocal": VOCAL_STYLES,
    }
