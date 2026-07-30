"""Spectral DSP primitives, implemented with numpy only.

Everything stage 3 asks for that lives in the frequency domain is here: STFT,
mel spectrogram, MFCC, chroma, tonnetz, spectral contrast, roll-off, and pitch
estimation. Written to be dependency-light on purpose — no librosa, no scipy —
so the engine installs on a studio machine without a build toolchain.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

EPS = 1e-10
A4_HZ = 440.0
NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")


@dataclass
class Spectrogram:
    """Magnitude STFT plus the axes needed to interpret it."""

    magnitude: np.ndarray  # (bins, frames)
    freqs: np.ndarray  # (bins,)
    times: np.ndarray  # (frames,)
    sample_rate: int
    hop: int
    n_fft: int

    @property
    def power(self) -> np.ndarray:
        return self.magnitude**2

    @property
    def n_frames(self) -> int:
        return int(self.magnitude.shape[1])


def frame_signal(x: np.ndarray, frame_length: int, hop: int) -> np.ndarray:
    """Split a signal into overlapping frames, shape ``(frames, frame_length)``."""
    if x.size < frame_length:
        pad = np.zeros(frame_length - x.size, dtype=np.float32)
        x = np.concatenate([x, pad])
    n_frames = 1 + (x.size - frame_length) // hop
    idx = np.arange(frame_length)[None, :] + hop * np.arange(n_frames)[:, None]
    return x[idx]


def stft(
    x: np.ndarray,
    sample_rate: int,
    n_fft: int = 2048,
    hop: int | None = None,
    window: str = "hann",
) -> Spectrogram:
    hop = hop or n_fft // 4
    x = np.asarray(x, dtype=np.float32)
    frames = frame_signal(x, n_fft, hop)
    if window == "hann":
        win = np.hanning(n_fft).astype(np.float32)
    else:  # pragma: no cover - only hann is used today
        win = np.ones(n_fft, dtype=np.float32)
    spec = np.fft.rfft(frames * win, axis=1)
    magnitude = np.abs(spec).T.astype(np.float32) * (2.0 / np.sum(win))
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sample_rate)
    times = (np.arange(magnitude.shape[1]) * hop + n_fft / 2) / float(sample_rate)
    return Spectrogram(magnitude, freqs, times, sample_rate, hop, n_fft)


# ---------------------------------------------------------------------------
# mel / mfcc
# ---------------------------------------------------------------------------


def hz_to_mel(hz: np.ndarray | float) -> np.ndarray | float:
    return 2595.0 * np.log10(1.0 + np.asarray(hz, dtype=np.float64) / 700.0)


def mel_to_hz(mel: np.ndarray | float) -> np.ndarray | float:
    return 700.0 * (10.0 ** (np.asarray(mel, dtype=np.float64) / 2595.0) - 1.0)


def mel_filterbank(
    sample_rate: int, n_fft: int, n_mels: int = 40, fmin: float = 20.0, fmax: float | None = None
) -> np.ndarray:
    fmax = fmax or sample_rate / 2.0
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sample_rate)
    mel_points = np.linspace(float(hz_to_mel(fmin)), float(hz_to_mel(fmax)), n_mels + 2)
    hz_points = np.asarray(mel_to_hz(mel_points), dtype=np.float64)
    bank = np.zeros((n_mels, freqs.size), dtype=np.float32)
    for i in range(n_mels):
        low, center, high = hz_points[i], hz_points[i + 1], hz_points[i + 2]
        rising = (freqs - low) / max(center - low, EPS)
        falling = (high - freqs) / max(high - center, EPS)
        bank[i] = np.clip(np.minimum(rising, falling), 0.0, None)
        area = bank[i].sum()
        if area > 0:
            bank[i] /= area
    return bank


def mel_spectrogram(spec: Spectrogram, n_mels: int = 40, fmin: float = 20.0) -> np.ndarray:
    bank = mel_filterbank(spec.sample_rate, spec.n_fft, n_mels=n_mels, fmin=fmin)
    return bank @ spec.power


def dct_matrix(n_out: int, n_in: int) -> np.ndarray:
    """Orthonormal DCT-II matrix (same normalisation as ``scipy`` ``norm='ortho'``)."""
    k = np.arange(n_out)[:, None]
    n = np.arange(n_in)[None, :]
    matrix = np.cos(np.pi * k * (2 * n + 1) / (2 * n_in))
    matrix *= np.sqrt(2.0 / n_in)
    matrix[0] *= np.sqrt(0.5)
    return matrix.astype(np.float32)


def mfcc(spec: Spectrogram, n_mfcc: int = 13, n_mels: int = 40) -> np.ndarray:
    """MFCC matrix, shape ``(n_mfcc, frames)``."""
    mel = mel_spectrogram(spec, n_mels=n_mels)
    log_mel = np.log(mel + EPS)
    return dct_matrix(n_mfcc, n_mels) @ log_mel


# ---------------------------------------------------------------------------
# chroma / tonnetz
# ---------------------------------------------------------------------------


def chromagram(
    spec: Spectrogram, fmin: float = 60.0, fmax: float = 5000.0, sigma: float = 0.25
) -> np.ndarray:
    """12-bin chroma from the magnitude STFT, shape ``(12, frames)``.

    Use a long window (``n_fft`` >= 8192) for this: at 2048 samples the bin
    spacing is wider than a semitone in the bass register, and the leakage is
    enough to move the detected key by a fifth.
    """
    freqs = spec.freqs
    usable = (freqs >= fmin) & (freqs <= fmax)
    if not np.any(usable):
        return np.zeros((12, spec.n_frames), dtype=np.float32)
    sub_freqs = freqs[usable]
    magnitude = spec.magnitude[usable]
    midi = 69.0 + 12.0 * np.log2(np.maximum(sub_freqs, EPS) / A4_HZ)
    pitch_class = np.mod(np.round(midi).astype(int), 12)
    # Gaussian weighting around each semitone centre: bins that sit between two
    # semitones contribute almost nothing instead of smearing into both.
    deviation = midi - np.round(midi)
    weight = np.exp(-0.5 * (deviation / max(sigma, 1e-3)) ** 2).astype(np.float32)
    weighted = magnitude * weight[:, None]
    chroma = np.zeros((12, spec.n_frames), dtype=np.float32)
    for pc in range(12):
        mask = pitch_class == pc
        if np.any(mask):
            chroma[pc] = weighted[mask].sum(axis=0)
    peak = chroma.max(axis=0, keepdims=True)
    return chroma / np.maximum(peak, EPS)


_TONNETZ_BASIS = None


def _tonnetz_basis() -> np.ndarray:
    global _TONNETZ_BASIS
    if _TONNETZ_BASIS is None:
        pitch = np.arange(12)
        rows = []
        for interval, radius in ((7, 1.0), (3, 1.0), (4, 0.5)):
            angle = 2.0 * np.pi * interval * pitch / 12.0
            rows.append(radius * np.sin(angle))
            rows.append(radius * np.cos(angle))
        _TONNETZ_BASIS = np.asarray(rows, dtype=np.float32)
    return _TONNETZ_BASIS


def tonnetz(chroma: np.ndarray) -> np.ndarray:
    """6-dimensional tonal centroid features, shape ``(6, frames)``."""
    norm = chroma / np.maximum(chroma.sum(axis=0, keepdims=True), EPS)
    return _tonnetz_basis() @ norm


# ---------------------------------------------------------------------------
# spectral shape descriptors
# ---------------------------------------------------------------------------


def spectral_centroid(spec: Spectrogram) -> np.ndarray:
    mag = spec.magnitude
    total = mag.sum(axis=0)
    return np.where(total > EPS, (spec.freqs[:, None] * mag).sum(axis=0) / np.maximum(total, EPS), 0.0)


def spectral_bandwidth(spec: Spectrogram, centroid: np.ndarray | None = None) -> np.ndarray:
    centroid = spectral_centroid(spec) if centroid is None else centroid
    mag = spec.magnitude
    total = np.maximum(mag.sum(axis=0), EPS)
    deviation = (spec.freqs[:, None] - centroid[None, :]) ** 2
    return np.sqrt((deviation * mag).sum(axis=0) / total)


def spectral_rolloff(spec: Spectrogram, fraction: float = 0.85) -> np.ndarray:
    cumulative = np.cumsum(spec.magnitude, axis=0)
    total = cumulative[-1]
    threshold = fraction * np.maximum(total, EPS)
    idx = (cumulative >= threshold[None, :]).argmax(axis=0)
    out = spec.freqs[idx]
    return np.where(total > EPS, out, 0.0)


def spectral_flatness(spec: Spectrogram) -> np.ndarray:
    power = spec.power + EPS
    geometric = np.exp(np.mean(np.log(power), axis=0))
    arithmetic = np.mean(power, axis=0)
    return geometric / np.maximum(arithmetic, EPS)


def spectral_flux(spec: Spectrogram) -> np.ndarray:
    log_mag = np.log1p(spec.magnitude * 100.0)
    diff = np.diff(log_mag, axis=1, prepend=log_mag[:, :1])
    return np.maximum(diff, 0.0).sum(axis=0)


def spectral_contrast(spec: Spectrogram, n_bands: int = 6, fmin: float = 200.0, quantile: float = 0.02) -> np.ndarray:
    """Octave-band spectral contrast, shape ``(n_bands + 1, frames)``."""
    freqs = spec.freqs
    nyquist = spec.sample_rate / 2.0
    edges = [0.0, fmin]
    while len(edges) <= n_bands + 1:
        nxt = edges[-1] * 2.0
        edges.append(min(nxt, nyquist))
        if edges[-1] >= nyquist:
            break
    while len(edges) < n_bands + 2:
        edges.append(nyquist)
    out = np.zeros((n_bands + 1, spec.n_frames), dtype=np.float32)
    power = spec.power
    for band in range(n_bands + 1):
        low, high = edges[band], edges[band + 1]
        mask = (freqs >= low) & (freqs < high) if band < n_bands else (freqs >= low)
        if not np.any(mask):
            continue
        band_power = np.sort(power[mask], axis=0)
        k = max(1, int(quantile * band_power.shape[0]))
        valley = np.mean(band_power[:k], axis=0)
        peak = np.mean(band_power[-k:], axis=0)
        out[band] = np.log(peak + EPS) - np.log(valley + EPS)
    return out


def zero_crossing_rate(x: np.ndarray, frame_length: int = 2048, hop: int = 512) -> np.ndarray:
    frames = frame_signal(np.asarray(x, dtype=np.float32), frame_length, hop)
    signs = np.signbit(frames)
    return np.mean(signs[:, 1:] != signs[:, :-1], axis=1)


# ---------------------------------------------------------------------------
# pitch
# ---------------------------------------------------------------------------


def dominant_pitch(spec: Spectrogram, fmin: float = 25.0, fmax: float = 2200.0, n_harmonics: int = 5) -> tuple[float, float]:
    """Fundamental frequency via harmonic product spectrum.

    Returns ``(hz, confidence)``; ``hz`` is 0.0 when nothing tonal is found.
    """
    if spec.n_frames == 0:
        return 0.0, 0.0
    # Median across time is robust to the transient at the start of one-shots.
    avg = np.median(spec.magnitude, axis=1)
    if avg.max() <= EPS:
        return 0.0, 0.0
    freqs = spec.freqs
    band = (freqs >= fmin) & (freqs <= fmax)
    if not np.any(band):
        return 0.0, 0.0
    hps = np.log(avg[band] + EPS).copy()
    base_freqs = freqs[band]
    for harmonic in range(2, n_harmonics + 1):
        shifted = np.interp(base_freqs * harmonic, freqs, avg, left=0.0, right=0.0)
        hps += np.log(shifted + EPS) / harmonic
    idx = int(np.argmax(hps))
    hz = float(base_freqs[idx])
    # refine with a parabolic fit on the linear spectrum around the peak
    full_idx = int(np.argmin(np.abs(freqs - hz)))
    if 0 < full_idx < avg.size - 1:
        a, b, c = avg[full_idx - 1], avg[full_idx], avg[full_idx + 1]
        denom = a - 2 * b + c
        if abs(denom) > EPS:
            offset = 0.5 * (a - c) / denom
            hz = float(freqs[full_idx] + offset * (freqs[1] - freqs[0]))
    scores = hps - hps.min()
    total = scores.sum()
    confidence = float(scores[idx] / total * min(scores.size, 64)) if total > EPS else 0.0
    return max(hz, 0.0), float(np.clip(confidence, 0.0, 1.0))


def hz_to_midi(hz: float) -> float:
    if hz <= 0:
        return 0.0
    return 69.0 + 12.0 * np.log2(hz / A4_HZ)


def midi_to_note(midi: float) -> str:
    if midi <= 0:
        return ""
    rounded = int(round(midi))
    return f"{NOTE_NAMES[rounded % 12]}{rounded // 12 - 1}"


def note_to_pitch_class(name: str) -> int | None:
    if not name:
        return None
    text = name.strip().replace("♯", "#").replace("♭", "b")
    text = text[0].upper() + text[1:]
    flats = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#"}
    for flat, sharp in flats.items():
        if text.startswith(flat):
            text = sharp + text[len(flat) :]
            break
    for pc, note in enumerate(NOTE_NAMES):
        if text.startswith(note) and (len(text) == len(note) or not text[len(note)] == "#"):
            return pc
    return None
