"""Generate a small starter pack of arps so the panel has something to match.

These are plain MIDI files with correct tempo and key-signature metadata, named
the way the library scanner expects. They are a scaffold to test the workflow and
to replace with your own arps — not a sound library.
"""
import os

from .analysis import PITCH_NAMES
from .smf import write

# (label, semitone offsets from the tonic, mode)
SHAPES = [
    ("Up 16ths", [0, 3, 7, 12, 7, 3], "minor"),
    ("Wide Octaves", [0, 12, 7, 19, 12, 24], "minor"),
    ("Pluck Triplets", [0, 7, 12, 15, 12, 7], "minor"),
    ("Bright Up-Down", [0, 4, 7, 11, 14, 11, 7, 4], "major"),
    ("Sus Climb", [0, 5, 7, 12, 17, 19], "major"),
]

# Sharps in the key signature for each major tonic, per the circle of fifths.
_MAJOR_SHARPS = {0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 5: -1, 10: -2, 3: -3, 8: -4, 1: -5}

PRESETS = [
    (124.0, 9, "minor"),    # A minor  — house / melodic techno
    (128.0, 5, "minor"),    # F minor
    (140.0, 2, "minor"),    # D minor  — trap / halftime
    (150.0, 7, "major"),    # G major
    (174.0, 0, "minor"),    # C minor  — dnb
    (90.0, 4, "major"),     # E major  — hip hop
]


def _pattern(offsets, tonic, bars=2, step=0.25, octave=5):
    """Lay the shape out as a repeating step sequence."""
    base = 12 * octave + tonic  # MIDI note number of the tonic
    notes = []
    steps = int(bars * 4 / step)
    for i in range(steps):
        pitch = base + offsets[i % len(offsets)]
        velocity = 104 if i % 4 == 0 else 84
        notes.append((i * step, step * 0.92, pitch, velocity))
    return notes


def build(target_dir, overwrite=False):
    """Write the starter arps. Returns the list of paths created."""
    os.makedirs(target_dir, exist_ok=True)
    created = []

    for bpm, tonic, preset_mode in PRESETS:
        for label, offsets, shape_mode in SHAPES:
            if shape_mode != preset_mode:
                continue
            key_name = PITCH_NAMES[tonic]
            suffix = "min" if preset_mode == "minor" else "maj"
            filename = f"{label} {int(bpm)}bpm {key_name}{suffix}.mid"
            path = os.path.join(target_dir, filename)
            if os.path.exists(path) and not overwrite:
                continue

            if preset_mode == "minor":
                # A minor key signature is written as its relative major.
                relative_major = (tonic + 3) % 12
                sharps = _MAJOR_SHARPS.get(relative_major, 0)
            else:
                sharps = _MAJOR_SHARPS.get(tonic, 0)

            write(
                path,
                _pattern(offsets, tonic),
                bpm=bpm,
                key_signature=(sharps, preset_mode == "minor"),
                name=f"{label} — {key_name} {preset_mode}",
            )
            created.append(path)

    return created
