"""Configuration for the SoundBrain studio engine.

Everything the engine needs to know about *where* to look and *what* the files
it finds mean lives here: scan roots, file-kind extensions, and the registry of
DAWs / instruments / effects that we recognise by extension or by folder name.

Config resolution order (later wins):

1. built-in defaults (platform aware)
2. ``~/.soundbrain/config.json`` (or ``$SOUNDBRAIN_HOME/config.json``)
3. a config file passed explicitly on the command line
4. ``SOUNDBRAIN_ROOTS`` / ``SOUNDBRAIN_HOME`` environment variables
"""

from __future__ import annotations

import json
import os
import string
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Iterable

# ---------------------------------------------------------------------------
# file kinds
# ---------------------------------------------------------------------------

AUDIO_EXTENSIONS = {
    ".wav",
    ".wave",
    ".aif",
    ".aiff",
    ".aifc",
    ".flac",
    ".ogg",
    ".oga",
    ".opus",
    ".mp3",
    ".m4a",
    ".aac",
    ".wv",
    ".rex",
    ".rx2",
    ".w64",
}

MIDI_EXTENSIONS = {".mid", ".midi"}

#: project file extension -> DAW name
PROJECT_EXTENSIONS = {
    ".cpr": "Cubase",
    ".bak": "Cubase",
    ".npr": "Nuendo",
    ".als": "Ableton Live",
    ".alp": "Ableton Live",
    ".song": "Studio One",
    ".songprj": "Studio One",
    ".flp": "FL Studio",
    ".rpp": "Reaper",
    ".ptx": "Pro Tools",
    ".logicx": "Logic Pro",
    ".mmp": "LMMS",
    ".bwproject": "Bitwig",
}

#: preset extension -> instrument / effect name
PRESET_EXTENSIONS = {
    ".fxp": "VST2 preset",
    ".fxb": "VST2 bank",
    ".vstpreset": "Steinberg preset",
    ".nki": "Kontakt",
    ".nkm": "Kontakt",
    ".nkc": "Kontakt",
    ".nkx": "Kontakt",
    ".nkr": "Kontakt",
    ".nicnt": "Kontakt",
    ".nbkt": "Battery",
    ".nmsv": "Massive",
    ".ncw": "Native Instruments",
    ".prt_omn": "Omnisphere",
    ".mlt_omn": "Omnisphere",
    ".db_omn": "Omnisphere",
    ".prt_kyb": "Keyscape",
    ".prt_tri": "Trilian",
    ".vital": "Vital",
    ".vitalbank": "Vital",
    ".vitalskin": "Vital",
    ".sylenth1preset": "Sylenth1",
    ".sbf": "Spire",
    ".spf": "Spire",
    ".h2p": "u-he",
    ".uhe-preset": "u-he",
    ".pgtx": "Pigments",
    ".pgtlib": "Pigments",
    ".nxp": "Nexus",
    ".nxs": "Nexus",
    ".kick2": "Kick 2",
    ".kick3": "Kick 3",
    ".gak": "Groove Agent",
    ".serumpreset": "Serum",
    ".ffp": "FabFilter",
    ".aupreset": "AudioUnit preset",
    ".tfx": "Effect preset",
    ".xps": "Sylenth1",
}

PLUGIN_BINARY_EXTENSIONS = {".vst3", ".dll", ".component", ".vst", ".clap", ".aaxplugin"}

ARCHIVE_EXTENSIONS = {".zip", ".rar", ".7z", ".iso", ".dmg"}


# ---------------------------------------------------------------------------
# instrument / effect registry
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ToolSpec:
    """A DAW, instrument or effect we know how to recognise."""

    name: str
    kind: str  # "daw" | "instrument" | "drum" | "effect" | "sampler"
    #: lower-case substrings that identify the tool inside a path or a binary blob
    signatures: tuple[str, ...] = ()
    #: preset extensions that belong exclusively to this tool
    extensions: tuple[str, ...] = ()
    vendor: str = ""


