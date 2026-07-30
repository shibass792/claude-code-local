"""Stage 2 — sound taxonomy.

Finding the key of a sample is the easy part. What a producer actually asks is
"is this a *rolling* bass or an *offbeat* bass, and is that kick a full-on kick
or a progressive kick?". This module answers that by combining two independent
sources of evidence:

* **naming evidence** — tokens in the file name, folder chain and preset name,
  in English and Hebrew (``באס``, ``ליד``, ``קיק``, ``פאד``);
* **acoustic evidence** — the stage 3 features: where the fundamental sits, how
  fast the attack is, how the onsets fall on the beat grid, how bright and how
  wide the sound is.

Naming evidence wins when it is unambiguous, because a producer who called a
file ``Rolling Bass 145 F#m`` meant it. When the name says nothing, the
features decide, and the returned ``evidence`` list always explains why.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterable

# ---------------------------------------------------------------------------
# vocabulary
# ---------------------------------------------------------------------------

ROLES = (
    "kick",
    "bass",
    "lead",
    "pad",
    "fx",
    "vocal",
    "snare",
    "clap",
    "hat",
    "perc",
    "cymbal",
    "pluck",
    "chord",
    "atmo",
    "loop",
    "unknown",
)

ROLE_KEYWORDS: dict[str, tuple[str, ...]] = {
    "kick": ("kick", "kik", "bd", "bassdrum", "bass drum", "kickdrum", "קיק", "בעיטה"),
    "bass": ("bass", "bas", "sub bass", "subbass", "808", "reese", "באס", "בס"),
    "lead": ("lead", "melody", "melodic", "acid", "arp", "riff", "hook", "topline", "ליד", "מלודיה", "לחן"),
    "pad": ("pad", "atmos pad", "strings", "choir", "drone", "texture", "פאד"),
    "fx": ("fx", "sfx", "riser", "uplifter", "downlifter", "downshifter", "impact", "whoosh", "sweep", "transition", "glitch", "zap", "noise", "אפקט", "אפקטים"),
    "vocal": ("vocal", "vox", "voice", "spoken", "chant", "acapella", "phrase", "talk", "ווקאל", "שירה", "קול"),
    "snare": ("snare", "סנר"),
    "clap": ("clap", "מחיאה"),
    "hat": ("hat", "hihat", "hi-hat", "open hat", "closed hat", "האט"),
    "perc": ("perc", "percussion", "shaker", "tom", "conga", "bongo", "rim", "פרקשן"),
    "cymbal": ("cymbal", "crash", "ride", "splash"),
    "pluck": ("pluck", "stab", "blip", "key", "mallet"),
    "chord": ("chord", "chords", "stack", "harmony"),
    "atmo": ("atmo", "atmosphere", "ambient", "field", "background", "אטמו"),
}

SUBTYPE_KEYWORDS: dict[str, dict[str, tuple[str, ...]]] = {
    "bass": {
        "rolling": ("rolling", "roll", "rolled", "16th", "triplet roll", "רולינג"),
        "offbeat": ("offbeat", "off beat", "off-beat", "eighth", "8th", "אופביט"),
        "fullon": ("fullon", "full on", "full-on", "twisted", "morning bass", "פולאון"),
        "progressive": ("progressive", "prog", "melodic bass", "פרוגרסיב"),
        "dark": ("dark", "darkpsy", "hitech", "hi-tech", "forest", "אפל"),
        "goa": ("goa", "nitzhogoa", "nitzhonot", "goa bass", "גואה"),
        "reese": ("reese", "neuro", "growl", "wobble"),
        "sub": ("sub", "subbass", "sine bass", "808"),
        "acid": ("acid", "303", "tb303"),
    },
    "lead": {
        "acid": ("acid", "303", "tb303", "squelch"),
        "morning": ("morning", "uplifting", "happy", "sunrise"),
        "screamer": ("screamer", "scream", "twisted", "psy lead", "fullon lead"),
        "pluck": ("pluck", "mallet", "bell"),
        "arp": ("arp", "arpeggio", "sequence", "seq"),
        "supersaw": ("supersaw", "saw stack", "trance lead", "hoover"),
        "vocalchop": ("vocal chop", "chop", "vox lead"),
        "goa": ("goa", "nitzhonot", "1997"),
    },
    "kick": {
        "fullon": ("fullon", "full on", "full-on", "psy kick", "psytrance"),
        "progressive": ("progressive", "prog", "melodic"),
        "goa": ("goa", "nitzhonot", "old school"),
        "hitech": ("hitech", "hi-tech", "darkpsy", "forest"),
        "dark": ("dark", "deep kick"),
        "techno": ("techno", "tech house", "warehouse"),
        "house": ("house", "deep house", "tech-house"),
        "trance": ("trance", "uplifting"),
    },
    "pad": {
        "warm": ("warm", "analog", "soft", "lush"),
        "dark": ("dark", "horror", "eerie", "sinister"),
        "cinematic": ("cinematic", "epic", "film", "score"),
        "choir": ("choir", "voices", "vox pad", "aah", "ooh"),
        "evolving": ("evolving", "morph", "movement", "modulated"),
        "drone": ("drone", "static", "sustain"),
    },
    "fx": {
        "riser": ("riser", "uplifter", "rise", "buildup", "build up"),
        "downlifter": ("downlifter", "downshifter", "fall", "drop down"),
        "impact": ("impact", "hit", "boom", "slam", "crash hit"),
        "whoosh": ("whoosh", "sweep", "swoosh", "air"),
        "zap": ("zap", "laser", "blip", "beep", "zip"),
        "glitch": ("glitch", "stutter", "granular", "digital"),
        "reverse": ("reverse", "reversed", "rev "),
        "atmo": ("atmo", "ambience", "background", "texture"),
    },
    "vocal": {
        "spoken": ("spoken", "speech", "talk", "narration", "dialog"),
        "phrase": ("phrase", "line", "sentence", "hook"),
        "chop": ("chop", "chops", "stutter"),
        "chant": ("chant", "mantra", "choir", "crowd"),
        "scream": ("scream", "shout", "yell"),
    },
}

BPM_PATTERN = re.compile(r"(?<!\d)(\d{2,3})\s*(?:bpm|_bpm|-bpm)?(?!\d)", re.IGNORECASE)
BPM_STRICT = re.compile(r"(?<!\d)(\d{2,3})\s*bpm", re.IGNORECASE)
KEY_PATTERN = re.compile(
    r"(?<![a-z0-9])([A-G])\s*(#|b|sharp|flat)?\s*(maj7|maj|major|min|minor|m|M)?(?![a-z0-9])"
)

HEBREW_ROLE_MAP = {
    "באס": "bass",
    "בס": "bass",
    "קיק": "kick",
    "ליד": "lead",
    "מלודיה": "lead",
    "פאד": "pad",
    "אפקט": "fx",
    "ווקאל": "vocal",
    "קול": "vocal",
}


@dataclass
class Classification:
    role: str = "unknown"
    role_conf: float = 0.0
    subtype: str = ""
    subtype_conf: float = 0.0
    is_loop: bool = False
    evidence: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    role_scores: dict[str, float] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "role": self.role,
            "role_conf": round(self.role_conf, 4),
            "subtype": self.subtype,
            "subtype_conf": round(self.subtype_conf, 4),
            "is_loop": self.is_loop,
            "evidence": self.evidence[:12],
            "tags": self.tags[:16],
        }


# ---------------------------------------------------------------------------
# name parsing
# ---------------------------------------------------------------------------


def normalize_text(text: str) -> str:
    lowered = text.replace("\\", "/").lower()
    lowered = re.sub(r"[_\-\.]+", " ", lowered)
    return re.sub(r"\s+", " ", lowered).strip()


def bpm_from_name(text: str) -> float | None:
    """Pull a BPM out of a file name; ``145`` in ``Bass_145_F#m.wav``."""
    normalized = normalize_text(text)
    strict = BPM_STRICT.search(normalized)
    if strict:
        value = float(strict.group(1))
        if 40 <= value <= 220:
            return value
    for match in BPM_PATTERN.finditer(normalized):
        value = float(match.group(1))
        if 80 <= value <= 200:
            return value
    return None


