"""Shared fixtures: synthetic audio and MIDI with known tempo and key."""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dawmatch.analysis import PITCH_NAMES, SAMPLE_RATE  # noqa: E402
from dawmatch.smf import write as write_midi  # noqa: E402

# Chord voicings as (frequency, amplitude), root-emphasised like a real mix.
CHORDS = {
    "A minor": [(110.00, 0.60), (220.00, 0.40), (261.63, 0.35), (329.63, 0.35)],
    "C major": [(130.81, 0.60), (261.63, 0.40), (329.63, 0.35), (392.00, 0.35)],
    "F# minor": [(92.50, 0.60), (185.00, 0.40), (220.00, 0.35), (277.18, 0.35)],
    "G major": [(98.00, 0.60), (196.00, 0.40), (246.94, 0.35), (293.66, 0.35)],
    "D minor": [(73.42, 0.60), (146.83, 0.40), (174.61, 0.35), (220.00, 0.35)],
}


def make_track(bpm=128.0, chord="A minor", seconds=12.0, sample_rate=SAMPLE_RATE, seed=7):
    """A click track at `bpm` over a sustained chord — known tempo and key."""
    total = int(sample_rate * seconds)
    t = np.arange(total) / sample_rate
    signal = np.zeros(total, dtype=np.float64)

    beat = 60.0 / bpm
    rng = np.random.default_rng(seed)
    burst = 600
    envelope = np.exp(-np.arange(burst) / 50.0)
    for i in range(int(seconds / beat)):
        start = int(i * beat * sample_rate)
        end = min(start + burst, total)
        if end > start:
            noise = rng.standard_normal(end - start) * 0.6
            signal[start:end] += noise * envelope[: end - start]

    for freq, amp in CHORDS.get(chord, CHORDS["A minor"]):
        for harmonic in range(4):
            signal += amp / (harmonic + 1) * np.sin(2 * np.pi * freq * (harmonic + 1) * t)

    peak = np.max(np.abs(signal))
    if peak > 0:
        signal = signal / peak * 0.9
    return signal.astype(np.float32)


def make_arp_midi(path, bpm=128.0, tonic=9, mode="minor", bars=2, key_signature=None):
    """Write a simple arp whose notes spell the requested triad."""
    intervals = [0, 3, 7, 12] if mode == "minor" else [0, 4, 7, 12]
    base = 60 + tonic
    notes = []
    steps = int(bars * 16)
    for i in range(steps):
        notes.append((i * 0.25, 0.23, base + intervals[i % len(intervals)], 100))
    return write_midi(path, notes, bpm=bpm, key_signature=key_signature,
                      name=f"{PITCH_NAMES[tonic]} {mode}")


def write_wav_loop(path, bpm=128.0, chord="A minor", seconds=6.0):
    """A short audio loop on disk, for library scanning tests."""
    from dawmatch.audioio import write_wav

    samples = make_track(bpm=bpm, chord=chord, seconds=seconds)
    return write_wav(path, samples, sample_rate=SAMPLE_RATE)
