"""Stage 8 — Project DNA.

Every project gets a compact genetic profile: tempo, key, mood, genre, the
styles of its bass / lead / FX, energy, mix and stereo character, compression,
kick and bass type, and the preset / plugin / sample lists behind it. The DNA is
what stages 7, 9 and 10 compare against — it is much cheaper to reason over a
few hundred DNA records than over a terabyte of audio.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any, Iterable, Sequence

from . import projects as project_parsers
from .analyzer import analyze_file
from .config import Config
from .db import Database
from .learner import find_project_samples
from .taxonomy import bpm_from_name, key_from_name

MIXDOWN_HINTS = ("mixdown", "mixdowns", "bounces", "bounce", "renders", "export", "exports", "audio mixdown")


# ---------------------------------------------------------------------------
# labels
# ---------------------------------------------------------------------------


def genre_label(bpm: float | None, subtypes: Sequence[str], mode: str = "") -> str:
    tokens = {s.lower() for s in subtypes if s}
    if bpm:
        if bpm >= 165:
            return "hi-tech / darkpsy" if {"hitech", "dark"} & tokens else "drum & bass / hi-tech"
        if bpm >= 150:
            return "hi-tech psytrance" if "hitech" in tokens else "dark psytrance"
        if bpm >= 143:
            return "full-on psytrance" if not ({"goa"} & tokens) else "goa / nitzhonot"
        if bpm >= 138:
            return "psytrance"
        if bpm >= 132:
            return "progressive psytrance"
        if bpm >= 126:
            return "progressive house / techno"
        if bpm >= 118:
            return "melodic house"
        if bpm > 0:
            return "downtempo"
    if {"fullon", "rolling", "goa"} & tokens:
        return "psytrance"
    return "unclassified"


def mood_label(mode: str, energy: float, centroid: float, minor_share: float = 0.0) -> str:
    dark = mode == "minor" or minor_share > 0.6
    if energy >= 0.72:
        return "dark and driving" if dark else "euphoric and driving"
    if energy >= 0.5:
        return "hypnotic" if dark else "uplifting"
    if energy >= 0.3:
        return "brooding" if dark else "warm and melodic"
    return "ambient and still"


def compression_label(crest_db: float, dynamic_range: float) -> str:
    if crest_db <= 0:
        return "unknown"
    if crest_db < 9.0 or dynamic_range < 4.0:
        return "heavily compressed / limited"
    if crest_db < 13.0:
        return "moderately compressed"
    if crest_db < 18.0:
        return "lightly compressed"
    return "open dynamics"


def stereo_label(width: float, correlation: float) -> str:
    if width <= 0.05:
        return "mono"
    if width < 0.35:
        return "narrow"
    if width < 0.7:
        return "natural width"
    if correlation < 0.0:
        return "very wide (watch mono compatibility)"
    return "wide"


# ---------------------------------------------------------------------------
# DNA construction
# ---------------------------------------------------------------------------


def _dominant(values: Iterable[str]) -> str:
    counter = Counter(v for v in values if v)
    return counter.most_common(1)[0][0] if counter else ""


def find_mixdown(project_path: Path) -> Path | None:
    """Look for a rendered mix belonging to this project."""
    stem = project_path.stem.lower()
    candidates: list[Path] = []
    parents = [project_path.parent, *[p for p in project_path.parent.iterdir() if p.is_dir()]] if project_path.parent.exists() else []
    for folder in parents:
        try:
            if folder != project_path.parent and folder.name.lower() not in MIXDOWN_HINTS:
                continue
            for child in folder.iterdir():
                if child.is_file() and child.suffix.lower() in (".wav", ".aiff", ".aif", ".flac", ".mp3"):
                    candidates.append(child)
        except OSError:
            continue
    if not candidates:
        return None
    exact = [c for c in candidates if c.stem.lower() == stem]
    if exact:
        return max(exact, key=lambda c: c.stat().st_size)
    close = [c for c in candidates if stem[:8] and stem[:8] in c.stem.lower()]
    pool = close or candidates
    return max(pool, key=lambda c: c.stat().st_size)


def build_dna(
    db: Database,
    cfg: Config,
    project_path: str | Path,
    analyze_mixdown: bool = True,
) -> dict[str, Any]:
    """Compute the DNA for one project file."""
    target = Path(project_path)
    parsed = project_parsers.parse(target)
    if parsed is None:
        raise ValueError(f"unsupported project format: {target.suffix}")

    bpm = parsed.bpm or bpm_from_name(target.name)
    key = parsed.musical_key or key_from_name(target.name)

    resolved = find_project_samples(db, parsed.samples)
    sample_features: list[dict[str, Any]] = []
    for entry in resolved:
        if entry["file_id"]:
            features = db.analysis(int(entry["file_id"]))
            if features:
                sample_features.append(features)

    roles: dict[str, list[dict[str, Any]]] = {}
    for features in sample_features:
        roles.setdefault(str(features.get("role") or "unknown"), []).append(features)

    def subtype_of(role: str) -> str:
        return _dominant(str(f.get("subtype") or "") for f in roles.get(role, []))

    energies = [float(f.get("energy") or 0.0) for f in sample_features]
    centroids = [float(f.get("centroid_hz") or 0.0) for f in sample_features]
    modes = [str(f.get("key_mode") or "") for f in sample_features]
    keys = [str(f.get("musical_key") or "") for f in sample_features if f.get("musical_key")]
    bpms = [float(f.get("bpm") or 0.0) for f in sample_features if float(f.get("bpm") or 0.0) > 0]

    if not bpm and bpms:
        bpm = float(sorted(bpms)[len(bpms) // 2])
    if not key and keys:
        key = _dominant(keys)

    mix: dict[str, Any] = {}
    mixdown = find_mixdown(target) if analyze_mixdown else None
    if mixdown is not None:
        try:
            analysis = analyze_file(mixdown, cfg)
            mix = {
                "source": str(mixdown),
                "lufs": analysis.get("lufs"),
                "peak_db": analysis.get("peak_db"),
                "crest_db": analysis.get("crest_db"),
                "dynamic_range": analysis.get("dynamic_range"),
                "stereo_width": analysis.get("stereo_width"),
                "correlation": analysis.get("correlation"),
                "centroid_hz": analysis.get("centroid_hz"),
                "energy": analysis.get("energy"),
                "bpm": analysis.get("bpm"),
                "musical_key": analysis.get("musical_key"),
            }
            if not bpm and analysis.get("bpm"):
                bpm = float(analysis["bpm"])
            if not key and analysis.get("musical_key"):
                key = str(analysis["musical_key"])
        except Exception as exc:  # noqa: BLE001 - a broken render must not stop DNA
            mix = {"source": str(mixdown), "error": f"{type(exc).__name__}: {exc}"}

    energy = float(mix.get("energy") or (sum(energies) / len(energies) if energies else 0.0))
    centroid = float(mix.get("centroid_hz") or (sum(centroids) / len(centroids) if centroids else 0.0))
    mode = (key or "").split(" ")[-1] if key else _dominant(modes)
    minor_share = (modes.count("minor") / len(modes)) if modes else 0.0

    subtypes = [str(f.get("subtype") or "") for f in sample_features]
    dna: dict[str, Any] = {
        "project": parsed.name,
        "path": str(target),
        "daw": parsed.daw,
        "bpm": round(float(bpm), 2) if bpm else None,
        "key": key or "",
        "mode": mode,
        "genre": genre_label(float(bpm) if bpm else None, subtypes, mode),
        "mood": mood_label(mode, energy, centroid, minor_share),
        "energy": round(energy, 4),
        "bass_style": subtype_of("bass"),
        "bass_type": subtype_of("bass"),
        "lead_style": subtype_of("lead"),
        "fx_style": subtype_of("fx"),
        "pad_style": subtype_of("pad"),
        "kick_type": subtype_of("kick"),
        "vocal_style": subtype_of("vocal"),
        "mix": mix,
        "compression": compression_label(float(mix.get("crest_db") or 0.0), float(mix.get("dynamic_range") or 0.0)),
        "stereo": stereo_label(float(mix.get("stereo_width") or 0.0), float(mix.get("correlation") or 1.0)),
        "plugin_list": parsed.plugins,
        "instrument_list": parsed.instruments,
        "preset_list": parsed.presets,
        "sample_list": [Path(str(s)).name for s in parsed.samples][:400],
        "sample_count": len(parsed.samples),
        "resolved_samples": sum(1 for r in resolved if r["file_id"]),
        "chains": [" > ".join(chain) for _track, chain in parsed.chains],
        "role_breakdown": {role: len(items) for role, items in sorted(roles.items())},
        "notes": parsed.notes,
    }
    dna["fingerprint"] = fingerprint(dna)
    return dna


def fingerprint(dna: dict[str, Any]) -> str:
    """One-line signature, e.g. ``full-on psytrance | 145 BPM | F# minor | rolling bass``."""
    parts = [str(dna.get("genre") or "unclassified")]
    if dna.get("bpm"):
        parts.append(f"{float(dna['bpm']):.0f} BPM")
    if dna.get("key"):
        parts.append(str(dna["key"]))
    if dna.get("bass_style"):
        parts.append(f"{dna['bass_style']} bass")
    if dna.get("kick_type"):
        parts.append(f"{dna['kick_type']} kick")
    if dna.get("energy"):
        parts.append(f"energy {float(dna['energy']):.2f}")
    return " | ".join(parts)