def key_from_name(text: str) -> str | None:
    """Pull a musical key out of a file name; ``F#m`` -> ``F# minor``."""
    normalized = text.replace("\\", "/")
    for chunk in reversed(re.split(r"[ _\-\.\(\)\[\]/]+", normalized)):
        match = KEY_PATTERN.fullmatch(chunk.strip())
        if not match:
            continue
        note, accidental, mode = match.group(1).upper(), match.group(2), match.group(3)
        if accidental in ("#", "sharp"):
            note += "#"
        elif accidental in ("b", "flat"):
            flats = {"C": "B", "D": "C#", "E": "D#", "F": "E", "G": "F#", "A": "G#", "B": "A#"}
            note = flats.get(note, note)
        if mode is None:
            continue
        mode_l = mode.lower()
        if mode_l in ("m", "min", "minor"):
            return f"{note} minor"
        if mode_l in ("maj", "major", "maj7") or mode == "M":
            return f"{note} major"
    return None


def name_role_scores(text: str) -> dict[str, tuple[float, str]]:
    """Role -> (score, reason) from naming tokens."""
    normalized = normalize_text(text)
    hits: dict[str, tuple[float, str]] = {}
    for role, tokens in ROLE_KEYWORDS.items():
        for token in tokens:
            if token in normalized:
                # a longer token is more specific; folder-level hits count less
                weight = 0.55 + min(len(token), 10) * 0.02
                prior = hits.get(role, (0.0, ""))
                if weight > prior[0]:
                    hits[role] = (weight, f"name contains '{token}'")
    for hebrew, role in HEBREW_ROLE_MAP.items():
        if hebrew in text:
            prior = hits.get(role, (0.0, ""))
            hits[role] = (max(prior[0], 0.7), f"name contains '{hebrew}'")
    return hits


