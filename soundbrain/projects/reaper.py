"""Reaper ``.rpp`` reader — plain text, useful as a reference implementation."""

from __future__ import annotations

import re
from pathlib import Path

from . import ParsedProject, Track, canonical_tool, normalise_names

VST_LINE = re.compile(r'<VST\s+"([^"]+)"', re.IGNORECASE)
TEMPO_LINE = re.compile(r"^\s*TEMPO\s+([0-9.]+)", re.MULTILINE)
TRACK_NAME = re.compile(r'^\s*NAME\s+"?([^"\n]+)"?', re.MULTILINE)
FILE_LINE = re.compile(r'FILE\s+"([^"]+)"', re.IGNORECASE)


def parse(path: str | Path) -> ParsedProject:
    target = Path(path)
    project = ParsedProject(path=str(target), name=target.stem, daw="Reaper")
    try:
        text = target.read_text(encoding="utf-8", errors="ignore")
    except OSError as exc:
        project.notes.append(f"unreadable: {exc}")
        return project

    tempo = TEMPO_LINE.search(text)
    if tempo:
        try:
            project.bpm = float(tempo.group(1))
        except ValueError:
            pass

    ordered: list[str] = []
    for block in re.split(r"\n\s*<TRACK\b", text)[1:]:
        names = normalise_names(VST_LINE.findall(block))
        if not names:
            continue
        ordered.extend(names)
        instrument = ""
        effects: list[str] = []
        for name in names:
            known = canonical_tool(name)
            kind = known[1] if known else ""
            if not instrument and kind in ("instrument", "sampler", "drum"):
                instrument = name
            else:
                effects.append(name)
        title = TRACK_NAME.search(block)
        project.tracks.append(Track(name=title.group(1).strip() if title else "", instrument=instrument, plugins=effects))

    project.plugins = normalise_names(ordered)
    project.instruments = [t.instrument for t in project.tracks if t.instrument]
    project.samples = sorted({m.replace("\\", "/") for m in FILE_LINE.findall(text)})
    return project