TOOLS: tuple[ToolSpec, ...] = (
    # --- DAWs -------------------------------------------------------------
    ToolSpec("Cubase", "daw", ("cubase", "steinberg/cubase"), (".cpr",), "Steinberg"),
    ToolSpec("Nuendo", "daw", ("nuendo",), (".npr",), "Steinberg"),
    ToolSpec("Ableton Live", "daw", ("ableton",), (".als",), "Ableton"),
    ToolSpec("Studio One", "daw", ("studio one", "studioone", "presonus"), (".song",), "PreSonus"),
    ToolSpec("FL Studio", "daw", ("fl studio", "image-line"), (".flp",), "Image-Line"),
    ToolSpec("Reaper", "daw", ("reaper",), (".rpp",), "Cockos"),
    ToolSpec("Logic Pro", "daw", ("logic pro", "logicx"), (".logicx",), "Apple"),
    # --- synths / samplers ------------------------------------------------
    ToolSpec("Serum", "instrument", ("serum",), (".serumpreset",), "Xfer"),
    ToolSpec("Serum 2", "instrument", ("serum2", "serum 2"), (), "Xfer"),
    ToolSpec("Sylenth1", "instrument", ("sylenth", "sylenth1"), (".sylenth1preset", ".xps"), "LennarDigital"),
    ToolSpec("Vital", "instrument", ("vital", "vitalaudio"), (".vital", ".vitalbank"), "Vital Audio"),
    ToolSpec("Spire", "instrument", ("spire",), (".sbf", ".spf"), "Reveal Sound"),
    ToolSpec("Nexus", "instrument", ("nexus", "refx"), (".nxp", ".nxs"), "reFX"),
    ToolSpec("Omnisphere", "instrument", ("omnisphere", "spectrasonics"), (".prt_omn", ".mlt_omn"), "Spectrasonics"),
    ToolSpec("Trilian", "instrument", ("trilian",), (".prt_tri",), "Spectrasonics"),
    ToolSpec("Keyscape", "instrument", ("keyscape",), (".prt_kyb",), "Spectrasonics"),
    ToolSpec("Kontakt", "sampler", ("kontakt", "native instruments/kontakt"), (".nki", ".nkm", ".nkx"), "Native Instruments"),
    ToolSpec("Massive", "instrument", ("massive",), (".nmsv",), "Native Instruments"),
    ToolSpec("Massive X", "instrument", ("massive x", "massivex"), (), "Native Instruments"),
    ToolSpec("Diva", "instrument", ("diva", "u-he diva"), (), "u-he"),
    ToolSpec("Hive", "instrument", ("hive",), (), "u-he"),
    ToolSpec("Zebra", "instrument", ("zebra",), (), "u-he"),
    ToolSpec("Pigments", "instrument", ("pigments", "arturia"), (".pgtx",), "Arturia"),
    ToolSpec("Sytrus", "instrument", ("sytrus",), (), "Image-Line"),
    ToolSpec("Phase Plant", "instrument", ("phase plant", "phaseplant"), (), "Kilohearts"),
    ToolSpec("Avenger", "instrument", ("avenger", "vengeance"), (), "Vengeance"),
    ToolSpec("Halion", "instrument", ("halion",), (), "Steinberg"),
    ToolSpec("Retrologue", "instrument", ("retrologue",), (), "Steinberg"),
    ToolSpec("Padshop", "instrument", ("padshop",), (), "Steinberg"),
    # --- drums ------------------------------------------------------------
    ToolSpec("Kick 3", "drum", ("kick 3", "kick3", "sonic academy kick"), (".kick3",), "Sonic Academy"),
    ToolSpec("Kick 2", "drum", ("kick 2", "kick2"), (".kick2",), "Sonic Academy"),
    ToolSpec("Battery", "drum", ("battery 4", "battery4", "battery"), (".nbkt",), "Native Instruments"),
    ToolSpec("Groove Agent", "drum", ("groove agent", "grooveagent"), (".gak",), "Steinberg"),
    ToolSpec("Addictive Drums", "drum", ("addictive drums",), (), "XLN"),
    # --- effects ----------------------------------------------------------
    ToolSpec("Pro-Q 3", "effect", ("pro-q 3", "pro-q3", "proq3", "fabfilter pro-q"), (), "FabFilter"),
    ToolSpec("Pro-Q 4", "effect", ("pro-q 4", "pro-q4", "proq4"), (), "FabFilter"),
    ToolSpec("Pro-C 2", "effect", ("pro-c 2", "pro-c2", "proc2"), (), "FabFilter"),
    ToolSpec("Pro-L 2", "effect", ("pro-l 2", "pro-l2", "prol2"), (), "FabFilter"),
    ToolSpec("Pro-MB", "effect", ("pro-mb", "promb"), (), "FabFilter"),
    ToolSpec("Saturn", "effect", ("saturn",), (), "FabFilter"),
    ToolSpec("Soothe", "effect", ("soothe", "soothe2"), (), "oeksound"),
    ToolSpec("Spiff", "effect", ("spiff",), (), "oeksound"),
    ToolSpec("Ozone", "effect", ("ozone",), (), "iZotope"),
    ToolSpec("Neutron", "effect", ("neutron",), (), "iZotope"),
    ToolSpec("Trash", "effect", ("trash",), (), "iZotope"),
    ToolSpec("Serial Clipper", "effect", ("serial clipper", "serialclipper"), (), "Kilohearts"),
    ToolSpec("StandardCLIP", "effect", ("standardclip",), (), "Sonic Academy"),
    ToolSpec("GClip", "effect", ("gclip",), (), "GVST"),
    ToolSpec("Limiter", "effect", ("limiter no6", "limiterno6", "l2 ultramaximizer"), (), ""),
    ToolSpec("OTT", "effect", ("ott",), (), "Xfer"),
    ToolSpec("Valhalla", "effect", ("valhalla",), (), "Valhalla DSP"),
    ToolSpec("Shaperbox", "effect", ("shaperbox", "cableguys"), (), "Cableguys"),
    ToolSpec("Trackspacer", "effect", ("trackspacer",), (), "Wavesfactory"),
    ToolSpec("Gullfoss", "effect", ("gullfoss",), (), "Soundtheory"),
    ToolSpec("Kickstart", "effect", ("kickstart",), (), "Nicky Romero"),
    ToolSpec("Sausage Fattener", "effect", ("sausage fattener",), (), "Dada Life"),
    ToolSpec("Decapitator", "effect", ("decapitator",), (), "Soundtoys"),
    ToolSpec("Echoboy", "effect", ("echoboy",), (), "Soundtoys"),
)

