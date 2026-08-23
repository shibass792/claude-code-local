"""Stage 3b — Full Arrangement Mapping.

Maps generated layers onto a psytrance track structure in bars, with the
tempo-derived automation timings (delay/reverb in ms) already computed so the
guide is directly actionable in Cubase.
"""

from __future__ import annotations

from typing import Any

from music_brain.midiforge.analysis import Analysis

# Section templates as (name, bars, active layers, automation notes)
# Bar counts are phrase-locked multiples of 8 — standard for a DJ-friendly edit.
TEMPLATES: dict[str, list[dict[str, Any]]] = {
    "club": [
        {"key": "intro", "name": "Intro", "bars": 32,
         "layers": ["pad"],
         "automation": "HPF sweep 200 Hz -> 20 Hz over 32 bars. Lead filtered to a hint only (LPF ~800 Hz).",
         "note": "Beatmatch-friendly runway. Kick + pad only, no lead statement yet."},
        {"key": "build1", "name": "Build-Up 1", "bars": 16,
         "layers": ["pad", "bass", "counter"],
         "automation": "Bass enters bar 1. Counter-melody teases the hook. Riser last 4 bars.",
         "note": "Introduce the groove without spending the main lead."},
        {"key": "drop1", "name": "Drop / Main Groove", "bars": 32,
         "layers": ["lead", "bass", "arp"],
         "automation": "Full band. Pad out. Sidechain bass to kick, ~40 ms release.",
         "note": "The main statement — enhanced original lead over the rolling bass."},
        {"key": "breakdown", "name": "Breakdown", "bars": 32,
         "layers": ["pad", "counter"],
         "automation": "Kick + bass out at bar 1. LPF opens 400 Hz -> 18 kHz over 24 bars, resonance ~15%.",
         "note": "Harmonic evolution. Pad complexity up, long reverb tail."},
        {"key": "build2", "name": "Build-Up 2", "bars": 16,
         "layers": ["pad", "arp", "counter"],
         "automation": "Arp variation B enters. Snare roll 16th -> 32nd over last 8 bars. Uplifter.",
         "note": "Tension into the second drop — use the mutated arp, not the original."},
        {"key": "drop2", "name": "Drop 2 / Peak", "bars": 32,
         "layers": ["lead", "bass", "arp", "counter"],
         "automation": "Everything in. Counter-melody answers the lead in its gaps.",
         "note": "Highest energy point of the track."},
        {"key": "outro", "name": "Outro", "bars": 32,
         "layers": ["bass", "pad"],
         "automation": "Lead out bar 1. LPF 18 kHz -> 300 Hz over final 16 bars. Kick out last 8.",
         "note": "Clean mix-out runway for the next DJ."},
    ],
    "short": [
        {"key": "intro", "name": "Intro", "bars": 16, "layers": ["pad"],
         "automation": "HPF sweep down over 16 bars.", "note": "Compact opener."},
        {"key": "build1", "name": "Build-Up", "bars": 8, "layers": ["pad", "bass"],
         "automation": "Riser last 4 bars.", "note": "Fast entry into the groove."},
        {"key": "drop1", "name": "Drop / Main Groove", "bars": 32,
         "layers": ["lead", "bass", "arp"],
         "automation": "Full band, sidechain active.", "note": "Main statement."},
        {"key": "breakdown", "name": "Breakdown", "bars": 16, "layers": ["pad", "counter"],
         "automation": "LPF opens over 12 bars.", "note": "Short tension reset."},
        {"key": "drop2", "name": "Drop 2", "bars": 32,
         "layers": ["lead", "bass", "arp", "counter"],
         "automation": "Everything in.", "note": "Peak."},
        {"key": "outro", "name": "Outro", "bars": 16, "layers": ["bass", "pad"],
         "automation": "LPF down, kick out last 8.", "note": "Mix-out."},
    ],
}

LAYER_FILES = {
    "lead": "01_Original_Lead_Enhanced.mid",
    "pad": "02_Generated_Atmospheric_Pad.mid",
    "arp": "03_Arp_Variation_B.mid",
    "counter": "04_Counter_Melody.mid",
    "bass": "05_Bassline_Root_Sync.mid",
}


def note_ms_table(bpm: float) -> dict[str, float]:
    """BPM-derived note lengths in ms — for delay times and reverb pre-delay."""
    beat = 60000.0 / float(bpm or 145.0)
    return {
        "1/1": round(beat * 4, 2),
        "1/2": round(beat * 2, 2),
        "1/4": round(beat, 2),
        "1/8": round(beat / 2, 2),
        "1/8T": round(beat / 3, 2),
        "1/16": round(beat / 4, 2),
        "1/16T": round(beat / 6, 2),
        "1/32": round(beat / 8, 2),
        "1/4D": round(beat * 1.5, 2),
        "1/8D": round(beat * 0.75, 2),
    }


def build_arrangement(analysis: Analysis, template: str = "club") -> dict[str, Any]:
    sections = TEMPLATES.get(template, TEMPLATES["club"])
    bar = 1
    out_sections: list[dict[str, Any]] = []
    for s in sections:
        out_sections.append(
            {
                "key": s["key"],
                "name": s["name"],
                "start_bar": bar,
                "end_bar": bar + s["bars"] - 1,
                "bars": s["bars"],
                "layers": s["layers"],
                "files": [LAYER_FILES[l] for l in s["layers"] if l in LAYER_FILES],
                "automation": s["automation"],
                "note": s["note"],
            }
        )
        bar += s["bars"]

    total_bars = bar - 1
    beats = total_bars * analysis.__dict__.get("_num", 4)
    seconds = total_bars * 4 * (60.0 / (analysis.bpm or 145.0))

    return {
        "template": template,
        "total_bars": total_bars,
        "approx_duration_sec": round(seconds, 1),
        "approx_duration": f"{int(seconds // 60)}:{int(seconds % 60):02d}",
        "bpm": round(analysis.bpm, 2),
        "key": f"{analysis.key_name} {analysis.scale}",
        "sections": out_sections,
        "note_ms": note_ms_table(analysis.bpm),
    }
