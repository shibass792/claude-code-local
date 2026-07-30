"""Tempo, key and energy detection — numpy only, no librosa.

Tempo follows the classic onset-envelope autocorrelation approach: spectral flux
gives a percussive envelope, autocorrelation finds its period, and a log-normal
prior centred on 120 BPM breaks the half/double-time ties that autocorrelation
alone cannot resolve. Key uses a chroma vector correlated against the
Krumhansl-Schmuckler profiles.
"""
import math

import numpy as np

from .audioio import SAMPLE_RATE

FRAME = 1024
HOP = 256

# Chroma needs far finer frequency resolution than onset detection does: at
# 22050 Hz a 1024-sample frame spans 21.5 Hz per bin, which is wider than a
# semitone anywhere below ~350 Hz. 8192 samples brings that to 2.7 Hz so bass
# and mid harmony land in the right pitch class.
CHROMA_FRAME = 8192
CHROMA_HOP = 2048
CHROMA_LOW_MIDI = 36   # C2
CHROMA_HIGH_MIDI = 96  # C7

PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl-Schmuckler key profiles (C major / C minor, rotated per key).
KS_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KS_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

TEMPO_MIN = 60.0
TEMPO_MAX = 200.0
TEMPO_PRIOR_CENTER = 120.0
TEMPO_PRIOR_WIDTH = 0.9  # in octaves


def _frames(samples, frame=FRAME, hop=HOP):
    if samples.size < frame:
        samples = np.pad(samples, (0, frame - samples.size))
    count = 1 + (samples.size - frame) // hop
    idx = np.arange(frame)[None, :] + hop * np.arange(count)[:, None]
    return samples[idx]


def spectrogram(samples, frame=FRAME, hop=HOP):
    """Magnitude spectrogram, shape (frames, frame // 2 + 1)."""
    window = np.hanning(frame).astype(np.float32)
    return np.abs(np.fft.rfft(_frames(samples, frame, hop) * window, axis=1))


def onset_envelope(magnitudes):
    """Half-wave-rectified spectral flux, mean-removed and normalised."""
    log_mag = np.log1p(magnitudes * 20.0)
    flux = np.diff(log_mag, axis=0)
    env = np.maximum(flux, 0.0).sum(axis=1)
    if env.size == 0:
        return env
    # Subtract a local mean so a loud section does not dominate the correlation.
    win = 16
    kernel = np.ones(win) / win
    local = np.convolve(env, kernel, mode="same")
    env = np.maximum(env - local, 0.0)
    peak = env.max()
    return env / peak if peak > 0 else env


def detect_tempo(samples, sample_rate=SAMPLE_RATE):
    """Return (bpm, confidence in 0..1)."""
    env = onset_envelope(spectrogram(samples))
    if env.size < 32:
        return 0.0, 0.0

    fps = sample_rate / HOP
    env = env - env.mean()
    n = int(2 ** math.ceil(math.log2(env.size * 2)))
    spec = np.fft.rfft(env, n)
    auto = np.fft.irfft(spec * np.conj(spec), n)[: env.size]
    if auto[0] <= 0:
        return 0.0, 0.0
    auto = auto / auto[0]

    candidates = np.arange(TEMPO_MIN, TEMPO_MAX + 0.5, 0.5)
    lags = fps * 60.0 / candidates
    valid = (lags >= 2) & (lags < env.size - 1)
    candidates, lags = candidates[valid], lags[valid]
    if candidates.size == 0:
        return 0.0, 0.0

    # Linear interpolation of the autocorrelation at fractional lags.
    low = np.floor(lags).astype(int)
    frac = lags - low
    strength = auto[low] * (1 - frac) + auto[np.minimum(low + 1, env.size - 1)] * frac

    # Reinforce with the 2x and 4x lags: a true beat period also correlates at
    # its multiples, which suppresses spurious peaks between real beats.
    for mult in (2, 4):
        mlags = lags * mult
        ok = mlags < env.size - 1
        ml = np.floor(mlags[ok]).astype(int)
        mf = mlags[ok] - ml
        strength[ok] += 0.5 / mult * (
            auto[ml] * (1 - mf) + auto[np.minimum(ml + 1, env.size - 1)] * mf
        )

    prior = np.exp(-0.5 * (np.log2(candidates / TEMPO_PRIOR_CENTER) / TEMPO_PRIOR_WIDTH) ** 2)
    score = strength * prior
    best = int(np.argmax(score))
    bpm = _refine_peak(candidates, score, best)

    spread = float(np.mean(score)) if score.size else 0.0
    top = float(score[best])
    confidence = 0.0 if top <= 0 else max(0.0, min(1.0, (top - spread) / top))
    return round(bpm, 1), round(confidence, 3)


