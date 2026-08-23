"""Stage 2 — Identity & Style Analysis (pure stdlib).

Decodes key / mode (incl. Phrygian + Phrygian Dominant, the psytrance staples),
classifies each track's role, and profiles groove, density and velocity so the
generative stage stays inside the source material's DNA.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from music_brain.midiforge.smf import MidiData, Note, Track

PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Percussion note numbers are drum-map indices, not pitches. Including them in
# harmonic analysis is the single biggest source of wrong-key results, because
# a busy drum track can outnumber every melodic track combined.
_PERC_HINTS = ("drum", "perc", "kick", "snare", "hat", "hihat", "tom", "clap",
               "cymbal", "ride", "crash", "shaker", "conga", "bongo", "rim", "batt")


def is_percussion(track: Track) -> bool:
    if track.channel == 9:  # GM percussion channel (1-based ch10)
        return True
    lname = (track.name or "").lower()
    return any(h in lname for h in _PERC_HINTS)


def harmonic_notes(md: MidiData) -> list[Note]:
    """All pitched notes — percussion tracks removed."""
    out: list[Note] = []
    for t in md.tracks:
        if is_percussion(t):
            continue
        out.extend(t.notes)
    out.sort(key=lambda n: (n.start, n.pitch))
    return out or md.all_notes()

# Scale interval sets (semitones from root)
SCALES: dict[str, tuple[int, ...]] = {
    "Minor": (0, 2, 3, 5, 7, 8, 10),  # Aeolian
    "Phrygian": (0, 1, 3, 5, 7, 8, 10),
    "Phrygian Dominant": (0, 1, 4, 5, 7, 8, 10),  # Freygish / Hijaz
    "Harmonic Minor": (0, 2, 3, 5, 7, 8, 11),
    "Dorian": (0, 2, 3, 5, 7, 9, 10),
    "Major": (0, 2, 4, 5, 7, 9, 11),
    "Mixolydian": (0, 2, 4, 5, 7, 9, 10),
    "Locrian": (0, 1, 3, 5, 6, 8, 10),
}

# Weighting: tonic and fifth carry the most identity, characteristic degrees next.
_DEGREE_WEIGHTS = {0: 3.0, 7: 2.0, 3: 1.6, 4: 1.6, 1: 1.5, 10: 1.2, 5: 1.1, 8: 1.2}


@dataclass
class TrackProfile:
    index: int
    name: str
    role: str
    note_count: int
    channel: int
    pitch_min: int
    pitch_max: int
    pitch_median: float
    avg_polyphony: float
    max_polyphony: int
    notes_per_bar: float
    avg_dur_beats: float
    legato_ratio: float
    velocity: dict[str, float] = field(default_factory=dict)
    groove: dict[str, Any] = field(default_factory=dict)
    confidence: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "name": self.name,
            "role": self.role,
            "role_confidence": round(self.confidence, 3),
            "channel": self.channel,
            "note_count": self.note_count,
            "pitch_min": self.pitch_min,
            "pitch_max": self.pitch_max,
            "pitch_median": round(self.pitch_median, 1),
            "avg_polyphony": round(self.avg_polyphony, 2),
            "max_polyphony": self.max_polyphony,
            "notes_per_bar": round(self.notes_per_bar, 2),
            "avg_dur_beats": round(self.avg_dur_beats, 3),
            "legato_ratio": round(self.legato_ratio, 3),
            "velocity": self.velocity,
            "groove": self.groove,
        }


@dataclass
class Analysis:
    bpm: float
    tpq: int
    bars: int
    time_signature: str
    key_root: int
    key_name: str
    scale: str
    key_confidence: float
    scale_pitches: list[int]
    key_alternatives: list[dict[str, Any]]
    tracks: list[TrackProfile]
    root_progression: list[dict[str, Any]]
    density: str
    energy: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "bpm": round(self.bpm, 3),
            "tpq": self.tpq,
            "bars": self.bars,
            "time_signature": self.time_signature,
            "key": f"{self.key_name} {self.scale}",
            "key_root": self.key_root,
            "key_root_name": self.key_name,
            "scale": self.scale,
            "key_confidence": round(self.key_confidence, 3),
            "scale_pitch_classes": self.scale_pitches,
            "key_alternatives": self.key_alternatives,
            "density": self.density,
            "energy": round(self.energy, 3),
            "root_progression": self.root_progression,
            "tracks": [t.to_dict() for t in self.tracks],
        }


# ---------------------------------------------------------------------------
# Key / scale detection
# ---------------------------------------------------------------------------


def detect_key(notes: list[Note], tpq: int) -> tuple[int, str, float, list[dict[str, Any]]]:
    """Duration+velocity-weighted pitch-class profile matched against scale templates."""
    if not notes:
        return 0, "Minor", 0.0, []

    pc_weight = [0.0] * 12
    for n in notes:
        # Duration in beats * velocity — long, loud notes define the tonality
        w = (n.dur / float(tpq or 480)) * (n.velocity / 127.0)
        pc_weight[n.pitch % 12] += max(w, 0.01)

    total = sum(pc_weight) or 1.0
    profile = [w / total for w in pc_weight]

    # Bass-register notes vote extra for the root.
    # The cutoff adapts to the arrangement: a track written high still has a
    # lowest voice, and that voice is the tonal anchor. Fixed thresholds fail
    # on both sub-heavy and register-shifted material.
    lowest = min(n.pitch for n in notes)
    cutoff = min(52, lowest + 12)
    bass = [n for n in notes if n.pitch <= cutoff]
    root_vote = [0.0] * 12
    for n in bass:
        root_vote[n.pitch % 12] += (n.dur / float(tpq or 480)) * 1.0
    bv_total = sum(root_vote) or 1.0
    root_vote = [v / bv_total for v in root_vote]

    scored: list[tuple[float, int, str]] = []
    for root in range(12):
        for scale_name, intervals in SCALES.items():
            iv = set(intervals)
            score = 0.0
            for pc in range(12):
                rel = (pc - root) % 12
                w = profile[pc]
                if rel in iv:
                    score += w * _DEGREE_WEIGHTS.get(rel, 1.0)
                else:
                    score -= w * 1.4  # out-of-scale penalty
            # Root reinforcement from the bass register
            score += root_vote[root] * 1.8
            # Slight prior: minor-family modes dominate this genre
            if scale_name in ("Minor", "Phrygian", "Harmonic Minor"):
                score *= 1.04
            scored.append((score, root, scale_name))

    scored.sort(reverse=True, key=lambda x: x[0])
    best_score, best_root, best_scale = scored[0]

    # Relative-mode disambiguation.
    # A# Minor and D# Dorian are the *same* seven pitch classes, so template
    # matching alone can land on the wrong tonic. The bass register is the real
    # tonal anchor in electronic music — if a near-tied candidate is rooted on
    # the dominant bass note, that is the key the producer actually plays in.
    if bass:
        bass_pc = max(range(12), key=lambda pc: root_vote[pc])
        if bass_pc != best_root and root_vote[bass_pc] > 0.30:
            for sc, r, s in scored[:24]:
                if r == bass_pc and sc >= best_score * 0.90:
                    best_score, best_root, best_scale = sc, r, s
                    break

    # Confidence = how far the winner stands above the field, in units of the
    # field's own spread. A margin of ~2 standard deviations reads as certain.
    # (Comparing only to the runner-up under-reports, because modal siblings
    # like Minor/Phrygian legitimately score close to each other.)
    all_scores = [s for s, _r, _sc in scored]
    mean = sum(all_scores) / len(all_scores)
    var = sum((s - mean) ** 2 for s in all_scores) / len(all_scores)
    sd = math.sqrt(var) or 1e-6
    z = (best_score - mean) / sd
    confidence = max(0.0, min(1.0, z / 2.5))

    alts = [
        {
            "key": f"{PITCH_NAMES[r]} {s}",
            "score": round(sc, 4),
        }
        for sc, r, s in scored[1:5]
    ]
    return best_root, best_scale, confidence, alts


def scale_pitch_classes(root: int, scale: str) -> list[int]:
    return sorted({(root + i) % 12 for i in SCALES.get(scale, SCALES["Minor"])})


def snap_to_scale(pitch: int, allowed_pcs: list[int]) -> int:
    """Nearest in-scale pitch, preferring downward motion (keeps psy leads dark)."""
    if not allowed_pcs:
        return pitch
    if pitch % 12 in allowed_pcs:
        return pitch
    for delta in (-1, 1, -2, 2, -3, 3):
        cand = pitch + delta
        if 0 <= cand <= 127 and cand % 12 in allowed_pcs:
            return cand
    return pitch


# ---------------------------------------------------------------------------
# Track role classification
# ---------------------------------------------------------------------------


def _polyphony(notes: list[Note]) -> tuple[float, int]:
    """Average and peak simultaneous voices via a sweep line over note events."""
    if not notes:
        return 0.0, 0
    events: list[tuple[int, int]] = []
    for n in notes:
        events.append((n.start, 1))
        events.append((n.end, -1))
    events.sort()
    cur = 0
    peak = 0
    weighted = 0.0
    span = 0
    prev_t = events[0][0]
    for t, d in events:
        if t > prev_t and cur > 0:
            weighted += cur * (t - prev_t)
            span += t - prev_t
        cur += d
        peak = max(peak, cur)
        prev_t = t
    avg = (weighted / span) if span else float(peak)
    return avg, peak


def _median(vals: list[float]) -> float:
    if not vals:
        return 0.0
    s = sorted(vals)
    m = len(s) // 2
    return float(s[m]) if len(s) % 2 else (s[m - 1] + s[m]) / 2.0


def classify_role(notes: list[Note], md: MidiData, name: str, channel: int) -> tuple[str, float]:
    """Rule-based role detection: drums / bass / lead / arp / pad / counter."""
    if not notes:
        return "empty", 0.0

    lname = (name or "").lower()
    hints = {
        "kick": "drums", "drum": "drums", "perc": "drums", "hat": "drums", "snare": "drums",
        "bass": "bass", "sub": "bass", "808": "bass",
        "lead": "lead", "melody": "lead", "solo": "lead",
        "arp": "arp", "seq": "arp", "acid": "arp",
        "pad": "pad", "chord": "pad", "atmo": "pad", "string": "pad",
    }
    for k, v in hints.items():
        if k in lname:
            return v, 0.95

    if channel == 9:  # GM percussion channel
        return "drums", 0.98

    tpq = md.tpq or 480
    bars = max(1, md.length_bars())
    pitches = [n.pitch for n in notes]
    med = _median([float(p) for p in pitches])
    avg_poly, _peak = _polyphony(notes)
    npb = len(notes) / float(bars)
    avg_dur_beats = sum(n.dur for n in notes) / float(len(notes)) / float(tpq)
    span = max(pitches) - min(pitches)

    # Accents / one-shots (orch hits, reverse cymbals, single stabs) look like
    # leads by register but carry no melody. Calling them "lead" makes the
    # generator pick a 6-note stab as the source phrase — classify them as fx.
    if len(notes) < 8 or npb < 0.35:
        return "fx", 0.75

    # Pad/chord: many voices at once, long sustains
    if avg_poly >= 2.4 and avg_dur_beats >= 1.0:
        return "pad", min(1.0, 0.55 + avg_poly * 0.1)
    # Bass: low register, near-monophonic
    if med <= 50 and avg_poly < 2.0:
        return "bass", min(1.0, 0.6 + (52 - med) * 0.02)
    # Arp: dense, short, mostly mono, narrow-ish steps
    if npb >= 10 and avg_dur_beats <= 0.35 and avg_poly < 1.7:
        return "arp", min(1.0, 0.55 + npb * 0.015)
    # Lead: mid/high register, melodic phrasing
    if med >= 55 and avg_poly < 2.0:
        return "lead", 0.7 if span > 5 else 0.6
    if avg_poly >= 2.0:
        return "pad", 0.55
    return "lead", 0.4


# ---------------------------------------------------------------------------
# Groove / velocity / density profiling
# ---------------------------------------------------------------------------


def groove_profile(notes: list[Note], md: MidiData) -> dict[str, Any]:
    """16th-grid onset histogram, swing estimate, syncopation, timing spread."""
    tpq = md.tpq or 480
    step = max(1, tpq // 4)  # one 16th
    grid = [0] * 16
    offsets: list[int] = []
    for n in notes:
        pos_in_bar = n.start % md.ticks_per_bar
        idx = int(pos_in_bar // step) % 16
        grid[idx] += 1
        near = round(n.start / float(step)) * step
        offsets.append(n.start - near)

    total = sum(grid) or 1
    downbeats = grid[0] + grid[4] + grid[8] + grid[12]
    offbeat_8 = grid[2] + grid[6] + grid[10] + grid[14]
    offbeat_16 = grid[1] + grid[3] + grid[5] + grid[7] + grid[9] + grid[11] + grid[13] + grid[15]

    # Swing: are odd 16ths pushed late on average?
    late = [o for o in offsets if o > 0]
    swing = (sum(late) / len(late) / float(step)) if late else 0.0

    dev = [abs(o) for o in offsets]
    mean_dev = sum(dev) / len(dev) if dev else 0.0

    return {
        "grid_16": grid,
        "downbeat_ratio": round(downbeats / total, 3),
        "offbeat_8_ratio": round(offbeat_8 / total, 3),
        "offbeat_16_ratio": round(offbeat_16 / total, 3),
        "syncopation": round((offbeat_8 + offbeat_16) / total, 3),
        "swing_estimate": round(min(1.0, swing), 3),
        "timing_deviation_ticks": round(mean_dev, 2),
        "timing_deviation_ms": round(md.ticks_to_seconds(int(mean_dev)) * 1000.0, 2),
        "is_quantized": mean_dev < (step * 0.04),
    }


def velocity_profile(notes: list[Note]) -> dict[str, float]:
    if not notes:
        return {"mean": 0, "min": 0, "max": 0, "stdev": 0, "humanization": 0}
    vels = [float(n.velocity) for n in notes]
    mean = sum(vels) / len(vels)
    var = sum((v - mean) ** 2 for v in vels) / len(vels)
    sd = math.sqrt(var)
    return {
        "mean": round(mean, 1),
        "min": int(min(vels)),
        "max": int(max(vels)),
        "stdev": round(sd, 2),
        # 0 = fully static (machine), 1 = heavily humanized
        "humanization": round(min(1.0, sd / 24.0), 3),
    }


def root_progression(md: MidiData, profiles: list[TrackProfile], bars: int) -> list[dict[str, Any]]:
    """Per-bar root: prefer the bass track, else the lowest sounding note."""
    tpb = md.ticks_per_bar
    bass_idx = [p.index for p in profiles if p.role == "bass"]
    source: list[Note] = []
    if bass_idx:
        source = list(md.tracks[bass_idx[0]].notes)
    else:
        source = harmonic_notes(md)  # never let drums define the roots

    out: list[dict[str, Any]] = []
    for b in range(bars):
        lo, hi = b * tpb, (b + 1) * tpb
        in_bar = [n for n in source if lo <= n.start < hi]
        if not in_bar:
            prev = out[-1]["root"] if out else None
            out.append({"bar": b + 1, "root": prev, "root_name": PITCH_NAMES[prev % 12] if prev is not None else None, "held": True})
            continue
        # Weight each pitch class by duration; lowest-octave notes win ties
        weights: dict[int, float] = {}
        for n in in_bar:
            weights[n.pitch % 12] = weights.get(n.pitch % 12, 0.0) + n.dur * (1.5 if n.pitch < 52 else 1.0)
        root_pc = max(weights.items(), key=lambda kv: kv[1])[0]
        out.append(
            {
                "bar": b + 1,
                "root": root_pc,
                "root_name": PITCH_NAMES[root_pc],
                "held": False,
            }
        )
    return out


# ---------------------------------------------------------------------------
# Top-level
# ---------------------------------------------------------------------------


def analyze(md: MidiData) -> Analysis:
    all_notes = md.all_notes()
    bars = md.length_bars()
    tpq = md.tpq or 480

    # Key detection sees pitched material only — drum maps would swamp it.
    root, scale, conf, alts = detect_key(harmonic_notes(md), tpq)

    profiles: list[TrackProfile] = []
    for i, t in enumerate(md.tracks):
        notes = t.sorted_notes()
        if not notes:
            continue
        role, rconf = classify_role(notes, md, t.name, t.channel)
        t.role = role
        avg_poly, peak = _polyphony(notes)
        pitches = [float(n.pitch) for n in notes]
        avg_dur = sum(n.dur for n in notes) / float(len(notes))
        # Legato: how often a note still sounds when the next one starts
        overlaps = 0
        srt = sorted(notes, key=lambda n: n.start)
        for a, b in zip(srt, srt[1:]):
            if a.end > b.start:
                overlaps += 1
        profiles.append(
            TrackProfile(
                index=i,
                name=t.name,
                role=role,
                confidence=rconf,
                channel=t.channel,
                note_count=len(notes),
                pitch_min=int(min(pitches)),
                pitch_max=int(max(pitches)),
                pitch_median=_median(pitches),
                avg_polyphony=avg_poly,
                max_polyphony=peak,
                notes_per_bar=len(notes) / float(bars),
                avg_dur_beats=avg_dur / float(tpq),
                legato_ratio=overlaps / float(max(1, len(srt) - 1)),
                velocity=velocity_profile(notes),
                groove=groove_profile(notes, md),
            )
        )

    npb_total = len(all_notes) / float(bars)
    density = "sparse" if npb_total < 6 else "medium" if npb_total < 18 else "dense"
    energy = min(1.0, (md.bpm - 100.0) / 60.0 * 0.6 + min(1.0, npb_total / 24.0) * 0.4)

    return Analysis(
        bpm=md.bpm,
        tpq=tpq,
        bars=bars,
        time_signature=f"{md.numerator}/{md.denominator}",
        key_root=root,
        key_name=PITCH_NAMES[root],
        scale=scale,
        key_confidence=conf,
        scale_pitches=scale_pitch_classes(root, scale),
        key_alternatives=alts,
        tracks=profiles,
        root_progression=root_progression(md, profiles, bars),
        density=density,
        energy=max(0.0, energy),
    )
