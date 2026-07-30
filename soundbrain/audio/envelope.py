"""Time-domain shape: transients, attack, release, sustain and onsets.

Stage 4 of the plan leans on these numbers more than on musical key: whether a
bass sits in the pocket of a kick is mostly a question of when its energy
arrives and how fast the kick's tail gets out of the way.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

EPS = 1e-10


@dataclass
class EnvelopeFeatures:
    attack_ms: float = 0.0
    decay_ms: float = 0.0
    release_ms: float = 0.0
    sustain_ratio: float = 0.0
    transient: float = 0.0
    punch: float = 0.0
    gate_ratio: float = 0.0
    peak_time_ms: float = 0.0
    tail_ms: float = 0.0
    onset_times: list[float] = field(default_factory=list)
    onset_rate: float = 0.0
    envelope: np.ndarray | None = None
    env_hop: float = 0.005

    def as_dict(self) -> dict[str, float | list[float]]:
        return {
            "attack_ms": round(self.attack_ms, 3),
            "decay_ms": round(self.decay_ms, 3),
            "release_ms": round(self.release_ms, 3),
            "sustain_ratio": round(self.sustain_ratio, 4),
            "transient": round(self.transient, 4),
            "punch": round(self.punch, 4),
            "gate_ratio": round(self.gate_ratio, 4),
            "peak_time_ms": round(self.peak_time_ms, 3),
            "tail_ms": round(self.tail_ms, 3),
            "onset_times": [round(t, 4) for t in self.onset_times[:64]],
            "onset_rate": round(self.onset_rate, 3),
        }


def amplitude_envelope(mono: np.ndarray, sample_rate: int, hop_seconds: float = 0.005) -> np.ndarray:
    """Short-window RMS envelope, one value every ``hop_seconds``."""
    hop = max(int(hop_seconds * sample_rate), 1)
    win = hop * 2
    if mono.size < win:
        mono = np.pad(mono, (0, win - mono.size))
    n = 1 + (mono.size - win) // hop
    idx = np.arange(win)[None, :] + hop * np.arange(n)[:, None]
    frames = mono[idx].astype(np.float64)
    return np.sqrt(np.mean(frames**2, axis=1))


def _time_to_cross(env: np.ndarray, start: int, level: float, forward: bool = True) -> int | None:
    if forward:
        rng = range(start, env.size)
    else:
        rng = range(start, -1, -1)
    for i in rng:
        if env[i] <= level:
            return i
    return None


def analyze_envelope(
    mono: np.ndarray,
    sample_rate: int,
    onset_env: np.ndarray | None = None,
    onset_times: np.ndarray | None = None,
    hop_seconds: float = 0.005,
) -> EnvelopeFeatures:
    """Attack / decay / release / transient descriptors for one sound."""
    env = amplitude_envelope(mono, sample_rate, hop_seconds)
    out = EnvelopeFeatures(envelope=env, env_hop=hop_seconds)
    if env.size == 0 or env.max() <= EPS:
        return out

    peak = float(env.max())
    peak_idx = int(np.argmax(env))
    out.peak_time_ms = peak_idx * hop_seconds * 1000.0

    # attack: 10 % -> 90 % of the peak on the way up
    start_idx = 0
    for i in range(peak_idx, -1, -1):
        if env[i] <= 0.1 * peak:
            start_idx = i
            break
    ninety_idx = peak_idx
    for i in range(start_idx, peak_idx + 1):
        if env[i] >= 0.9 * peak:
            ninety_idx = i
            break
    out.attack_ms = max((ninety_idx - start_idx) * hop_seconds * 1000.0, hop_seconds * 1000.0 * 0.5)

    # decay: peak -> 50 %, release: peak -> 10 %, tail: peak -> 1 %
    half = _time_to_cross(env, peak_idx, 0.5 * peak)
    tenth = _time_to_cross(env, peak_idx, 0.1 * peak)
    hundredth = _time_to_cross(env, peak_idx, 0.01 * peak)
    out.decay_ms = ((half - peak_idx) if half is not None else (env.size - peak_idx)) * hop_seconds * 1000.0
    out.release_ms = ((tenth - peak_idx) if tenth is not None else (env.size - peak_idx)) * hop_seconds * 1000.0
    out.tail_ms = ((hundredth - peak_idx) if hundredth is not None else (env.size - peak_idx)) * hop_seconds * 1000.0

    # sustain: how much level survives in the middle third
    lo, hi = env.size // 3, max(env.size // 3 + 1, (2 * env.size) // 3)
    out.sustain_ratio = float(np.mean(env[lo:hi]) / peak) if hi > lo else 0.0

    # transient: normalised steepest rise, 0 (pad) .. 1 (click). The signal
    # starts from silence, so frame 0 counts as a rise from zero — otherwise a
    # sound whose peak is its very first frame would look like it had no attack.
    rise = np.diff(env, prepend=0.0)
    out.transient = float(np.clip(rise.max() / (peak + EPS) / 0.6, 0.0, 1.0))

    # punch: first 40 ms energy versus overall RMS
    head = max(int(0.04 / hop_seconds), 1)
    overall = float(np.sqrt(np.mean(env**2)) + EPS)
    out.punch = float(np.clip(np.mean(env[:head]) / overall, 0.0, 8.0))

    # gate ratio: fraction of the sound that is effectively silent (-30 dB)
    out.gate_ratio = float(np.mean(env < peak * 10 ** (-30.0 / 20.0)))

    if onset_times is not None and len(onset_times):
        out.onset_times = [float(t) for t in onset_times]
        span = max(mono.size / float(sample_rate), EPS)
        out.onset_rate = len(onset_times) / span
    elif onset_env is not None:
        times, _ = detect_onsets(onset_env, hop_seconds)
        out.onset_times = [float(t) for t in times]
        out.onset_rate = len(times) / max(mono.size / float(sample_rate), EPS)
    return out


def detect_onsets(
    onset_env: np.ndarray,
    hop_seconds: float,
    delta: float = 0.25,
    min_gap_seconds: float = 0.045,
) -> tuple[np.ndarray, np.ndarray]:
    """Peak-pick an onset strength curve.

    Returns ``(times, strengths)``. The threshold is adaptive: a local mean over
    ~250 ms plus ``delta`` times the global spread, which handles both sparse
    one-shots and dense rolling basslines.
    """
    if onset_env.size == 0:
        return np.array([]), np.array([])
    env = np.asarray(onset_env, dtype=np.float64)
    env = env - env.min()
    scale = env.max()
    if scale <= EPS:
        return np.array([]), np.array([])
    env = env / scale

    window = max(int(0.25 / max(hop_seconds, EPS)), 3)
    kernel = np.ones(window) / window
    local_mean = np.convolve(env, kernel, mode="same")
    threshold = local_mean + delta

    candidates = []
    min_gap = max(int(min_gap_seconds / max(hop_seconds, EPS)), 1)
    last = -min_gap
    for i in range(1, env.size - 1):
        if env[i] < threshold[i]:
            continue
        if env[i] < env[i - 1] or env[i] < env[i + 1]:
            continue
        if i - last < min_gap:
            continue
        candidates.append(i)
        last = i
    if not candidates:
        return np.array([]), np.array([])
    idx = np.asarray(candidates)
    return idx * hop_seconds, env[idx]