def _refine_peak(x, y, index):
    """Parabolic interpolation through the peak and its two neighbours."""
    if index <= 0 or index >= len(y) - 1:
        return float(x[index])
    left, mid, right = float(y[index - 1]), float(y[index]), float(y[index + 1])
    denom = left - 2 * mid + right
    if denom == 0:
        return float(x[index])
    offset = 0.5 * (left - right) / denom
    if not -1.0 < offset < 1.0:
        return float(x[index])
    step = float(x[index + 1] - x[index])
    return float(x[index]) + offset * step


def chroma_vector(samples, sample_rate=SAMPLE_RATE):
    """12-bin pitch-class energy profile, normalised to sum 1.

    Each tempered semitone from C2 to C7 gets its own band; the energy in that
    band is folded into its pitch class. Working per-note rather than per-FFT-bin
    keeps low notes from bleeding into their neighbours.
    """
    mags = spectrogram(samples, CHROMA_FRAME, CHROMA_HOP)
    if mags.size == 0:
        return np.zeros(12)
    # Median across time is far more robust than the mean: it ignores one-off
    # transients and reflects the harmony that is actually sustained.
    spectrum = np.median(mags, axis=0)
    freqs = np.fft.rfftfreq(CHROMA_FRAME, 1.0 / sample_rate)

    chroma = np.zeros(12)
    for note in range(CHROMA_LOW_MIDI, CHROMA_HIGH_MIDI + 1):
        center = 440.0 * (2.0 ** ((note - 69) / 12.0))
        low = center * (2.0 ** (-0.55 / 12.0))
        high = center * (2.0 ** (0.55 / 12.0))
        band = (freqs >= low) & (freqs <= high)
        if not band.any():
            continue
        # Triangular weighting inside the band so a pitch a quarter-tone off
        # counts less than one that is dead centre.
        weight = 1.0 - np.abs(np.log2(freqs[band] / center)) * 24.0
        chroma[note % 12] += float(np.sum(spectrum[band] * np.clip(weight, 0.0, 1.0)))

    total = chroma.sum()
    return chroma / total if total > 0 else chroma


def detect_key(samples, sample_rate=SAMPLE_RATE):
    """Return (key name like 'A minor', tonic index, mode, confidence)."""
    chroma = chroma_vector(samples, sample_rate)
    return key_from_chroma(chroma)


def key_from_chroma(chroma):
    chroma = np.asarray(chroma, dtype=float)
    if chroma.sum() <= 0:
        return "unknown", -1, "", 0.0

    scores = []
    for tonic in range(12):
        rotated = np.roll(chroma, -tonic)
        for mode, profile in (("major", KS_MAJOR), ("minor", KS_MINOR)):
            scores.append((_pearson(rotated, profile), tonic, mode))
    scores.sort(reverse=True)

    best, tonic, mode = scores[0]
    runner = scores[1][0]
    confidence = max(0.0, min(1.0, best - runner)) if best > 0 else 0.0
    return f"{PITCH_NAMES[tonic]} {mode}", tonic, mode, round(confidence, 3)


def _pearson(a, b):
    a = a - a.mean()
    b = b - b.mean()
    denom = math.sqrt(float(np.dot(a, a)) * float(np.dot(b, b)))
    return float(np.dot(a, b) / denom) if denom > 0 else 0.0


def energy_profile(samples, sample_rate=SAMPLE_RATE):
    """Loudness and brightness, both normalised to roughly 0..1."""
    rms = float(np.sqrt(np.mean(np.square(samples)))) if samples.size else 0.0
    mags = spectrogram(samples)
    freqs = np.fft.rfftfreq(FRAME, 1.0 / sample_rate)
    total = mags.sum(axis=1)
    active = total > 0
    if active.any():
        centroid = float(np.mean((mags[active] * freqs).sum(axis=1) / total[active]))
    else:
        centroid = 0.0
    return {
        "rms": round(rms, 4),
        # Log scale so a doubling of loudness moves the number, not the decimals.
        "loudness": round(max(0.0, min(1.0, (20 * math.log10(rms + 1e-9) + 60) / 60)), 3),
        "centroid_hz": round(centroid, 1),
        # 4 kHz is a practical ceiling for "bright" in mixed music.
        "brightness": round(max(0.0, min(1.0, centroid / 4000.0)), 3),
    }


def analyze(samples, sample_rate=SAMPLE_RATE):
    """Full fingerprint of a clip."""
    bpm, bpm_conf = detect_tempo(samples, sample_rate)
    key, tonic, mode, key_conf = detect_key(samples, sample_rate)
    profile = energy_profile(samples, sample_rate)
    return {
        "bpm": bpm,
        "bpm_confidence": bpm_conf,
        "key": key,
        "tonic": tonic,
        "mode": mode,
        "key_confidence": key_conf,
        "duration": round(samples.size / sample_rate, 2),
        **profile,
    }
