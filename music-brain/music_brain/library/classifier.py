"""Classify indexed audio into browsable libraries (music, samples, loops)."""

from __future__ import annotations

from pathlib import Path

from music_brain.models.types import SoundCategory

LIBRARY_MUSIC = "music"
LIBRARY_SAMPLES = "samples"
LIBRARY_LOOPS = "loops"
LIBRARY_OTHER = "other"

LIBRARY_LABELS_HE: dict[str, str] = {
    LIBRARY_MUSIC: "מוזיקה / שירים",
    LIBRARY_SAMPLES: "סמפלים",
    LIBRARY_LOOPS: "לופים",
    LIBRARY_OTHER: "אחר",
}

SAMPLE_SUB_LABELS_HE: dict[str, str] = {
    "bass": "באס",
    "kick": "קיק",
    "lead": "ליד",
    "pad": "פד",
    "fx": "אפקטים",
    "vocal": "ווקאל",
    "drum": "תופים",
    "percussion": "פרקושן",
    "loops": "לופים",
    "other": "כללי",
}

MUSIC_PATH_KEYWORDS = [
    "music",
    "songs",
    "song",
    "itunes",
    "spotify",
    "bandcamp",
    "album",
    "albums",
    "playlist",
    "playlists",
    "google play",
    "amazon music",
    "deezer",
    "tidal",
    "soundcloud",
    "downloads",
    "my music",
    "נגינה",
    "שירים",
]

SAMPLE_PATH_KEYWORDS = [
    "sample",
    "samples",
    "sampl",
    "oneshot",
    "one-shot",
    "one_shot",
    "soundbank",
    "sound bank",
    "pack",
    "packs",
    "splice",
    "loopmasters",
    "cymatics",
    "ghost syndicate",
    "sample pack",
    "wav pack",
    "serum",
    "vital",
    "nexus",
    "kontakt",
    "library",
    "libraries",
    "producer",
    "psytrance",
    "fullon",
    "goa",
]

LOOP_PATH_KEYWORDS = [
    "loop",
    "loops",
    "drum loop",
    "drumloop",
    "midi loop",
]

# Folders that are almost always production samples, not songs
PRODUCTION_ROOT_HINTS = [
    "sample",
    "samples",
    "sound",
    "sounds",
    "splice",
    "loopmasters",
    "cymatics",
    "vst",
    "presets",
    "serum",
    "kontakt",
]


def _norm(path: str) -> str:
    return path.lower().replace("/", "\\")


def _has_keyword(path_norm: str, keywords: list[str]) -> bool:
    return any(kw in path_norm for kw in keywords)


def detect_sample_sub(path: str, category_hint: str | None) -> str:
    if category_hint and category_hint != SoundCategory.UNKNOWN.value:
        return category_hint
    path_norm = _norm(path)
    sub_map = {
        "bass": ["bass", "sub", "reese"],
        "kick": ["kick", "kicks", "bd", "bassdrum"],
        "lead": ["lead", "melody", "arp", "pluck", "stab"],
        "pad": ["pad", "pads", "atmosphere", "ambient"],
        "fx": ["fx", "sfx", "riser", "impact", "whoosh"],
        "vocal": ["vocal", "vox", "voice", "acapella"],
        "drum": ["drum", "snare", "hat", "hihat", "clap"],
        "percussion": ["perc", "percussion", "tom", "shaker"],
        "loops": ["loop", "loops"],
    }
    for sub, keys in sub_map.items():
        if any(k in path_norm for k in keys):
            return sub
    return "other"


def classify_path(
    path: str,
    category_hint: str | None = None,
    duration_sec: float | None = None,
) -> tuple[str, str, str]:
    """Return (kind, library, library_sub).

    kind: music | sample | audio — stored in files.kind
    library: music | samples | loops | other
    library_sub: subfolder category for samples, or artist/album hint for music
    """
    path_norm = _norm(path)
    ext = Path(path).suffix.lower()

    is_loop = _has_keyword(path_norm, LOOP_PATH_KEYWORDS)
    is_sample_path = _has_keyword(path_norm, SAMPLE_PATH_KEYWORDS)
    is_music_path = _has_keyword(path_norm, MUSIC_PATH_KEYWORDS)
    in_production = any(h in path_norm for h in PRODUCTION_ROOT_HINTS)

    # Duration overrides (when analyzed)
    if duration_sec is not None:
        if duration_sec >= 150 and not in_production and not is_sample_path:
            artist = _music_sub_from_path(path)
            return "music", LIBRARY_MUSIC, artist
        if duration_sec <= 25 and (is_sample_path or in_production or is_loop):
            sub = detect_sample_sub(path, category_hint)
            lib = LIBRARY_LOOPS if is_loop or sub == "loops" else LIBRARY_SAMPLES
            return "sample", lib, sub

    if is_loop:
        sub = detect_sample_sub(path, category_hint)
        return "sample", LIBRARY_LOOPS, sub if sub != "other" else "loops"

    if is_sample_path or in_production:
        sub = detect_sample_sub(path, category_hint)
        return "sample", LIBRARY_SAMPLES, sub

    if is_music_path:
        return "music", LIBRARY_MUSIC, _music_sub_from_path(path)

    # Long-form consumer formats outside production trees → music
    if ext in {".mp3", ".m4a", ".aac", ".wma", ".flac", ".ogg"} and not in_production:
        if duration_sec is None or duration_sec >= 60:
            return "music", LIBRARY_MUSIC, _music_sub_from_path(path)

    # Short wav/aiff in unknown location → sample
    if ext in {".wav", ".aiff", ".aif"} and duration_sec is not None and duration_sec < 30:
        sub = detect_sample_sub(path, category_hint)
        return "sample", LIBRARY_SAMPLES, sub

    sub = detect_sample_sub(path, category_hint)
    if category_hint and category_hint != SoundCategory.UNKNOWN.value:
        return "sample", LIBRARY_SAMPLES, sub

    return "audio", LIBRARY_OTHER, "other"


def _music_sub_from_path(path: str) -> str:
    """Artist or album folder name for grouping music."""
    parts = Path(path).parts
    if len(parts) < 2:
        return "other"
    # Heuristic: parent of file is often album or artist
    parent = parts[-2]
    if parent.lower() in {"music", "songs", "downloads", "mp3", "flac", "albums"}:
        if len(parts) >= 3:
            return parts[-3]
        return "other"
    return parent
