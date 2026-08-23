"""Project DNA extraction (Stage 8) — BPM, Key, Mood, Genre, styles, plugin lists."""

from __future__ import annotations

import re
import zipfile
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from music_brain.config import ARTIST_STYLE_MAP, SYNTH_PLUGINS
from music_brain.analyzer.styles import classify_style

# Common FX plugins we track in chains (Stage 6)
FX_PLUGIN_HINTS = (
    "Pro-Q",
    "Pro Q",
    "FabFilter",
    "Saturn",
    "Soothe",
    "Clipper",
    "Limiter",
    "L2",
    "L3",
    "Ott",
    "OTT",
    "Valhalla",
    "EchoBoy",
    "Timeless",
    "VolumeShaper",
    "Kickstart",
    "ShaperBox",
    "Trash",
    "Decapitator",
    "SSL",
    "Compressor",
    "Gate",
    "Reverb",
    "Delay",
    "Chorus",
    "Phaser",
    "iZotope",
    "Ozone",
    "Neutron",
)


def extract_project_dna(path: str | Path) -> dict[str, Any]:
    path = Path(path)
    text_blob = _read_project_text(path)
    plugins = _find_names(text_blob, SYNTH_PLUGINS) + _find_names(text_blob, FX_PLUGIN_HINTS)
    plugins = _dedupe_keep_order(plugins)

    presets = _find_presets(text_blob)
    samples = _find_samples(text_blob)

    bpm = _find_bpm(text_blob, path)
    key = _find_key(text_blob, path)

    # Style guesses from path + embedded names
    bass_style, _ = classify_style(str(path) + " " + " ".join(presets), "bass")
    lead_style, _ = classify_style(str(path) + " " + " ".join(presets), "lead")
    kick_type, _ = classify_style(str(path) + " " + " ".join(samples), "kick")
    fx_style, _ = classify_style(str(path), "fx")

    genre, mood = _guess_genre_mood(str(path), text_blob, bpm)

    # Rough mix descriptors from plugin density
    energy = _energy_score(bpm, plugins)
    mix_density = min(1.0, len(plugins) / 20.0)
    stereo_width = 0.5 + (0.1 if any("saturn" in p.lower() or "width" in p.lower() for p in plugins) else 0)
    compression = 0.4 + (0.2 if any("ott" in p.lower() or "compress" in p.lower() for p in plugins) else 0)

    dna = {
        "bpm": bpm,
        "key": key,
        "mood": mood,
        "genre": genre,
        "bass_style": bass_style,
        "lead_style": lead_style,
        "fx_style": fx_style,
        "kick_type": kick_type,
        "bass_type": bass_style,
        "energy": round(energy, 3),
        "mix_density": round(mix_density, 3),
        "stereo_width": round(stereo_width, 3),
        "compression": round(compression, 3),
        "preset_list": presets[:100],
        "plugin_list": plugins[:100],
        "sample_list": samples[:100],
        "fx_chains": extract_fx_chains(text_blob, plugins),
    }
    return dna


def extract_fx_chains(text: str, plugins: list[str] | None = None) -> list[dict[str, Any]]:
    """Heuristic: find synth → subsequent FX mentions as ordered chains."""
    plugins = plugins or []
    synths = [p for p in plugins if any(s.lower() in p.lower() for s in SYNTH_PLUGINS)]
    fx = [p for p in plugins if p not in synths]
    chains = []
    for synth in synths:
        # Prefer FabFilter-ish / common mastering order if present
        ordered = [synth]
        preferred = ["Pro-Q", "Pro Q", "Saturn", "Soothe", "OTT", "Ott", "Clipper", "Limiter", "L2"]
        for pref in preferred:
            for f in fx:
                if pref.lower() in f.lower() and f not in ordered:
                    ordered.append(f)
        for f in fx:
            if f not in ordered:
                ordered.append(f)
        if len(ordered) > 1:
            chains.append({"synth": synth, "chain": ordered})
    return chains


