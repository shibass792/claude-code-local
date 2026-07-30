"""Scan the local library and describe every arp, loop and DAW project it finds.

Metadata is resolved in order of trust:
  1. a sidecar `<name>.dawmatch.json` — you said it, we believe it
  2. the file itself — MIDI tempo/key meta, Ableton's project tempo
  3. the filename — `Dark Arp 128bpm Amin.mid` and friends

Results are cached in ~/.daw-match/index.json keyed by path + mtime + size, so a
rescan of an unchanged library is nearly free.
"""
import gzip
import json
import os
import re
import time

from . import config
from .analysis import PITCH_NAMES, analyze
from .audioio import IngestError, decode
from .midilib import MidiError, MidiFile

_BPM_PATTERNS = [
    re.compile(r"(?<!\d)(\d{2,3})\s*(?:bpm|BPM)"),
    re.compile(r"(?:bpm|BPM)[\s_\-]*(\d{2,3})(?!\d)"),
    re.compile(r"(?:^|[_\-\s])(\d{2,3})(?=[_\-\s.]|$)"),
]

_FLAT_TO_SHARP = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#"}

_KEY_PATTERN = re.compile(
    r"(?:^|[_\-\s\(\[])"
    r"([A-G])([#b\u266f\u266d]?)"
    r"[\s_\-]*(maj7|maj|major|min|minor|m|M)?"
    r"(?=$|[_\-\s\)\]\.])"
)

_ALS_TEMPO = re.compile(r"<Tempo>.*?<Manual\s+Value=\"([\d.]+)\"", re.S)
_ALS_ROOT = re.compile(r"<ScaleInformation>.*?<RootNote\s+Value=\"(\d+)\"", re.S)
_ALS_SCALE = re.compile(r"<ScaleInformation>.*?<Name\s+Value=\"([A-Za-z]+)\"", re.S)


def parse_bpm_from_name(name):
    for pattern in _BPM_PATTERNS:
        match = pattern.search(name)
        if match:
            bpm = int(match.group(1))
            if 40 <= bpm <= 220:
                return float(bpm)
    return None


def parse_key_from_name(name):
    """Return (key_label, tonic_index, mode) or (None, -1, '')."""
    for match in _KEY_PATTERN.finditer(name):
        letter, accidental, quality = match.group(1), match.group(2) or "", match.group(3)
        accidental = accidental.replace("\u266f", "#").replace("\u266d", "b")
        pitch = letter + accidental
        pitch = _FLAT_TO_SHARP.get(pitch, pitch)
        if pitch not in PITCH_NAMES:
            continue
        tonic = PITCH_NAMES.index(pitch)
        if quality in ("m", "min", "minor"):
            mode = "minor"
        elif quality in ("M", "maj", "major", "maj7"):
            mode = "major"
        else:
            # No quality written down. Guessing would silently poison the match
            # score, so leave the mode open and let the matcher treat it as a
            # tonic-only hint.
            mode = ""
        label = f"{pitch} {mode}".strip()
        return label, tonic, mode
    return None, -1, ""


