"""Cubase / Nuendo ``.cpr`` reader.

``.cpr`` is an undocumented binary container, so this is a string-mining parser:
we pull the readable ASCII and UTF-16 strings out of the file, cut the stream at
Cubase's track class markers, and read the plugin names inside each segment in
the order they were serialised. That order is a good proxy for the insert order
of a track, which is what stage 6 needs to learn chains.

Everything is best effort and clearly reported: ``ParsedProject.notes`` records
which heuristics fired.
"""

from __future__ import annotations

import re
import struct
from pathlib import Path

from ..taxonomy import bpm_from_name, key_from_name
from . import ParsedProject, Track, canonical_tool, normalise_names

#: class names Cubase writes before each track's data
TRACK_MARKERS = (
    b"MInstrumentTrackEvent",
    b"MInstrumentTrack",
    b"MAudioTrackEvent",
    b"MAudioTrack",
    b"MMidiTrackEvent",
    b"MMidiTrack",
    b"MGroupTrackEvent",
    b"MGroupTrack",
    b"MFxTrackEvent",
    b"MFxTrack",
    b"MRackTrack",
)

PLUGIN_MARKERS = (b"PLuginUID", b"Plugin UID", b"PluginUID", b"VstPlugin", b"MInsertPluginNode", b"Vst3Plugin")

ASCII_STRING = re.compile(rb"[\x20-\x7e]{4,64}")
SAMPLE_PATH = re.compile(r"[A-Za-z]:[\\/][^\x00\"<>|*?]{3,200}\.(?:wav|aiff|aif|flac|mp3|ogg)", re.IGNORECASE)
TEMPO_TOKEN = re.compile(rb"MTempoTrackEvent|MTempoEvent")

MAX_BYTES = 96 * 1024 * 1024


def _ascii_strings(data: bytes) -> list[tuple[int, str]]:
    return [(m.start(), m.group().decode("ascii", "ignore")) for m in ASCII_STRING.finditer(data)]


def _utf16_strings(data: bytes, min_len: int = 4) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    start = None
    chars: list[str] = []
    for i in range(0, len(data) - 1, 2):
        lo, hi = data[i], data[i + 1]
        if hi == 0 and 0x20 <= lo <= 0x7E:
            if start is None:
                start = i
            chars.append(chr(lo))
        else:
            if start is not None and len(chars) >= min_len:
                out.append((start, "".join(chars)))
            start = None
            chars = []
    if start is not None and len(chars) >= min_len:
        out.append((start, "".join(chars)))
    return out


def _tempo_candidates(data: bytes) -> float | None:
    """Look for a plausible tempo double near Cubase's tempo-track marker."""
    for match in TEMPO_TOKEN.finditer(data):
        window = data[match.end() : match.end() + 512]
        for offset in range(0, max(len(window) - 8, 0)):
            try:
                value = struct.unpack_from("<d", window, offset)[0]
            except struct.error:
                break
            if 60.0 <= value <= 220.0 and abs(value - round(value, 3)) < 1e-6:
                return float(value)
    return None


def parse(path: str | Path) -> ParsedProject:
    target = Path(path)
    project = ParsedProject(path=str(target), name=target.stem, daw="Cubase" if target.suffix.lower() != ".npr" else "Nuendo")

    try:
        size = target.stat().st_size
        with target.open("rb") as handle:
            data = handle.read(min(size, MAX_BYTES))
        if size > MAX_BYTES:
            project.notes.append(f"only the first {MAX_BYTES // (1024*1024)} MB were scanned")
    except OSError as exc:
        project.notes.append(f"unreadable: {exc}")
        return project

    strings = sorted(_ascii_strings(data) + _utf16_strings(data), key=lambda item: item[0])

    # ---- tempo / key -----------------------------------------------------
    tempo = _tempo_candidates(data)
    if tempo:
        project.bpm = tempo
        project.notes.append("tempo read from the tempo-track record")
    else:
        hinted = bpm_from_name(target.name)
        if hinted:
            project.bpm = hinted
            project.notes.append("tempo taken from the project file name")
    key_hint = key_from_name(target.name)
    if key_hint:
        project.musical_key = key_hint
        project.notes.append("key taken from the project file name")

    # ---- track segmentation ---------------------------------------------
    boundaries: list[int] = []
    for marker in TRACK_MARKERS:
        boundaries.extend(m.start() for m in re.finditer(re.escape(marker), data))
    boundaries.sort()

    def segment_of(offset: int) -> int:
        lo, hi = 0, len(boundaries)
        while lo < hi:
            mid = (lo + hi) // 2
            if boundaries[mid] <= offset:
                lo = mid + 1
            else:
                hi = mid
        return lo - 1

    segments: dict[int, list[str]] = {}
    segment_names: dict[int, str] = {}
    all_tools: list[str] = []
    samples: list[str] = []

    for offset, text in strings:
        for candidate in SAMPLE_PATH.findall(text):
            samples.append(candidate)
        known = canonical_tool(text)
        if known:
            index = segment_of(offset)
            segments.setdefault(index, []).append(known[0])
            all_tools.append(known[0])
        elif 3 <= len(text) <= 40 and re.fullmatch(r"[A-Za-z0-9 _\-#&'\.]+", text):
            index = segment_of(offset)
            if index not in segment_names and _looks_like_track_name(text):
                segment_names[index] = text.strip()

    for index in sorted(segments):
        names = normalise_names(segments[index], keep_unknown=False)
        if not names:
            continue
        instrument = ""
        effects: list[str] = []
        for name in names:
            known = canonical_tool(name)
            kind = known[1] if known else ""
            if not instrument and kind in ("instrument", "sampler", "drum"):
                instrument = name
            elif kind == "daw":
                continue
            else:
                effects.append(name)
        project.tracks.append(Track(name=segment_names.get(index, ""), instrument=instrument, plugins=effects))

    project.plugins = [
        name for name in normalise_names(all_tools, keep_unknown=False) if (canonical_tool(name) or ("", ""))[1] not in ("daw",)
    ]
    project.instruments = [
        name for name in project.plugins if (canonical_tool(name) or ("", ""))[1] in ("instrument", "sampler", "drum")
    ]
    project.samples = sorted({s.replace("\\", "/") for s in samples})
    if not project.tracks and project.plugins:
        project.tracks.append(Track(name="(unsegmented)", plugins=project.plugins))
        project.notes.append("no track markers found; plugins reported as one chain")
    return project


def _looks_like_track_name(text: str) -> bool:
    lowered = text.strip().lower()
    if len(lowered) < 3:
        return False
    if lowered.startswith(("m", "p")) and lowered[1:2].isupper():
        return False
    blacklist = ("array", "object", "node", "event", "list", "root", "version", "steinberg", "class", "attribute")
    return not any(token in lowered for token in blacklist)