def name_subtype(role: str, text: str) -> tuple[str, float, str] | None:
    table = SUBTYPE_KEYWORDS.get(role)
    if not table:
        return None
    normalized = normalize_text(text)
    best: tuple[str, float, str] | None = None
    for subtype, tokens in table.items():
        for token in tokens:
            if token in normalized:
                score = 0.6 + min(len(token), 12) * 0.02
                if best is None or score > best[1]:
                    best = (subtype, score, f"name contains '{token}'")
    return best


# ---------------------------------------------------------------------------
# acoustic role inference
# ---------------------------------------------------------------------------


def _get(features: dict[str, Any], key: str, default: float = 0.0) -> float:
    value = features.get(key, default)
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def feature_role_scores(f: dict[str, Any]) -> dict[str, tuple[float, str]]:
    """Role -> (score, reason) from the acoustic features alone."""
    duration = _get(f, "duration")
    fundamental = _get(f, "fundamental_hz")
    centroid = _get(f, "centroid_hz")
    rolloff = _get(f, "rolloff85_hz")
    attack = _get(f, "attack_ms")
    release = _get(f, "release_ms")
    sustain = _get(f, "sustain_ratio")
    transient = _get(f, "transient")
    width = _get(f, "stereo_width")
    flatness = _get(f, "flatness")
    zcr = _get(f, "zcr")
    low = _get(f, "band_20_60") + _get(f, "band_60_120")
    mid = _get(f, "band_250_500") + _get(f, "band_500_1000")
    high = _get(f, "band_4000_8000") + _get(f, "band_8000_16000")
    onsets = len(f.get("onset_times") or [])
    pitch_conf = _get(f, "pitch_conf")

    scores: dict[str, tuple[float, str]] = {}

    def add(role: str, score: float, reason: str) -> None:
        prior = scores.get(role, (0.0, ""))
        if score > prior[0]:
            scores[role] = (score, reason)

    # kick: short, very low, hard transient, dies quickly
    if duration and duration < 2.0 and low > 0.35 and transient > 0.3 and onsets <= 2:
        add("kick", 0.55 + min(low, 0.5), f"short ({duration:.2f}s), {low*100:.0f}% energy below 120 Hz, sharp transient")
    # bass: low fundamental that sustains
    if 25 <= fundamental <= 140 and (sustain > 0.15 or duration > 1.0) and low > 0.15:
        add("bass", 0.5 + min(sustain, 0.4), f"fundamental {fundamental:.0f} Hz with sustain {sustain:.2f}")
    if 25 <= fundamental <= 70 and high < 0.05 and sustain > 0.3:
        add("bass", 0.6, f"sub-range fundamental {fundamental:.0f} Hz, almost no highs")
    # lead: mid/high pitched and tonal
    if fundamental >= 180 and pitch_conf > 0.05 and duration < 12:
        add("lead", 0.45 + min(pitch_conf, 0.3), f"tonal at {fundamental:.0f} Hz")
    # pad: long, slow attack, wide, low flux
    if duration > 3.0 and attack > 60 and sustain > 0.35:
        add("pad", 0.5 + min(width * 0.2, 0.25), f"long ({duration:.1f}s) with {attack:.0f} ms attack and high sustain")
    # fx: noisy, no stable pitch, often long and wide
    if flatness > 0.02 and pitch_conf < 0.06 and (zcr > 0.1 or rolloff > 6000):
        add("fx", 0.45 + min(flatness * 4, 0.3), f"noisy (flatness {flatness:.3f}) with no stable pitch")
    if duration > 1.5 and release > duration * 900 and high > 0.25:
        add("fx", 0.5, "long bright tail typical of a riser or sweep")
    # hats / cymbals: short bright noise
    if duration < 1.2 and high > 0.3 and low < 0.1:
        add("hat", 0.55, f"short and bright ({high*100:.0f}% above 4 kHz)")
    if duration >= 1.2 and high > 0.35 and low < 0.1 and pitch_conf < 0.06:
        add("cymbal", 0.5, "bright sustained noise")
    # snare / clap: mid-heavy short noise with fast transient
    if duration < 1.2 and mid > 0.2 and transient > 0.35 and pitch_conf < 0.15:
        add("snare", 0.45, "mid-band noise burst with fast transient")
    # vocal: energy concentrated 300 Hz - 3 kHz with moderate zcr
    formant = _get(f, "band_250_500") + _get(f, "band_500_1000") + _get(f, "band_1000_2000")
    if formant > 0.5 and 0.02 < zcr < 0.2 and duration > 0.4 and low < 0.1:
        add("vocal", 0.45, f"{formant*100:.0f}% of energy in the vocal formant range")
    # loops
    if onsets >= 4 and duration > 1.5:
        add("loop", 0.35, f"{onsets} onsets over {duration:.1f}s")
    return scores


