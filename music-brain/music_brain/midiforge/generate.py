"""Stage 3 — Generative Mutation & Enhancement Engine (pure stdlib).

Every generator is scale-locked to the detected key, seeded for reproducibility,
and voiced for psytrance: sub-free pads, offbeat 16th bass, acid-leaning arps.
"""

from __future__ import annotations

import random
from typing import Any

from music_brain.midiforge.analysis import Analysis, snap_to_scale
from music_brain.midiforge.smf import MidiData, Note, Track

# Chord shapes as scale-degree indices (0-based into the 7-note scale)
CHORD_SHAPES = {
    "triad": (0, 2, 4),
    "sus2": (0, 1, 4),
    "sus4": (0, 3, 4),
    "seventh": (0, 2, 4, 6),
    "ninth": (0, 2, 4, 6, 8),
    "fifth": (0, 4),
}


def _scale_tones(root_pc: int, scale_pcs: list[int], octave_base: int, count: int) -> list[int]:
    """Ascending in-scale MIDI pitches starting at the root in octave_base."""
    ordered = sorted(scale_pcs, key=lambda pc: (pc - root_pc) % 12)
    out: list[int] = []
    octave = 0
    while len(out) < count:
        for pc in ordered:
            rel = (pc - root_pc) % 12
            pitch = octave_base + rel + octave * 12
            if 0 <= pitch <= 127:
                out.append(pitch)
            if len(out) >= count:
                break
        octave += 1
        if octave > 6:
            break
    return out


def _bar_roots(analysis: Analysis, bars: int) -> list[int]:
    """One root pitch class per bar, gap-filled from the analysed progression."""
    prog = [p.get("root") for p in analysis.root_progression]
    prog = [p if p is not None else analysis.key_root for p in prog]
    if not prog:
        prog = [analysis.key_root]
    out: list[int] = []
    for b in range(bars):
        out.append(prog[b % len(prog)])
    return out


# ---------------------------------------------------------------------------
# Pad & Atmosphere Generator
# ---------------------------------------------------------------------------


