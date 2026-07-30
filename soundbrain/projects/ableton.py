"""Ableton Live ``.als`` reader — gzipped XML, so this one is exact."""

from __future__ import annotations

import gzip
import xml.etree.ElementTree as ET
from pathlib import Path

from . import ParsedProject, Track, canonical_tool, normalise_names

TRACK_TAGS = ("MidiTrack", "AudioTrack", "GroupTrack", "ReturnTrack")
DEVICE_NAME_PATHS = (
    "PluginDesc/VstPluginInfo/PlugName",
    "PluginDesc/Vst3PluginInfo/Name",
    "PluginDesc/AuPluginInfo/Name",
)


def _read_xml(path: Path) -> ET.Element | None:
    try:
        with gzip.open(path, "rb") as handle:
            return ET.fromstring(handle.read())
    except (OSError, gzip.BadGzipFile, ET.ParseError):
        try:
            return ET.fromstring(path.read_bytes())
        except (OSError, ET.ParseError):
            return None


def _device_name(device: ET.Element) -> str:
    for rel in DEVICE_NAME_PATHS:
        node = device.find(rel)
        if node is not None:
            value = node.get("Value") or (node.text or "")
            if value:
                return value.strip()
    user_name = device.find("UserName")
    if user_name is not None and (user_name.get("Value") or "").strip():
        return str(user_name.get("Value")).strip()
    return device.tag


def _track_name(track: ET.Element) -> str:
    node = track.find("Name/EffectiveName")
    if node is not None and node.get("Value"):
        return str(node.get("Value"))
    node = track.find("Name/UserName")
    if node is not None and node.get("Value"):
        return str(node.get("Value"))
    return ""


def _sample_paths(root: ET.Element) -> list[str]:
    out: list[str] = []
    for ref in root.iter("FileRef"):
        path_node = ref.find("Path")
        if path_node is not None and path_node.get("Value"):
            out.append(str(path_node.get("Value")))
            continue
        name_node = ref.find("Name")
        rel = ref.find("RelativePath")
        parts = []
        if rel is not None:
            for element in rel.iter("RelativePathElement"):
                if element.get("Dir"):
                    parts.append(str(element.get("Dir")))
        if name_node is not None and name_node.get("Value"):
            parts.append(str(name_node.get("Value")))
        if parts:
            out.append("/".join(parts))
    return out


def parse(path: str | Path) -> ParsedProject:
    target = Path(path)
    project = ParsedProject(path=str(target), name=target.stem, daw="Ableton Live")
    root = _read_xml(target)
    if root is None:
        project.notes.append("could not decompress or parse the .als XML")
        return project

    tempo = root.find(".//MasterTrack//Tempo/Manual")
    if tempo is not None and tempo.get("Value"):
        try:
            project.bpm = float(str(tempo.get("Value")))
        except ValueError:
            pass

    ordered_plugins: list[str] = []
    for track in root.iter():
        if track.tag not in TRACK_TAGS:
            continue
        devices = track.find("DeviceChain/DeviceChain/Devices")
        if devices is None:
            devices = track.find(".//Devices")
        names = [_device_name(device) for device in list(devices)] if devices is not None else []
        cleaned = normalise_names(names)
        instrument = ""
        effects: list[str] = []
        for name in cleaned:
            known = canonical_tool(name)
            kind = known[1] if known else ""
            if not instrument and (kind in ("instrument", "sampler", "drum") or name.lower() in ("simpler", "sampler", "operator", "drumrack", "drum rack", "wavetable")):
                instrument = name
            else:
                effects.append(name)
        ordered_plugins.extend(cleaned)
        project.tracks.append(Track(name=_track_name(track), instrument=instrument, plugins=effects))

    project.plugins = normalise_names(ordered_plugins)
    project.instruments = [t.instrument for t in project.tracks if t.instrument]
    project.samples = sorted({p.replace("\\", "/") for p in _sample_paths(root)})
    return project