TOOLS_BY_NAME = {tool.name.lower(): tool for tool in TOOLS}

#: preset extension -> tool name, derived from the registry above
PRESET_EXT_TO_TOOL = {ext: tool.name for tool in TOOLS for ext in tool.extensions if ext in PRESET_EXTENSIONS}

#: the instruments the user explicitly asked to be covered by stage 1
REQUIRED_COVERAGE = (
    "Cubase",
    "Ableton Live",
    "Studio One",
    "Kontakt",
    "Omnisphere",
    "Serum",
    "Sylenth1",
    "Vital",
    "Nexus",
    "Spire",
    "Diva",
    "Pigments",
    "Massive",
    "Kick 3",
    "Battery",
    "Groove Agent",
)


# ---------------------------------------------------------------------------
# directory skip rules
# ---------------------------------------------------------------------------

DEFAULT_SKIP_DIRS = (
    "$recycle.bin",
    "system volume information",
    "windows",
    "winsxs",
    "appdata/local/temp",
    "appdata/locallow",
    "programdata/package cache",
    "node_modules",
    ".git",
    ".svn",
    "__pycache__",
    ".venv",
    "site-packages",
    "onedrivetemp",
    "recycler",
    "msocache",
    "perflogs",
)

DEFAULT_SKIP_NAMES = (
    "$recycle.bin",
    "system volume information",
    "node_modules",
    "__pycache__",
    ".git",
    "perflogs",
    "msocache",
)


# ---------------------------------------------------------------------------
# config object
# ---------------------------------------------------------------------------


