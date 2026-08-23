"""Stage 4 — Cubase Project & MIDI Bridge.

Writes one cleanly-named Type 1 SMF per role into a dated project folder, plus a
markdown arrangement guide. Drag the folder into an open Cubase 15 Pro project
and each file lands on its own track, tempo and time signature already correct.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from music_brain.midiforge.analysis import Analysis
from music_brain.midiforge.arrange import LAYER_FILES, note_ms_table
from music_brain.midiforge.smf import MidiData, Track, write_midi

VSTI_SUGGESTIONS = {
    "lead": "Serum / Sylenth1 — supersaw or acid stack. HPF at 180 Hz.",
    "pad": "Omnisphere / Diva — slow attack (~600 ms), long release. HPF at 220 Hz so it never touches the sub.",
    "arp": "Serum / Vital — short pluck, tight gate. Sidechain lightly to the kick.",
    "counter": "Sylenth1 / Pigments — thinner patch than the lead, pan 25% opposite the lead.",
    "bass": "Backbone / Serum — mono below 120 Hz, zero stereo width on the sub band.",
}


def _safe_name(raw: str) -> str:
    name = re.sub(r"[^\w\-. ]+", "_", str(raw)).strip().strip(".")
    return (name or "project")[:60]


def default_export_root() -> Path:
    env = os.environ.get("MIDIFORGE_OUT")
    if env:
        return Path(env)
    for cand in (Path(r"H:\shibass-ai\10_OUTPUTS"), Path(r"D:\ "), Path.home() / "Documents"):
        try:
            if cand.exists() and cand.is_dir():
                return cand / "MIDIFORGE"
        except OSError:
            continue
    return Path.home() / "MIDIFORGE"


def export_project(
    md: MidiData,
    analysis: Analysis,
    tracks: dict[str, Track],
    arrangement: dict[str, Any],
    *,
    project_name: str = "",
    out_root: str | Path | None = None,
    source_path: str | None = None,
) -> dict[str, Any]:
    """Write per-role MIDI files + guide. `tracks` maps layer key -> Track."""
    root = Path(out_root) if out_root else default_export_root()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    base = _safe_name(project_name or (Path(source_path).stem if source_path else "MidiForge"))
    proj_dir = root / f"{base}_{stamp}"
    proj_dir.mkdir(parents=True, exist_ok=True)

    written: list[dict[str, Any]] = []
    for layer, filename in LAYER_FILES.items():
        track = tracks.get(layer)
        if not track or not track.notes:
            continue
        target = proj_dir / filename
        write_midi(target, md, tracks=[track], title=track.name)
        written.append(
            {
                "layer": layer,
                "file": filename,
                "path": str(target),
                "track_name": track.name,
                "notes": len(track.notes),
                "channel": track.channel,
                "vsti": VSTI_SUGGESTIONS.get(layer, ""),
                "size_bytes": target.stat().st_size,
            }
        )

    # Combined multi-track file — one drag, all parts
    combo_tracks = [tracks[l] for l in LAYER_FILES if tracks.get(l) and tracks[l].notes]
    combo_path = None
    if combo_tracks:
        combo_path = proj_dir / "00_ALL_TRACKS_Combined.mid"
        write_midi(combo_path, md, tracks=combo_tracks, title=base)

    guide = _write_guide(proj_dir, md, analysis, arrangement, written, source_path, base)

    meta_path = proj_dir / "midiforge_manifest.json"
    manifest = {
        "project": base,
        "created": stamp,
        "source": source_path,
        "bpm": round(analysis.bpm, 3),
        "key": f"{analysis.key_name} {analysis.scale}",
        "tpq": md.tpq,
        "time_signature": f"{md.numerator}/{md.denominator}",
        "files": written,
        "combined": str(combo_path) if combo_path else None,
        "guide": str(guide),
        "arrangement": arrangement,
    }
    meta_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "ok": True,
        "project_dir": str(proj_dir),
        "files": written,
        "combined": str(combo_path) if combo_path else None,
        "guide": str(guide),
        "manifest": str(meta_path),
        "file_count": len(written) + (1 if combo_path else 0),
    }


def _write_guide(
    proj_dir: Path,
    md: MidiData,
    analysis: Analysis,
    arrangement: dict[str, Any],
    written: list[dict[str, Any]],
    source_path: str | None,
    base: str,
) -> Path:
    ms = note_ms_table(analysis.bpm)
    bpm = round(analysis.bpm, 2)
    L: list[str] = []

    L.append(f"# {base} — Arrangement Guide")
    L.append("")
    L.append(f"Generated {datetime.now().strftime('%Y-%m-%d %H:%M')} by MIDI Forge (Music Brain, port 8788).")
    L.append("")
    L.append("## Session settings")
    L.append("")
    L.append(f"- **Tempo:** {bpm} BPM")
    L.append(f"- **Key:** {analysis.key_name} {analysis.scale} (confidence {analysis.key_confidence:.0%})")
    L.append(f"- **Time signature:** {md.numerator}/{md.denominator}")
    L.append(f"- **PPQ:** {md.tpq}")
    L.append(f"- **Source:** `{source_path or 'n/a'}`")
    L.append(f"- **Detected density:** {analysis.density} · energy {analysis.energy:.2f}")
    if analysis.key_alternatives:
        alts = ", ".join(a["key"] for a in analysis.key_alternatives[:3])
        L.append(f"- **Runner-up keys:** {alts}")
    L.append("")

    L.append("## Import into Cubase 15 Pro")
    L.append("")
    L.append("1. Set the project tempo to **" + str(bpm) + " BPM** *before* importing, so the parts land on the grid.")
    L.append("2. Drag the `.mid` files from this folder straight into the Project window — each becomes its own track.")
    L.append("3. Assign a VSTi per track using the table below.")
    L.append("4. `00_ALL_TRACKS_Combined.mid` holds every part in one Type 1 file if you prefer a single drag.")
    L.append("")

    L.append("## Tracks")
    L.append("")
    L.append("| # | File | Role | Notes | MIDI ch | Suggested VSTi |")
    L.append("|---|------|------|-------|---------|----------------|")
    for i, w in enumerate(written, 1):
        L.append(
            f"| {i} | `{w['file']}` | {w['layer']} | {w['notes']} | {w['channel'] + 1} | {w['vsti']} |"
        )
    L.append("")

    L.append("## What changed vs. the source")
    L.append("")
    for w in written:
        L.append(f"### {w['file']}")
        L.append("")
        L.append(_layer_description(w["layer"], analysis))
        L.append("")

    L.append("## Arrangement map")
    L.append("")
    L.append(
        f"Template **{arrangement.get('template')}** · {arrangement.get('total_bars')} bars · "
        f"~{arrangement.get('approx_duration')}"
    )
    L.append("")
    L.append("| Section | Bars | Layers | Automation |")
    L.append("|---------|------|--------|------------|")
    for s in arrangement.get("sections", []):
        layers = ", ".join(s["layers"])
        L.append(f"| **{s['name']}** | {s['start_bar']}–{s['end_bar']} ({s['bars']}) | {layers} | {s['automation']} |")
    L.append("")
    for s in arrangement.get("sections", []):
        L.append(f"- **{s['name']}** (bar {s['start_bar']}): {s['note']}")
    L.append("")

    L.append(f"## Tempo-locked times @ {bpm} BPM")
    L.append("")
    L.append("Use these for delay times and reverb pre-delay — no guessing.")
    L.append("")
    L.append("| Note | ms |")
    L.append("|------|-----|")
    for k in ("1/1", "1/2", "1/4D", "1/4", "1/8D", "1/8", "1/8T", "1/16", "1/16T", "1/32"):
        L.append(f"| {k} | {ms[k]} |")
    L.append("")
    L.append(f"- **Ping-pong delay on the lead:** {ms['1/8D']} ms (dotted 1/8) — the psy standard.")
    L.append(f"- **Reverb pre-delay on the pad:** {ms['1/32']} ms, decay ~{round(ms['1/1'] * 2 / 1000, 2)} s.")
    L.append(f"- **Sidechain release on the bass:** ~{round(ms['1/16'] * 0.4, 1)} ms so it recovers before the next 16th.")
    L.append("")

    L.append("## Mix notes")
    L.append("")
    L.append("- Keep everything below **120 Hz mono** — the sub belongs to the kick and bass only.")
    L.append("- The pad is voiced from MIDI 48 (C3) up and HPF'd at 220 Hz; it should never mask the bass.")
    L.append("- Counter-melody is written into the lead's rests, so no EQ carving should be needed — pan it 25% opposite.")
    L.append(f"- Master target: **-6 to -8 LUFS integrated**, true peak ≤ **-1.0 dBTP**.")
    L.append("")

    path = proj_dir / "ARRANGEMENT_GUIDE.md"
    path.write_text("\n".join(L), encoding="utf-8")
    return path


def _layer_description(layer: str, analysis: Analysis) -> str:
    key = f"{analysis.key_name} {analysis.scale}"
    return {
        "lead": (
            "Your original lead, **note-for-note unchanged** — same ticks, same gate lengths, same velocities. "
            "An octave layer sits underneath at -26 velocity on roughly half the notes to thicken it without "
            "blurring the phrasing. Mute that layer if you want the bare original."
        ),
        "pad": (
            f"Generated from the per-bar root progression, locked to **{key}**. Voiced from C3 upward so it stays "
            "clear of the sub. Each voice is staggered by a few ticks so the chord breathes instead of blocking."
        ),
        "arp": (
            "Variation B of your arp/lead. Intervals are drawn from a Markov table built on **your own** melody, so "
            "the vocabulary is yours — the order isn't. Some notes are dropped on purpose to open call-and-response "
            "gaps. Untouched notes keep their original timing and velocity exactly."
        ),
        "counter": (
            "Written **only into the rests** of the main melody — it answers the lead rather than competing with it. "
            "Intervals are restricted to 3rds, 4ths, 5ths and octaves below the surrounding lead pitch, then "
            f"snapped to **{key}**."
        ),
        "bass": (
            f"Root-locked to the same per-bar progression, in **{key}**. The rolling pattern deliberately leaves the "
            "first 16th of every beat empty so the kick has its own window — no phase fight, no ducking needed "
            "beyond normal sidechain."
        ),
    }.get(layer, "Generated layer.")