def _entry_kind(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in config.ARP_EXTS:
        return "arp"
    if ext in config.PROJECT_EXTS:
        return "project"
    if ext in config.AUDIO_EXTS:
        return "loop"
    return None


def _sidecar(path):
    base = os.path.splitext(path)[0]
    for candidate in (f"{base}.dawmatch.json", f"{path}.dawmatch.json"):
        if os.path.exists(candidate):
            try:
                with open(candidate, "r", encoding="utf-8") as fh:
                    loaded = json.load(fh)
                if isinstance(loaded, dict):
                    return loaded
            except (OSError, ValueError):
                pass
    return {}


def _read_als(path):
    """Ableton .als is gzipped XML, so tempo and scale are readable."""
    meta = {}
    try:
        with gzip.open(path, "rt", encoding="utf-8", errors="replace") as fh:
            xml = fh.read(400_000)
    except OSError:
        return meta
    tempo = _ALS_TEMPO.search(xml)
    if tempo:
        try:
            meta["bpm"] = round(float(tempo.group(1)), 2)
        except ValueError:
            pass
    root, scale = _ALS_ROOT.search(xml), _ALS_SCALE.search(xml)
    if root:
        tonic = int(root.group(1)) % 12
        name = (scale.group(1).lower() if scale else "")
        mode = "minor" if "minor" in name or name == "aeolian" else ("major" if name else "")
        meta["tonic"] = tonic
        meta["mode"] = mode
        meta["key"] = f"{PITCH_NAMES[tonic]} {mode}".strip()
    return meta


def describe(path, deep=True):
    """Build the metadata record for one library file."""
    stat = os.stat(path)
    name = os.path.basename(path)
    stem = os.path.splitext(name)[0]
    ext = os.path.splitext(name)[1].lower()
    kind = _entry_kind(path)

    entry = {
        "path": path,
        "name": stem,
        "ext": ext,
        "kind": kind,
        "size": stat.st_size,
        "mtime": stat.st_mtime,
        "bpm": None,
        "key": None,
        "tonic": -1,
        "mode": "",
        "brightness": None,
        "loudness": None,
        "duration": None,
        "source": "filename",
        "daw": config.PROJECT_EXTS.get(ext, ""),
        "notes": None,
        "warning": "",
    }

    bpm = parse_bpm_from_name(stem)
    key_label, tonic, mode = parse_key_from_name(stem)
    if bpm:
        entry["bpm"] = bpm
    if key_label:
        entry.update(key=key_label, tonic=tonic, mode=mode)

    if deep:
        try:
            if kind == "arp":
                _describe_midi(path, entry)
            elif kind == "loop":
                _describe_audio(path, entry)
            elif ext == ".als":
                found = _read_als(path)
                if found:
                    entry.update(found)
                    entry["source"] = "project"
        except (OSError, ValueError, MidiError, IngestError) as exc:
            entry["warning"] = str(exc)

    sidecar = _sidecar(path)
    if sidecar:
        for field in ("bpm", "key", "tonic", "mode", "tags", "preview", "pair", "name"):
            if field in sidecar:
                entry[field] = sidecar[field]
        if "key" in sidecar and "tonic" not in sidecar:
            label, tonic, mode = parse_key_from_name(str(sidecar["key"]))
            if label:
                entry.update(tonic=tonic, mode=mode)
        entry["source"] = "sidecar"

    return entry


def _describe_midi(path, entry):
    midi = MidiFile.load(path)
    entry["bpm"] = midi.bpm or entry["bpm"]
    label, tonic, mode, _confidence = midi.detect_key()
    if tonic >= 0:
        entry.update(key=label, tonic=tonic, mode=mode)
    entry["duration"] = round(midi.duration, 2)
    entry["notes"] = len(midi.notes)
    entry["source"] = "midi"
    if not midi.notes:
        entry["warning"] = "no notes in this MIDI file"


def _describe_audio(path, entry):
    samples = decode(path, max_seconds=30.0)
    result = analyze(samples)
    entry["bpm"] = result["bpm"] or entry["bpm"]
    if result["tonic"] >= 0:
        entry.update(key=result["key"], tonic=result["tonic"], mode=result["mode"])
    entry["duration"] = result["duration"]
    entry["brightness"] = result["brightness"]
    entry["loudness"] = result["loudness"]
    entry["source"] = "audio"


def _load_cache():
    try:
        with open(config.INDEX_PATH, "r", encoding="utf-8") as fh:
            loaded = json.load(fh)
        if isinstance(loaded, dict) and isinstance(loaded.get("entries"), dict):
            return loaded["entries"]
    except (OSError, ValueError):
        pass
    return {}


def _save_cache(entries, roots):
    config.ensure_state_dirs()
    tmp = f"{config.INDEX_PATH}.tmp"
    payload = {"version": 1, "scanned_at": time.time(), "roots": roots, "entries": entries}
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1)
    os.replace(tmp, config.INDEX_PATH)


def scan(roots, use_cache=True, deep=True, max_files=6000):
    """Walk the roots and return (entries, stats)."""
    cache = _load_cache() if use_cache else {}
    entries = {}
    stats = {"scanned": 0, "cached": 0, "skipped": 0, "roots": [], "missing_roots": []}

    known_exts = set(config.ARP_EXTS) | set(config.AUDIO_EXTS) | set(config.PROJECT_EXTS)

    for root in roots:
        root = os.path.expanduser(root)
        if not os.path.isdir(root):
            stats["missing_roots"].append(root)
            continue
        stats["roots"].append(root)
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            for filename in filenames:
                if filename.startswith("."):
                    continue
                if os.path.splitext(filename)[1].lower() not in known_exts:
                    continue
                if len(entries) >= max_files:
                    stats["skipped"] += 1
                    continue
                path = os.path.join(dirpath, filename)
                try:
                    stat = os.stat(path)
                except OSError:
                    stats["skipped"] += 1
                    continue
                cached = cache.get(path)
                if cached and cached.get("mtime") == stat.st_mtime and cached.get("size") == stat.st_size:
                    entries[path] = cached
                    stats["cached"] += 1
                    continue
                try:
                    entries[path] = describe(path, deep=deep)
                    stats["scanned"] += 1
                except OSError:
                    stats["skipped"] += 1

    _save_cache(entries, stats["roots"])
    return list(entries.values()), stats


def load_index():
    """Read the cached index without touching the filesystem."""
    return list(_load_cache().values())


def entry_id(path):
    """Stable, URL-safe handle for an entry."""
    import hashlib

    return hashlib.sha1(path.encode("utf-8")).hexdigest()[:16]


def index_by_id(entries):
    return {entry_id(e["path"]): e for e in entries}
