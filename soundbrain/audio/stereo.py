"""Stereo image descriptors: width, correlation, balance, mono compatibility."""

from __future__ import annotations

import numpy as np

EPS = 1e-12


def stereo_metrics(samples: np.ndarray) -> dict[str, float]:
    data = np.asarray(samples, dtype=np.float64)
    if data.ndim == 1 or data.shape[1] == 1:
        return {
            "stereo_width": 0.0,
            "correlation": 1.0,
            "balance": 0.0,
            "side_energy_db": -120.0,
            "mono_compatibility": 1.0,
        }
    left, right = data[:, 0], data[:, 1]
    mid = 0.5 * (left + right)
    side = 0.5 * (left - right)
    mid_rms = float(np.sqrt(np.mean(mid**2)))
    side_rms = float(np.sqrt(np.mean(side**2)))
    width = float(side_rms / (mid_rms + side_rms + EPS)) * 2.0

    if np.std(left) < EPS or np.std(right) < EPS:
        correlation = 1.0
    else:
        correlation = float(np.corrcoef(left, right)[0, 1])
        if np.isnan(correlation):
            correlation = 1.0

    l_rms = float(np.sqrt(np.mean(left**2)))
    r_rms = float(np.sqrt(np.mean(right**2)))
    balance = float((r_rms - l_rms) / (l_rms + r_rms + EPS))

    total = float(np.sqrt(np.mean(data**2)))
    mono_loss = mid_rms / (total + EPS)
    return {
        "stereo_width": float(np.clip(width, 0.0, 2.0)),
        "correlation": float(np.clip(correlation, -1.0, 1.0)),
        "balance": balance,
        "side_energy_db": float(20.0 * np.log10(side_rms + EPS)),
        "mono_compatibility": float(np.clip(mono_loss, 0.0, 1.5)),
    }


def band_energies(
    magnitude: np.ndarray, freqs: np.ndarray, edges: tuple[float, ...] = (20, 60, 120, 250, 500, 1000, 2000, 4000, 8000, 16000)
) -> dict[str, float]:
    """Relative energy per frequency band, in dB below the total."""
    power = (magnitude**2).mean(axis=1) if magnitude.ndim == 2 else magnitude**2
    total = float(power.sum()) + EPS
    out: dict[str, float] = {}
    for low, high in zip(edges[:-1], edges[1:]):
        mask = (freqs >= low) & (freqs < high)
        share = float(power[mask].sum()) / total if np.any(mask) else 0.0
        out[f"band_{int(low)}_{int(high)}"] = round(share, 6)
    return out
