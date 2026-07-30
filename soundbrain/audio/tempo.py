"""Tempo, tempo confidence and rhythm-grid descriptors.

The tempo estimate is an autocorrelation of the onset-strength curve with a
log-normal prior around 130 BPM (psytrance-friendly, still generic enough for
other genres). On top of the BPM we fold the onsets back onto the beat grid,
which is what tells a *rolling* bass (three sixteenths per beat) apart from an
*offbeat* bass (one hit on the "and" of every beat).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

EPS = 1e-10


@dataclass
class TempoFeatures:
    bpm: float = 0.0
    confidence: float = 0.0
    pulse_clarity: float = 0.0
    onsets_per_beat: float = 0.0
    offbeat_ratio: float = 0.0
    downbeat_ratio: float = 0.0
    sixteenth_ratio: float = 0.0
    triplet_ratio: float = 0.0
    ioi_median_ms: float = 0.0
    ioi_regularity: float = 0.0

    def as_dict(self) -> dict[str, float]:
        return {
            "bpm": round(self.bpm, 2),
            "bpm_conf": round(self.confidence, 4),
            "pulse_clarity": round(self.pulse_clarity, 4),
            "onsets_per_beat": round(self.onsets_per_beat, 3),
            "offbeat_ratio": round(self.offbeat_ratio, 4),
            "downbeat_ratio": round(self.downbeat_ratio, 4),
            "sixteenth_ratio": round(self.sixteenth_ratio, 4),
            "triplet_ratio": round(self.triplet_ratio, 4),
            "ioi_median_ms": round(self.ioi_median_ms, 2),
            "ioi_regularity": round(self.ioi_regularity, 4),
        }


def estimate_tempo(
    onset_env: np.ndarray,
    hop_seconds: float,
    bpm_min: float = 60.0,
    bpm_max: float = 200.0,
    prior_bpm: float = 130.0,
    prior_octaves: float = 1.0,
) -> tuple[float, float, float]:
    """Return ``(bpm, confidence, pulse_clarity)`` from an onset curve."""
    env = np.asarray(onset_env, dtype=np.float64)
    if env.size < 8:
        return 0.0, 0.0, 0.0
    env = env - env.mean()
    if np.allclose(env, 0.0):
        return 0.0, 0.0, 0.0

    corr = np.correlate(env, env, mode="full")[env.size - 1 :]
    if corr[0] <= EPS:
        return 0.0, 0.0, 0.0
    corr = corr / corr[0]

    lags = np.arange(1, corr.size)
    lag_seconds = lags * hop_seconds
    with np.errstate(divide="ignore"):
        bpms = 60.0 / np.maximum(lag_seconds, EPS)
    band = (bpms >= bpm_min) & (bpms <= bpm_max)
    if not np.any(band):
        return 0.0, 0.0, 0.0

    scores = corr[1:][band]
    band_bpms = bpms[band]
    prior = np.exp(-0.5 * (np.log2(band_bpms / prior_bpm) / prior_octaves) ** 2)
    weighted = scores * prior
    best = int(np.argmax(weighted))
    bpm = float(band_bpms[best])

    peak = float(scores[best])
    baseline = float(np.mean(np.clip(scores, 0.0, None)))
    spread = float(np.std(scores)) + EPS
    confidence = float(np.clip((peak - baseline) / (3.0 * spread), 0.0, 1.0))
    pulse_clarity = float(np.clip(peak, 0.0, 1.0))
    return bpm, confidence, pulse_clarity


def rhythm_profile(onset_times: np.ndarray | list[float], bpm: float, duration: float) -> dict[str, float]:
    """Where the onsets land on the beat grid."""
    times = np.asarray(list(onset_times), dtype=np.float64)
    out = {
        "onsets_per_beat": 0.0,
        "offbeat_ratio": 0.0,
        "downbeat_ratio": 0.0,
        "sixteenth_ratio": 0.0,
        "triplet_ratio": 0.0,
        "ioi_median_ms": 0.0,
        "ioi_regularity": 0.0,
    }
    if times.size == 0:
        return out
    if times.size >= 2:
        iois = np.diff(times)
        out["ioi_median_ms"] = float(np.median(iois) * 1000.0)
        if iois.size >= 2 and np.median(iois) > EPS:
            out["ioi_regularity"] = float(np.clip(1.0 - np.std(iois) / np.median(iois), 0.0, 1.0))
    if bpm <= 0 or duration <= 0:
        return out

    beat = 60.0 / bpm
    out["onsets_per_beat"] = float(times.size / max(duration / beat, EPS))

    # phase within the beat, 0 .. 1
    phase = np.mod(times - times[0], beat) / beat
    def near(target: float, tol: float = 0.12) -> float:
        distance = np.abs(phase - target)
        distance = np.minimum(distance, 1.0 - distance)
        return float(np.mean(distance <= tol))

    out["downbeat_ratio"] = near(0.0)
    out["offbeat_ratio"] = near(0.5)
    out["sixteenth_ratio"] = float(near(0.25) + near(0.75))
    out["triplet_ratio"] = float(near(1.0 / 3.0) + near(2.0 / 3.0))
    return out


def analyze_tempo(
    onset_env: np.ndarray,
    hop_seconds: float,
    onset_times: np.ndarray | list[float],
    duration: float,
    bpm_hint: float | None = None,
) -> TempoFeatures:
    bpm, confidence, clarity = estimate_tempo(onset_env, hop_seconds)
    if bpm_hint and bpm_hint > 0:
        # a BPM in the filename is strong evidence; snap to it when the audio
        # agrees within an octave, otherwise trust the tag and lower confidence
        if bpm > 0 and abs(np.log2(bpm / bpm_hint)) < 0.6:
            bpm = float(bpm_hint)
            confidence = float(min(1.0, confidence + 0.35))
        else:
            bpm = float(bpm_hint)
            confidence = max(confidence, 0.5)
    profile = rhythm_profile(onset_times, bpm, duration)
    return TempoFeatures(
        bpm=bpm,
        confidence=confidence,
        pulse_clarity=clarity,
        onsets_per_beat=profile["onsets_per_beat"],
        offbeat_ratio=profile["offbeat_ratio"],
        downbeat_ratio=profile["downbeat_ratio"],
        sixteenth_ratio=profile["sixteenth_ratio"],
        triplet_ratio=profile["triplet_ratio"],
        ioi_median_ms=profile["ioi_median_ms"],
        ioi_regularity=profile["ioi_regularity"],
    )