# ---------------------------------------------------------------------------
# acoustic subtype inference
# ---------------------------------------------------------------------------


def feature_subtype(role: str, f: dict[str, Any]) -> tuple[str, float, str] | None:
    bpm = _get(f, "bpm")
    per_beat = _get(f, "onsets_per_beat")
    offbeat = _get(f, "offbeat_ratio")
    sixteenth = _get(f, "sixteenth_ratio")
    triplet = _get(f, "triplet_ratio")
    gate = _get(f, "gate_ratio")
    centroid = _get(f, "centroid_hz")
    release = _get(f, "release_ms")
    decay = _get(f, "decay_ms")
    sustain = _get(f, "sustain_ratio")
    attack = _get(f, "attack_ms")
    flatness = _get(f, "flatness")
    width = _get(f, "stereo_width")
    mode = str(f.get("key_mode") or "")
    high = _get(f, "band_4000_8000") + _get(f, "band_8000_16000")
    low = _get(f, "band_20_60") + _get(f, "band_60_120")
    duration = _get(f, "duration")
    candidates: list[tuple[str, float, str]] = []

    if role == "bass":
        if per_beat >= 2.4 and (sixteenth > 0.2 or triplet > 0.2) and gate > 0.05:
            score = 0.55 + min(per_beat / 10.0, 0.25)
            candidates.append(("rolling", score, f"{per_beat:.1f} onsets per beat with gaps between them"))
        if 0.7 <= per_beat <= 1.8 and offbeat > 0.35:
            candidates.append(("offbeat", 0.6 + min(offbeat, 0.3), f"{offbeat*100:.0f}% of hits land on the offbeat"))
        if bpm >= 140 and per_beat >= 2.4 and centroid > 260:
            candidates.append(("fullon", 0.55 + min((bpm - 140) / 100.0, 0.2), f"{bpm:.0f} BPM, dense and bright ({centroid:.0f} Hz centroid)"))
        if 118 <= bpm <= 138 and sustain > 0.25 and per_beat <= 2.2:
            candidates.append(("progressive", 0.55, f"{bpm:.0f} BPM with a sustained, less dense pattern"))
        if bpm >= 145 and (centroid < 220 or flatness > 0.02) and mode == "minor":
            candidates.append(("dark", 0.5, f"fast ({bpm:.0f} BPM), dull spectrum, minor mode"))
        if 138 <= bpm <= 152 and triplet > 0.25 and release > 120:
            candidates.append(("goa", 0.55, f"triplet feel at {bpm:.0f} BPM with a long tail"))
        if release > 400 and sustain > 0.5 and centroid < 150:
            candidates.append(("sub", 0.45, "long sustained sub with almost no upper harmonics"))
        if flatness < 0.005 and centroid > 400 and per_beat >= 2:
            candidates.append(("acid", 0.4, "resonant, harmonically narrow and sequenced"))
    elif role == "kick":
        if bpm >= 140 or (decay and decay < 90):
            candidates.append(("fullon", 0.5, f"tight decay ({decay:.0f} ms) suited to 140+ BPM"))
        if decay >= 120 and low > 0.5:
            candidates.append(("progressive", 0.5, f"longer body ({decay:.0f} ms) with deep low end"))
        if high > 0.12 and decay < 90:
            candidates.append(("hitech", 0.45, "clicky top end with a very short body"))
        if _get(f, "fundamental_hz") and _get(f, "fundamental_hz") < 45 and decay > 150:
            candidates.append(("techno", 0.4, "deep, long kick body"))
    elif role == "lead":
        if flatness < 0.004 and centroid > 800 and per_beat >= 2:
            candidates.append(("acid", 0.5, "narrow resonant spectrum, sequenced"))
        if mode == "major" and centroid > 1200 and width > 0.3:
            candidates.append(("morning", 0.45, "bright, wide and major"))
        if bpm >= 140 and high > 0.2 and per_beat >= 2:
            candidates.append(("screamer", 0.45, "aggressive high content at high tempo"))
        if attack < 15 and release < 400 and duration < 2:
            candidates.append(("pluck", 0.45, "fast attack, short release"))
        if per_beat >= 3 and _get(f, "ioi_regularity") > 0.6:
            candidates.append(("arp", 0.45, "very regular fast note grid"))
        if width > 0.5 and centroid > 1500 and sustain > 0.4:
            candidates.append(("supersaw", 0.4, "wide sustained bright stack"))
    elif role == "pad":
        if mode == "minor" and centroid < 700:
            candidates.append(("dark", 0.45, "minor and dull"))
        if centroid >= 700 and width > 0.4:
            candidates.append(("evolving", 0.4, "bright and wide with movement"))
        if duration > 8 and _get(f, "ioi_regularity") == 0 and sustain > 0.6:
            candidates.append(("drone", 0.45, "very long and static"))
        if centroid < 500 and width < 0.4:
            candidates.append(("warm", 0.4, "narrow and dark-warm"))
    elif role == "fx":
        centroid_slope = _get(f, "centroid_slope")
        if centroid_slope > 0.15:
            candidates.append(("riser", 0.6, "spectral centre rises over time"))
        elif centroid_slope < -0.15:
            candidates.append(("downlifter", 0.6, "spectral centre falls over time"))
        if duration < 1.5 and _get(f, "transient") > 0.5 and low > 0.3:
            candidates.append(("impact", 0.55, "short low-heavy hit"))
        if flatness > 0.05 and duration > 2:
            candidates.append(("whoosh", 0.45, "broadband noise sweep"))
        if duration < 0.6 and centroid > 3000:
            candidates.append(("zap", 0.45, "very short and very bright"))
    elif role == "vocal":
        if duration < 0.6:
            candidates.append(("chop", 0.45, "very short vocal fragment"))
        elif duration > 2.5:
            candidates.append(("phrase", 0.45, "long enough to be a sung or spoken phrase"))

    if not candidates:
        return None
    candidates.sort(key=lambda c: c[1], reverse=True)
    return candidates[0]