def _read_project_text(path: Path) -> str:
    """Best-effort text extraction from DAW project files."""
    chunks: list[str] = [path.name, str(path)]
    if not path.is_file():
        return " ".join(chunks)

    # Ableton .als is gzipped XML
    if path.suffix.lower() == ".als":
        try:
            import gzip

            with gzip.open(path, "rb") as f:
                raw = f.read(2_000_000)
            chunks.append(raw.decode("utf-8", errors="ignore"))
            return "\n".join(chunks)
        except Exception:
            pass

    # Studio One / some projects are zip containers
    if path.suffix.lower() in {".song", ".bwproject"} or zipfile.is_zipfile(path):
        try:
            with zipfile.ZipFile(path, "r") as zf:
                for name in zf.namelist()[:40]:
                    if name.lower().endswith((".xml", ".txt", ".json", ".device")):
                        try:
                            chunks.append(zf.read(name)[:500_000].decode("utf-8", errors="ignore"))
                        except Exception:
                            continue
            return "\n".join(chunks)
        except Exception:
            pass

    # Cubase .cpr and others — binary; pull printable strings
    try:
        data = path.read_bytes()[:3_000_000]
        # Extract ASCII runs length >= 4
        strings = re.findall(rb"[\x20-\x7e]{4,}", data)
        chunks.append(" ".join(s.decode("ascii", errors="ignore") for s in strings[:5000]))
    except Exception:
        pass
    return "\n".join(chunks)


def _find_names(text: str, names: tuple[str, ...] | list[str]) -> list[str]:
    found = []
    lower = text.lower()
    for name in sorted(names, key=len, reverse=True):
        if name.lower() in lower:
            found.append(name)
    return found


def _find_presets(text: str) -> list[str]:
    pats = [
        r"[\w\- ]+\.fxp",
        r"[\w\- ]+\.vstpreset",
        r"[\w\- ]+\.vital",
        r"[\w\- ]+\.h2p",
        r"Preset(?:Name)?[\s:=\"]+(\w[\w \-]{2,})",
    ]
    found: list[str] = []
    for p in pats:
        found.extend(re.findall(p, text, flags=re.IGNORECASE))
    return _dedupe_keep_order([f.strip() for f in found if f.strip()])[:100]


def _find_samples(text: str) -> list[str]:
    found = re.findall(r"[\w\- /\.]+\.(?:wav|aiff|aif|flac)", text, flags=re.IGNORECASE)
    return _dedupe_keep_order(found)[:100]


def _find_bpm(text: str, path: Path) -> float | None:
    patterns = [
        r"Tempo[^0-9]{0,10}(1[0-8][0-9](?:\.\d+)?)",
        r"BPM[^0-9]{0,10}(1[0-8][0-9](?:\.\d+)?)",
        r"(?<![0-9])(1[2-5][0-9])(?:\s*bpm)",
    ]
    for p in patterns:
        m = re.search(p, text, flags=re.IGNORECASE)
        if m:
            return float(m.group(1))
    m = re.search(r"(?<![0-9])(1[2-5][0-9])(?![0-9])", path.stem)
    if m:
        return float(m.group(1))
    return None


def _find_key(text: str, path: Path) -> str | None:
    m = re.search(
        r"(?:Key|Root)[^A-Ga-g]{0,8}([A-G](?:#|b)?\s?(?:m|min|minor|maj|major)?)",
        text,
    )
    if m:
        return _normalize_key(m.group(1))
    m = re.search(r"(?<![A-Za-z])([A-Ga-g])(#|b)?(m)?(?![A-Za-z])", path.stem)
    if m:
        return _normalize_key("".join(x for x in m.groups() if x))
    return None


def _normalize_key(raw: str) -> str:
    raw = raw.strip().replace(" ", "")
    m = re.match(r"([A-Ga-g])(#|b)?(m|min|minor|maj|major)?", raw)
    if not m:
        return raw
    note = m.group(1).upper()
    acc = m.group(2) or ""
    mode = (m.group(3) or "")
    if mode.lower() in ("m", "min", "minor"):
        return f"{note}{acc}m"
    return f"{note}{acc}"


def _guess_genre_mood(path: str, text: str, bpm: float | None) -> tuple[str, str]:
    blob = (path + " " + text).lower()
    for artist, meta in ARTIST_STYLE_MAP.items():
        if artist in blob:
            genre = meta.get("genre", "Psytrance")
            mood = "dark" if "dark" in blob else "energetic"
            return genre, mood
    if bpm:
        if bpm >= 142:
            return "Full On", "energetic"
        if bpm >= 136:
            return "Progressive Psy", "driving"
        if bpm >= 128:
            return "Techno", "hypnotic"
    if "goa" in blob:
        return "Goa", "psychedelic"
    if "dark" in blob:
        return "Dark Psy", "dark"
    return "Psytrance", "energetic"


def _energy_score(bpm: float | None, plugins: list[str]) -> float:
    base = 0.5
    if bpm:
        base = min(1.0, max(0.2, (bpm - 100) / 60.0))
    base += min(0.3, len(plugins) * 0.02)
    return min(1.0, base)


def _dedupe_keep_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for i in items:
        k = i.lower()
        if k not in seen:
            seen.add(k)
            out.append(i)
    return out