def store_dna(db: Database, project_path: str | Path, dna: dict[str, Any]) -> None:
    row = db.file_by_path(str(project_path))
    if not row:
        return
    project = db.conn.execute("SELECT id FROM projects WHERE file_id=?", (int(row["id"]),)).fetchone()
    if project:
        db.conn.execute("UPDATE projects SET dna=? WHERE id=?", (json.dumps(dna), int(project["id"])))
        db.commit()


def load_dna(db: Database, project_path: str | Path) -> dict[str, Any] | None:
    row = db.project_by_path(str(project_path))
    if not row or not row["dna"]:
        return None
    try:
        return json.loads(str(row["dna"]))
    except json.JSONDecodeError:
        return None


def dna_or_build(db: Database, cfg: Config, project_path: str | Path, refresh: bool = False) -> dict[str, Any]:
    if not refresh:
        cached = load_dna(db, project_path)
        if cached:
            return cached
    dna = build_dna(db, cfg, project_path)
    store_dna(db, project_path, dna)
    return dna


def dna_lines(dna: dict[str, Any]) -> list[str]:
    """Readable DNA report."""
    lines = [f"{dna.get('project')} — {dna.get('fingerprint')}"]
    lines.append(f"  DAW: {dna.get('daw') or 'unknown'}   mood: {dna.get('mood')}   mode: {dna.get('mode') or 'n/a'}")
    if dna.get("mix"):
        mix = dna["mix"]
        if mix.get("lufs") is not None:
            lines.append(
                f"  mix: {float(mix['lufs']):.1f} LUFS, crest {float(mix.get('crest_db') or 0):.1f} dB "
                f"({dna.get('compression')}), stereo {dna.get('stereo')}"
            )
    styles = [
        f"{label}: {dna.get(field)}"
        for label, field in (
            ("kick", "kick_type"),
            ("bass", "bass_style"),
            ("lead", "lead_style"),
            ("pad", "pad_style"),
            ("fx", "fx_style"),
        )
        if dna.get(field)
    ]
    if styles:
        lines.append("  styles: " + ", ".join(styles))
    if dna.get("instrument_list"):
        lines.append("  instruments: " + ", ".join(dna["instrument_list"][:8]))
    if dna.get("plugin_list"):
        lines.append("  plugins: " + ", ".join(dna["plugin_list"][:12]))
    if dna.get("chains"):
        lines.append("  chains: " + " | ".join(dna["chains"][:4]))
    lines.append(f"  samples: {dna.get('resolved_samples')}/{dna.get('sample_count')} resolved in the library")
    return lines