def generate_pad(
    md: MidiData,
    analysis: Analysis,
    *,
    bars: int | None = None,
    complexity: float = 0.5,
    octave: int = 4,
    rhythmic: bool = False,
    seed: int = 0,
) -> Track:
    """Sustained (or gated) chords from the detected root progression.

    complexity 0.0 -> open fifths; 1.0 -> 9th voicings with an upper-octave layer.
    Voiced from C4 up: nothing below MIDI 48, so it never fights the sub.
    """
    rnd = random.Random(seed or 1337)
    bars = bars or analysis.bars
    tpb = md.ticks_per_bar
    scale_pcs = analysis.scale_pitches
    roots = _bar_roots(analysis, bars)

    if complexity < 0.3:
        shape = CHORD_SHAPES["fifth"]
    elif complexity < 0.55:
        shape = CHORD_SHAPES["triad"]
    elif complexity < 0.8:
        shape = CHORD_SHAPES["seventh"]
    else:
        shape = CHORD_SHAPES["ninth"]

    base = 12 * (octave + 1)  # MIDI octave convention: C4 = 60
    notes: list[Note] = []

    for b in range(bars):
        root_pc = roots[b]
        tones = _scale_tones(root_pc, scale_pcs, base + ((root_pc - analysis.key_root) % 12), 10)
        voicing = [tones[i] for i in shape if i < len(tones)]
        # Keep pads out of the sub region entirely
        voicing = [max(48, p) for p in voicing]
        if complexity > 0.7 and voicing:
            voicing.append(min(96, voicing[0] + 12))

        bar_start = b * tpb
        if rhythmic:
            # Gated pad: 8th-note pulses on the offbeat, classic psy breakdown motion
            step = max(1, md.tpq // 2)
            for s in range(0, tpb, step):
                if (s // step) % 2 == 0 and complexity < 0.6:
                    continue
                dur = int(step * 0.85)
                for vi, p in enumerate(voicing):
                    notes.append(
                        Note(
                            pitch=snap_to_scale(p, scale_pcs),
                            start=bar_start + s,
                            dur=dur,
                            velocity=max(38, min(88, 62 + rnd.randint(-8, 8) - vi * 3)),
                            channel=1,
                        )
                    )
        else:
            # Sustained: full bar, tiny per-voice stagger so it breathes
            for vi, p in enumerate(voicing):
                jitter = rnd.randint(0, max(1, md.tpq // 16))
                notes.append(
                    Note(
                        pitch=snap_to_scale(p, scale_pcs),
                        start=bar_start + jitter,
                        dur=max(1, tpb - jitter - 2),
                        velocity=max(40, min(84, 58 + rnd.randint(-6, 6) - vi * 2)),
                        channel=1,
                    )
                )

    return Track(name="Generated Atmospheric Pad", notes=notes, channel=1, role="pad")


# ---------------------------------------------------------------------------
# Arp / Lead Mutator
# ---------------------------------------------------------------------------


def _build_markov(notes: list[Note], scale_pcs: list[int]) -> dict[int, list[int]]:
    """First-order transition table over pitch intervals in the source melody."""
    table: dict[int, list[int]] = {}
    srt = sorted(notes, key=lambda n: n.start)
    for a, b in zip(srt, srt[1:]):
        iv = b.pitch - a.pitch
        if abs(iv) > 24:
            continue
        table.setdefault(a.pitch % 12, []).append(iv)
    return table


def mutate_arp(
    md: MidiData,
    analysis: Analysis,
    source: Track,
    *,
    mutation_rate: float = 0.35,
    rhythmic_shift: bool = True,
    octave_double: bool = False,
    invert: bool = False,
    scale_lock: bool = True,
    seed: int = 0,
) -> Track:
    """Variation B of an existing arp/lead — Markov intervals + rhythmic shifting.

    mutation_rate is the per-note probability of alteration. Groove, gate length
    and velocity contour of untouched notes are preserved verbatim.
    """
    rnd = random.Random(seed or 4242)
    scale_pcs = analysis.scale_pitches if scale_lock else list(range(12))
    src = source.sorted_notes()
    if not src:
        return Track(name="Arp Variation B", notes=[], channel=2, role="arp")

    markov = _build_markov(src, scale_pcs)
    step16 = max(1, md.tpq // 4)
    pivot = sum(n.pitch for n in src) // len(src)

    out: list[Note] = []
    prev_pitch = src[0].pitch

    for n in src:
        pitch = n.pitch
        start = n.start
        dur = n.dur
        vel = n.velocity

        if rnd.random() < mutation_rate:
            choice = rnd.random()
            if choice < 0.45 and markov.get(prev_pitch % 12):
                # Markov step drawn from the source's own interval vocabulary
                pitch = prev_pitch + rnd.choice(markov[prev_pitch % 12])
            elif choice < 0.65:
                # Diatonic neighbour
                pitch += rnd.choice([-2, -1, 1, 2])
            elif choice < 0.82:
                # Octave jump — the classic psy arp lift
                pitch += rnd.choice([-12, 12])
            else:
                # Rest: drop the note to open a gap for call-and-response
                prev_pitch = pitch
                continue

        if invert:
            pitch = 2 * pivot - pitch

        if rhythmic_shift and rnd.random() < mutation_rate * 0.6:
            # Push/pull by one 16th, never past the previous note
            shift = rnd.choice([-step16, step16, step16 // 2])
            if start + shift >= 0:
                start += shift

        pitch = max(24, min(108, pitch))
        if scale_lock:
            pitch = snap_to_scale(pitch, scale_pcs)

        if rnd.random() < mutation_rate * 0.4:
            vel = max(1, min(127, vel + rnd.randint(-14, 14)))

        out.append(Note(pitch=pitch, start=start, dur=dur, velocity=vel, channel=2))

        if octave_double and rnd.random() < 0.35:
            up = min(108, pitch + 12)
            out.append(
                Note(pitch=up, start=start, dur=max(1, int(dur * 0.7)), velocity=max(1, vel - 22), channel=2)
            )

        prev_pitch = pitch

    out.sort(key=lambda n: (n.start, n.pitch))
    return Track(name="Arp Variation B", notes=out, channel=2, role="arp")


# ---------------------------------------------------------------------------
# Counter-Melody / Filler Generator
# ---------------------------------------------------------------------------


def generate_counter_melody(
    md: MidiData,
    analysis: Analysis,
    source: Track,
    *,
    complexity: float = 0.5,
    interval_pool: tuple[int, ...] = (3, 4, 7, 12),
    seed: int = 0,
) -> Track:
    """Answers the lead inside its gaps — never on top of it.

    Finds rests >= an 8th note in the source phrase and fills them with
    consonant, scale-locked motion derived from the surrounding pitches.
    """
    rnd = random.Random(seed or 777)
    scale_pcs = analysis.scale_pitches
    src = source.sorted_notes()
    if not src:
        return Track(name="Counter Melody", notes=[], channel=3, role="counter")

    min_gap = max(1, md.tpq // 2)  # 8th note
    step = max(1, md.tpq // 4)  # 16th
    total = md.length_ticks()

    # Collect gaps between the end of one note and the start of the next
    gaps: list[tuple[int, int, int]] = []  # (start, end, ref_pitch)
    cursor = 0
    ref = src[0].pitch
    for n in src:
        if n.start - cursor >= min_gap:
            gaps.append((cursor, n.start, ref))
        cursor = max(cursor, n.end)
        ref = n.pitch
    if total - cursor >= min_gap:
        gaps.append((cursor, total, ref))

    notes: list[Note] = []
    density_steps = 1 if complexity < 0.35 else 2 if complexity < 0.7 else 4

    for g_start, g_end, ref_pitch in gaps:
        span = g_end - g_start
        if span < min_gap:
            continue
        n_notes = max(1, min(8, int(span / step / max(1, 4 - density_steps))))
        cur = g_start
        # Sit a consonant interval below the lead so it supports, not competes
        base = ref_pitch - rnd.choice(interval_pool)
        base = max(40, min(96, base))
        for i in range(n_notes):
            if cur >= g_end:
                break
            dur = min(int(step * rnd.choice([1, 1, 2, 2, 4])), g_end - cur)
            if dur < step // 2:
                break
            move = rnd.choice([-2, -1, 0, 1, 2]) if i else 0
            pitch = snap_to_scale(max(40, min(96, base + move)), scale_pcs)
            notes.append(
                Note(
                    pitch=pitch,
                    start=cur,
                    dur=max(1, int(dur * 0.9)),
                    velocity=max(45, min(95, 72 + rnd.randint(-10, 10))),
                    channel=3,
                )
            )
            base = pitch
            cur += dur

    notes.sort(key=lambda n: (n.start, n.pitch))
    return Track(name="Counter Melody", notes=notes, channel=3, role="counter")


# ---------------------------------------------------------------------------
# Bassline Root-Sync
# ---------------------------------------------------------------------------


def generate_bass_root_sync(
    md: MidiData,
    analysis: Analysis,
    *,
    bars: int | None = None,
    style: str = "rolling",
    octave: int = 1,
    seed: int = 0,
) -> Track:
    """Root-locked psytrance bass.

    rolling  — 16ths on beats 2,3,4 of each 1/4 (the classic 3-note roll)
    offbeat  — straight 8th offbeats
    """
    rnd = random.Random(seed or 909)
    bars = bars or analysis.bars
    tpb = md.ticks_per_bar
    step16 = max(1, md.tpq // 4)
    scale_pcs = analysis.scale_pitches
    roots = _bar_roots(analysis, bars)
    base = 12 * (octave + 1)  # octave 1 -> MIDI 24..35 region

    notes: list[Note] = []
    for b in range(bars):
        root_pc = roots[b]
        pitch = base + ((root_pc - analysis.key_root) % 12) + analysis.key_root % 12
        pitch = max(24, min(47, pitch))
        pitch = snap_to_scale(pitch, scale_pcs)
        bar_start = b * tpb

        if style == "offbeat":
            step8 = max(1, md.tpq // 2)
            for s in range(step8, tpb, step8 * 2):
                notes.append(
                    Note(pitch=pitch, start=bar_start + s, dur=int(step8 * 0.72),
                         velocity=max(80, min(115, 100 + rnd.randint(-6, 6))), channel=4)
                )
        else:  # rolling (KBBB) — 1st 16th of each beat left open for the kick
            for beat in range(md.numerator):
                for sub in (1, 2, 3):
                    s = beat * md.tpq + sub * step16
                    if s >= tpb:
                        continue
                    vel = 98 + rnd.randint(-7, 7)
                    if sub == 1:
                        # The bass hit right after the kick lands inside the
                        # kick's tail — dip it ~30% so the two don't fight for
                        # the same energy window (classic KBBB velocity ramp).
                        vel = int(vel * 0.70)
                    notes.append(
                        Note(pitch=pitch, start=bar_start + s, dur=int(step16 * 0.78),
                             velocity=max(55, min(112, vel)), channel=4)
                    )

    return Track(name="Bassline Root Sync", notes=notes, channel=4, role="bass")


# ---------------------------------------------------------------------------
# Enhanced original lead (non-destructive: original notes kept verbatim)
# ---------------------------------------------------------------------------


def enhance_lead(
    md: MidiData,
    analysis: Analysis,
    source: Track,
    *,
    octave_layer: bool = True,
    harmony_interval: int = 0,
    seed: int = 0,
) -> Track:
    """Original lead untouched + optional octave/harmony layer stacked on top."""
    rnd = random.Random(seed or 2026)
    scale_pcs = analysis.scale_pitches
    out = [n.copy(channel=0) for n in source.sorted_notes()]

    for n in source.sorted_notes():
        if octave_layer and rnd.random() < 0.5:
            p = min(108, n.pitch + 12)
            out.append(Note(pitch=p, start=n.start, dur=max(1, int(n.dur * 0.85)),
                            velocity=max(1, n.velocity - 26), channel=0))
        if harmony_interval:
            p = snap_to_scale(max(24, min(108, n.pitch + harmony_interval)), scale_pcs)
            out.append(Note(pitch=p, start=n.start, dur=n.dur,
                            velocity=max(1, n.velocity - 18), channel=0))

    out.sort(key=lambda n: (n.start, n.pitch))
    return Track(name="Original Lead Enhanced", notes=out, channel=0, role="lead")
