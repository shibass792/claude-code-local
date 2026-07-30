"""PreSonus Studio One ``.song`` reader.

A ``.song`` is a zip archive of XML-ish documents. Studio One's schema changes
between versions, so this parser walks whatever XML it finds and keeps the
attributes that look like device names, tempo and media references.
"""

from __future__ import annotations

import re
import zipfile
from pathlib import Path

from . import ParsedProject, Track, canonical_tool, normalise_names

NAME_ATTR = re.compile(r'(?:name|deviceName|className|pluginName)="([^"]{2,60})"', re.IGNORECASE)
TEMPO_ATTR = re.compile(r'(?:tempo|Tempo)="([0-9]{2,3}(?:\.[0-9]+)?)"')
MEDIA_ATTR = re.compile(r'(?:url|path|file)="([^"]+\.(?:wav|aiff|aif|flac|mp3|ogg))"', re.IGNORECASE)
TRACK_TAG = re.compile(r'<(?:AudioTrack|MusicTrack|Track)\b[^>]*?name="([^"]{1,60})"', re.IGNORECASE)

MAX_ENTRY_BYTES = 32 * 1024 * 1024


def parse(path: str | Path) -> ParsedProject:
    target = Path(path)
    project = ParsedProject(path=str(target), name=target.stem, daw="Studio One")

    documents: list[str] = []
    try:
        with zipfile.ZipFile(target) as archive:
            for info in archive.infolist():
                if info.file_size > MAX_ENTRY_BYTES:
                    continue
                lowered = info.filename.lower()
                if not lowered.endswith((".xml", ".song", ".device", ".json", "/song", "song")):
                    continue
                try:
                    documents.append(archive.read(info).decode("utf-8", "ignore"))
                except (OSError, zipfile.BadZipFile):
                    continue
    except (OSError, zipfile.BadZipFile) as exc:
        project.notes.append(f"not a readable .song archive: {exc}")
        return project

    if not documents:
        project.notes.append("no XML documents inside the archive")
        return project

    blob = "\n".join(documents)
    tempo = TEMPO_ATTR.search(blob)
    if tempo:
        try:
            value = float(tempo.group(1))
            if 40.0 <= value <= 220.0:
                project.bpm = value
        except ValueError:
            pass

    raw_names = NAME_ATTR.findall(blob)
    known_names = [name for name in raw_names if canonical_tool(name)]
    project.plugins = normalise_names(known_names, keep_unknown=False)
    project.instruments = [
        name for name in project.plugins if (canonical_tool(name) or ("", ""))[1] in ("instrument", "sampler", "drum")
    ]
    project.samples = sorted({m.replace("\\", "/") for m in MEDIA_ATTR.findall(blob)})

    track_names = TRACK_TAG.findall(blob)
    if track_names and project.plugins:
        # Studio One does not give us a reliable per-track device order from a
        # flat scan, so report one chain and name it after the first track.
        project.tracks.append(Track(name=track_names[0], instrument=project.instruments[0] if project.instruments else "", plugins=[p for p in project.plugins if p not in project.instruments]))
        project.notes.append("device order is archive order, not per-track insert order")
    elif project.plugins:
        project.tracks.append(Track(name="(archive order)", plugins=project.plugins))
    return project
