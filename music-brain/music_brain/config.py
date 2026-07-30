"""Default scan roots, plugin names, and file-type maps."""

from __future__ import annotations

import os
from pathlib import Path

# ---------------------------------------------------------------------------
# Multi-drive roots (Stage 1) — Windows defaults; overridable via env.
# ---------------------------------------------------------------------------

DEFAULT_WIN_ROOTS: list[str] = [
    "H:\\",
    "D:\\",
    "F:\\",
    "C:\\Users\\shibass",
]

# POSIX / cloud fallback when those drive letters don't exist.
DEFAULT_POSIX_ROOTS: list[str] = [
    "./music-brain-root",
]

DAW_NAMES = ("Cubase", "Ableton", "Studio One", "Bitwig", "FL Studio", "Reaper")

SYNTH_PLUGINS = (
    "Serum",
    "Sylenth",
    "Sylenth1",
    "Vital",
    "Nexus",
    "Spire",
    "Diva",
    "Pigments",
    "Massive",
    "Massive X",
    "Omnisphere",
    "Kontakt",
    "Kick 3",
    "Kick3",
    "Battery",
    "Groove Agent",
    "Phase Plant",
    "SerumFX",
)

SAMPLE_EXTENSIONS = {
    ".wav",
    ".aiff",
    ".aif",
    ".flac",
    ".mp3",
    ".ogg",
    ".rex",
    ".rx2",
}

PRESET_EXTENSIONS = {
    ".fxp",
    ".fxb",
    ".vstpreset",
    ".aupreset",
    ".nmsv",  # Nexus
    ".vital",
    ".serum",
    ".h2p",  # Spire / u-he
    ".divapreset",
    ".nki",  # Kontakt
    ".nkm",
    ".nks",
    ".oms",  # Omnisphere
    ".prt",
    ".preset",
}

PROJECT_EXTENSIONS = {
    ".cpr",  # Cubase
    ".npr",  # Cubase Nuendo
    ".als",  # Ableton
    ".alp",  # Ableton pack
    ".song",  # Studio One
    ".bwproject",  # Bitwig
    ".flp",  # FL
    ".rpp",  # Reaper
}

# Folder name hints used when classifying sample roles from path/filename.
# Keep style adjectives (fullon/rolling/goa) OUT of role detection — those belong
# to style classifiers. Order matters: kick/snare before generic "bass".
ROLE_HINTS: dict[str, tuple[str, ...]] = {
    "kick": ("kick", "bd", "bassdrum", "kickdrum"),
    "snare": ("snare", "sd", "clap"),
    "hat": ("hat", "hihat", "hh", "cymbal", "ride"),
    "perc": ("perc", "percussion", "tom", "conga", "shaker"),
    "vocal": ("vocal", "vox", "voice", "acapella", "choir", "speech"),
    "lead": ("lead", "melody", "solo", "pluck", "arp"),
    "pad": ("pad", "atmosphere", "atmos", "drone", "string"),
    "fx": ("fx", "sfx", "riser", "impact", "sweep", "noise", "whoosh", "downlifter", "uplifter"),
    "bass": ("bass", "bas", "sub", "reese", "wobble"),
}

# Psytrance / Full-On bass style vocabulary (Stage 2).
BASS_STYLES = (
    "Rolling Bass",
    "Offbeat Bass",
    "FullOn Bass",
    "Progressive Bass",
    "Dark Bass",
    "Goa Bass",
    "Reese Bass",
    "Sub Bass",
    "Acid Bass",
    "Unknown Bass",
)

LEAD_STYLES = (
    "Supersaw Lead",
    "Pluck Lead",
    "Acid Lead",
    "Hoover Lead",
    "Trance Lead",
    "Psy Lead",
    "Unknown Lead",
)

KICK_STYLES = (
    "FullOn Kick",
    "Progressive Kick",
    "Dark Kick",
    "Techno Kick",
    "Soft Kick",
    "Unknown Kick",
)

PAD_STYLES = ("Warm Pad", "Dark Pad", "Bright Pad", "Evolving Pad", "Unknown Pad")
FX_STYLES = ("Riser", "Impact", "Sweep", "Atmosphere FX", "Glitch", "Unknown FX")
VOCAL_STYLES = ("Psy Vocal", "Chopped Vocal", "Pad Vocal", "Spoken", "Unknown Vocal")

# Artist → style reference for NL search (Stage 9) — seed knowledge.
ARTIST_STYLE_MAP: dict[str, dict[str, str]] = {
    "astrix": {"bass": "FullOn Bass", "lead": "Psy Lead", "genre": "Full On"},
    "ranji": {"lead": "Supersaw Lead", "bass": "FullOn Bass", "genre": "Full On"},
    "vini vici": {"bass": "FullOn Bass", "kick": "FullOn Kick", "genre": "Full On"},
    "infected mushroom": {"bass": "Rolling Bass", "lead": "Psy Lead", "genre": "Psytrance"},
    "ajja": {"bass": "FullOn Bass", "lead": "Acid Lead", "genre": "Full On"},
    "ace ventura": {"bass": "Progressive Bass", "kick": "Progressive Kick", "genre": "Progressive Psy"},
    "liquid soul": {"bass": "Progressive Bass", "lead": "Trance Lead", "genre": "Progressive Psy"},
    "skazi": {"bass": "FullOn Bass", "lead": "Psy Lead", "genre": "Full On"},
}

SKIP_DIR_NAMES = {
    "$recycle.bin",
    "system volume information",
    ".git",
    "__pycache__",
    "node_modules",
    ".trash",
    "cache",
    "caches",
}


def resolve_roots(explicit: list[str] | None = None) -> list[Path]:
    """Return existing scan roots from env, CLI, or platform defaults."""
    if explicit:
        candidates = explicit
    else:
        env = os.environ.get("MUSIC_BRAIN_ROOTS", "").strip()
        if env:
            candidates = [p.strip() for p in env.split(os.pathsep) if p.strip()]
        elif os.name == "nt":
            candidates = list(DEFAULT_WIN_ROOTS)
        else:
            candidates = list(DEFAULT_POSIX_ROOTS)

    roots: list[Path] = []
    for raw in candidates:
        p = Path(raw).expanduser()
        if p.exists() and p.is_dir():
            roots.append(p.resolve())
    return roots


def default_db_path() -> Path:
    env = os.environ.get("MUSIC_BRAIN_DB")
    if env:
        return Path(env).expanduser()
    home = Path.home()
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", home / "AppData" / "Local"))
        return base / "MusicBrain" / "knowledge.db"
    return home / ".music-brain" / "knowledge.db"