def _default_windows_roots() -> list[str]:
    roots: list[str] = []
    user = os.environ.get("USERNAME") or os.environ.get("USER") or "shibass"
    for letter in ("H", "D", "F", "E", "G"):
        drive = f"{letter}:\\"
        if Path(drive).exists():
            roots.append(drive)
    profile = os.environ.get("USERPROFILE") or f"C:\\Users\\{user}"
    roots.append(profile)
    if not roots:
        roots = [f"{d}:\\" for d in string.ascii_uppercase[7:12]]
    return roots


def default_roots() -> list[str]:
    """Best guess of the drives / folders worth scanning on this machine."""
    if sys.platform.startswith("win"):
        return _default_windows_roots()
    # On macOS / Linux the Windows drives are usually mounted somewhere; look
    # for the common mount points before falling back to the home directory.
    candidates = [
        "/Volumes",
        "/mnt/h",
        "/mnt/d",
        "/mnt/f",
        "/media",
    ]
    roots = [c for c in candidates if Path(c).is_dir()]
    roots.append(str(Path.home()))
    return roots


@dataclass
class Config:
    """Runtime configuration."""

    roots: list[str] = field(default_factory=default_roots)
    home: str = ""
    #: skip files larger than this when analysing audio (MB)
    max_audio_mb: float = 300.0
    #: maximum number of seconds of audio to analyse per file
    analysis_seconds: float = 30.0
    #: analysis sample rate; every file is resampled to this
    analysis_sample_rate: int = 44100
    skip_dirs: list[str] = field(default_factory=lambda: list(DEFAULT_SKIP_DIRS))
    skip_names: list[str] = field(default_factory=lambda: list(DEFAULT_SKIP_NAMES))
    follow_symlinks: bool = False
    max_depth: int = 24
    #: local LLM endpoint used by ``soundbrain search`` when available
    llm_url: str = "http://127.0.0.1:4010/v1/chat/completions"
    llm_model: str = "local"
    llm_timeout: float = 25.0
    #: bridge HTTP server
    server_host: str = "127.0.0.1"
    server_port: int = 8770

    def __post_init__(self) -> None:
        if not self.home:
            self.home = os.environ.get("SOUNDBRAIN_HOME") or str(Path.home() / ".soundbrain")

    # -- paths -----------------------------------------------------------
    @property
    def home_path(self) -> Path:
        return Path(self.home).expanduser()

    @property
    def db_path(self) -> Path:
        return self.home_path / "soundbrain.db"

    @property
    def reports_path(self) -> Path:
        return self.home_path / "reports"

    def ensure_dirs(self) -> None:
        self.home_path.mkdir(parents=True, exist_ok=True)
        self.reports_path.mkdir(parents=True, exist_ok=True)

    # -- serialisation ---------------------------------------------------
    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def save(self, path: str | os.PathLike[str] | None = None) -> Path:
        target = Path(path) if path else self.home_path / "config.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(self.to_dict(), indent=2), encoding="utf-8")
        return target


def load_config(path: str | os.PathLike[str] | None = None, roots: Iterable[str] | None = None) -> Config:
    """Load config from disk / environment, with optional root override."""
    data: dict[str, Any] = {}
    home = os.environ.get("SOUNDBRAIN_HOME")
    candidates: list[Path] = []
    if path:
        candidates.append(Path(path))
    if home:
        candidates.append(Path(home) / "config.json")
    candidates.append(Path.home() / ".soundbrain" / "config.json")
    for candidate in candidates:
        if candidate.is_file():
            try:
                loaded = json.loads(candidate.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(loaded, dict):
                data.update(loaded)
                break

    known = {f for f in Config.__dataclass_fields__}  # type: ignore[attr-defined]
    data = {k: v for k, v in data.items() if k in known}
    cfg = Config(**data)

    env_roots = os.environ.get("SOUNDBRAIN_ROOTS")
    if env_roots:
        cfg.roots = [r for r in (part.strip() for part in env_roots.split(os.pathsep)) if r]
    if roots:
        cfg.roots = [str(r) for r in roots]
    if home:
        cfg.home = home
    return cfg
