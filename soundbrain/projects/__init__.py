"""Project file parsing: Cubase, Ableton Live, Studio One, Reaper.

The parsers are deliberately tolerant. A DAW project is a moving target and we
are only after four things: tempo, the instruments used, the effect chain per
track (stage 6), and the samples referenced (stage 8). Anything we cannot read
is skipped rather than raising.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from ..config import TOOLS

#: canonical tool name -> lower-case signatures, longest first
_TOOL_LOOKUP: list[tuple[str, str, str]] = sorted(
    ((sig, tool.name, tool.kind) for tool in TOOLS for sig in tool.signatures if len(sig) >= 3),
    key=lambda item: -len(item[0]),
)

_NOISE = re.compile(r"^[\W_]+$")

#: vendor names the DAWs like to append in brackets, e.g. "Pro-Q 3 (FabFilter)"
_VENDORS = {tool.vendor.lower() for tool in TOOLS if tool.vendor} | {
    "vendor",
    "waves",
    "plugin alliance",
    "eventide",
    "arturia",
    "toneboosters",
}
_VENDOR_WORDS = ("records", "audio", "dsp", "labs", "instruments", "software", "ltd", "inc", "gmbh", "sound")


@dataclass
class Track:
    name: str = ""
    instrument: str = ""
    plugins: list[str] = field(default_factory=list)
    presets: list[str] = field(default_factory=list)

    @property
    def chain(self) -> list[str]:
        chain = ([self.instrument] if self.instrument else []) + self.plugins
        # collapse repeats that come from serialisation noise
        collapsed: list[str] = []
        for item in chain:
            if not collapsed or collapsed[-1] != item:
                collapsed.append(item)
        return collapsed


@dataclass
class ParsedProject:
    path: str
    name: str
    daw: str = ""
    bpm: float | None = None
    musical_key: str | None = None
    tracks: list[Track] = field(default_factory=list)
    plugins: list[str] = field(default_factory=list)
    instruments: list[str] = field(default_factory=list)
    presets: list[str] = field(default_factory=list)
    samples: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def chains(self) -> list[tuple[str | None, list[str]]]:
        return [(track.name or None, track.chain) for track in self.tracks if len(track.chain) >= 2]

    def items(self) -> list[tuple[str, str, str | None, int]]:
        """Rows for ``project_items``: ``(kind, name, detail, position)``."""
        rows: list[tuple[str, str, str | None, int]] = []
        for position, name in enumerate(self.instruments):
            rows.append(("instrument", name, None, position))
        for position, name in enumerate(self.plugins):
            rows.append(("plugin", name, None, position))
        for position, name in enumerate(self.presets):
            rows.append(("preset", name, None, position))
        for position, name in enumerate(self.samples):
            rows.append(("sample", name, None, position))
        for position, track in enumerate(self.tracks):
            rows.append(("track", track.name or f"track {position + 1}", " > ".join(track.chain), position))
        return rows

    def as_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "name": self.name,
            "daw": self.daw,
            "bpm": self.bpm,
            "musical_key": self.musical_key,
            "tracks": [
                {"name": t.name, "instrument": t.instrument, "plugins": t.plugins, "chain": t.chain}
                for t in self.tracks
            ],
            "plugins": self.plugins,
            "instruments": self.instruments,
            "presets": self.presets,
            "samples": self.samples,
            "notes": self.notes,
        }


def canonical_tool(text: str) -> tuple[str, str] | None:
    """Map a raw plugin string to ``(canonical name, kind)`` if we know it."""
    if not text:
        return None
    lowered = text.lower()
    for signature, name, kind in _TOOL_LOOKUP:
        if signature in lowered:
            return name, kind
    return None


def clean_plugin_name(text: str) -> str:
    """Normalise a DAW-reported plugin string into something readable."""
    name = text.strip()
    name = re.sub(r"^(vst3?:?\s*|au:?\s*|clap:?\s*)", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\s*\((?:x86|x64|64-bit|32-bit|stereo|mono)\)\s*$", "", name, flags=re.IGNORECASE)
    trailing = re.search(r"\s*\(([^)]{2,40})\)\s*$", name)
    if trailing:
        inner = trailing.group(1).strip().lower()
        head = name[: trailing.start()].strip()
        is_vendor = (
            inner in _VENDORS
            or any(word in inner for word in _VENDOR_WORDS)
            or (inner and inner in head.lower())
        )
        if is_vendor:
            name = head
    name = re.sub(r"\.(dll|vst3|component|so)$", "", name, flags=re.IGNORECASE)
    return name.strip(" -_/\\")


def normalise_names(raw: Iterable[str], keep_unknown: bool = True) -> list[str]:
    """Canonicalise a stream of plugin strings, preserving order, de-duplicated."""
    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        cleaned = clean_plugin_name(item)
        if not cleaned or _NOISE.match(cleaned) or len(cleaned) < 2:
            continue
        known = canonical_tool(cleaned)
        name = known[0] if known else cleaned
        if not known and not keep_unknown:
            continue
        if name.lower() in seen:
            continue
        seen.add(name.lower())
        out.append(name)
    return out


def parse(path: str | Path) -> ParsedProject | None:
    """Parse any supported project file; ``None`` when the format is unknown."""
    target = Path(path)
    suffix = target.suffix.lower()
    from . import ableton, cubase, reaper, studio_one

    if suffix in (".cpr", ".npr", ".bak"):
        return cubase.parse(target)
    if suffix in (".als", ".alp"):
        return ableton.parse(target)
    if suffix in (".song", ".songprj"):
        return studio_one.parse(target)
    if suffix == ".rpp":
        return reaper.parse(target)
    return None
