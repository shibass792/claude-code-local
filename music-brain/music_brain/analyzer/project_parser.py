"""Step 8 — parse DAW projects and build Project DNA."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from music_brain.models.types import ProjectDNA

# Known plugins for chain detection from project XML/text
KNOWN_PLUGINS = [
    "Serum", "Sylenth", "Vital", "Nexus", "Spire", "Diva", "Pigments", "Massive",
    "Omnisphere", "Kontakt", "Kick 3", "Battery", "Groove Agent",
    "Pro-Q 3", "Pro-Q3", "FabFilter Pro-Q", "Saturn", "Soothe", "Clipper",
    "Limiter", "Valhalla", "RC-20", "OTT", "CamelCrusher",
]

# Common effect chain order patterns (Step 6)
TYPICAL_CHAINS: list[list[str]] = [
    ["Serum", "Pro-Q 3", "Saturn", "Soothe", "Clipper", "Limiter"],
    ["Sylenth", "Pro-Q 3", "Saturn", "Limiter"],
    ["Vital", "OTT", "Pro-Q 3", "Limiter"],
]


def _extract_plugins_from_text(text: str) -> list[str]:
    found: list[str] = []
    text_lower = text.lower()
    for plugin in KNOWN_PLUGINS:
        if plugin.lower() in text_lower:
            found.append(plugin)
    return list(dict.fromkeys(found))


def _extract_presets_from_text(text: str) -> list[str]:
    # .vstpreset names, Serum .fxp, etc.
    patterns = [
        r"[\w\-]+\.vstpreset",
        r"[\w\-]+\.fxp",
        r"[\w\-]+\.nmsv",
        r"[\w\-]+\.vital",
    ]
    presets: list[str] = []
    for pat in patterns:
        presets.extend(re.findall(pat, text, re.IGNORECASE))
    return list(dict.fromkeys(presets))[:100]


def _parse_cubase_cpr(path: Path) -> ProjectDNA:
    dna = ProjectDNA(project_path=str(path), genre="psytrance")
    try:
        raw = path.read_bytes()
        # CPR can be XML or binary with embedded XML
        text = raw.decode("utf-8", errors="ignore")
        if not text.strip().startswith("<"):
            # Try to find XML chunk in binary
            match = re.search(rb"<\?xml.*", raw, re.DOTALL)
            if match:
                text = match.group(0).decode("utf-8", errors="ignore")
    except OSError:
        return dna

    dna.plugin_list = _extract_plugins_from_text(text)
    dna.preset_list = _extract_presets_from_text(text)

    # BPM from Cubase XML attributes
    bpm_match = re.search(r'tempo[^>]*value="([0-9.]+)"', text, re.IGNORECASE)
    if not bpm_match:
        bpm_match = re.search(r"<Tempo[^>]*>([0-9.]+)</Tempo>", text, re.IGNORECASE)
    if bpm_match:
        dna.bpm = float(bpm_match.group(1))

    # Key hints in track names
    key_match = re.search(
        r"\b([A-G][#b]?)\s*(major|minor|maj|min)?\b", text, re.IGNORECASE
    )
    if key_match:
        dna.key = key_match.group(1)

    for plugin in dna.plugin_list:
        if plugin.lower() in ("serum", "sylenth", "vital", "diva", "spire"):
            if "Serum" in plugin or plugin == "Serum":
                dna.bass_type = dna.bass_type or "serum_bass"
            break

    # Infer chains from plugin order in file
    dna.plugin_chains = _infer_chains_from_plugins(dna.plugin_list)
    return dna


def _parse_ableton_als(path: Path) -> ProjectDNA:
    dna = ProjectDNA(project_path=str(path))
    try:
        with zipfile.ZipFile(path, "r") as zf:
            names = [n for n in zf.namelist() if n.endswith(".xml")]
            text_parts: list[str] = []
            for name in names[:20]:
                try:
                    text_parts.append(zf.read(name).decode("utf-8", errors="ignore"))
                except KeyError:
                    continue
            text = "\n".join(text_parts)
    except (zipfile.BadZipFile, OSError):
        text = path.read_text(encoding="utf-8", errors="ignore")

    dna.plugin_list = _extract_plugins_from_text(text)
    dna.preset_list = _extract_presets_from_text(text)
    tempo_match = re.search(r"<Tempo[^>]*>.*?<Manual Value=\"([0-9.]+)\"", text, re.DOTALL)
    if tempo_match:
        dna.bpm = float(tempo_match.group(1))
    dna.plugin_chains = _infer_chains_from_plugins(dna.plugin_list)
    return dna


def _parse_studio_one_song(path: Path) -> ProjectDNA:
    dna = ProjectDNA(project_path=str(path))
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return dna
    dna.plugin_list = _extract_plugins_from_text(text)
    bpm_match = re.search(r"tempo=\"([0-9.]+)\"", text, re.IGNORECASE)
    if bpm_match:
        dna.bpm = float(bpm_match.group(1))
    dna.plugin_chains = _infer_chains_from_plugins(dna.plugin_list)
    return dna


def _infer_chains_from_plugins(plugins: list[str]) -> list[list[str]]:
    """Match known chain templates against plugins found in project."""
    plugin_set = {p.lower() for p in plugins}
    chains: list[list[str]] = []
    for template in TYPICAL_CHAINS:
        matched = [p for p in template if p.lower() in plugin_set or any(
            p.lower() in pl.lower() for pl in plugins
        )]
        if len(matched) >= 2:
            chains.append(matched)
    return chains


class ProjectParser:
    def parse(self, path: str) -> ProjectDNA:
        p = Path(path)
        ext = p.suffix.lower()
        if ext == ".cpr":
            return _parse_cubase_cpr(p)
        if ext == ".als":
            return _parse_ableton_als(p)
        if ext == ".song":
            return _parse_studio_one_song(p)
        return ProjectDNA(project_path=str(p))