# ---------------------------------------------------------------------------
# entry point
# ---------------------------------------------------------------------------


def classify(features: dict[str, Any], path: str = "", extra_text: Iterable[str] = ()) -> Classification:
    """Decide role + subtype for one sound."""
    text = " ".join([path, *extra_text])
    name_scores = name_role_scores(text)
    acoustic_scores = feature_role_scores(features)

    combined: dict[str, float] = {}
    evidence: dict[str, list[str]] = {}
    for role, (score, reason) in name_scores.items():
        combined[role] = combined.get(role, 0.0) + score
        evidence.setdefault(role, []).append(reason)
    for role, (score, reason) in acoustic_scores.items():
        combined[role] = combined.get(role, 0.0) + score * 0.8
        evidence.setdefault(role, []).append(reason)

    result = Classification()
    if combined:
        role, total = max(combined.items(), key=lambda kv: kv[1])
        result.role = role
        result.role_conf = float(min(total / 1.6, 1.0))
        result.evidence = evidence.get(role, [])
        result.role_scores = {k: round(v, 3) for k, v in sorted(combined.items(), key=lambda kv: -kv[1])[:5]}

    named = name_subtype(result.role, text)
    inferred = feature_subtype(result.role, features)
    if named and inferred and named[0] == inferred[0]:
        result.subtype = named[0]
        result.subtype_conf = float(min(named[1] + inferred[1] * 0.5, 1.0))
        result.evidence = [*result.evidence, named[2], inferred[2]]
    elif named:
        result.subtype = named[0]
        result.subtype_conf = float(min(named[1], 1.0))
        result.evidence = [*result.evidence, named[2]]
        if inferred:
            result.tags.append(f"acoustic:{inferred[0]}")
    elif inferred:
        result.subtype = inferred[0]
        result.subtype_conf = float(min(inferred[1] * 0.9, 1.0))
        result.evidence = [*result.evidence, inferred[2]]

    onsets = len(features.get("onset_times") or [])
    result.is_loop = bool(onsets >= 4 and _get(features, "duration") > 1.5)
    if result.is_loop:
        result.tags.append("loop")
    else:
        result.tags.append("oneshot")
    if features.get("musical_key"):
        result.tags.append(str(features["musical_key"]))
    return result
