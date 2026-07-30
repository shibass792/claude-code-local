"""Level and loudness metrics: RMS, peak, crest, dynamics, and LUFS.

Integrated loudness follows ITU-R BS.1770-4 / EBU R128: K-weighting, 400 ms
blocks with 75 % overlap, absolute gate at -70 LUFS and a relative gate 10 dB
below the ungated mean. The K-weighting filter is applied in the frequency
domain (the analytic biquad response evaluated on the FFT grid) which keeps the
implementation numpy-only while matching the specified magnitude response.
"""

from __future__ import annotations

import numpy as np

EPS = 1e-12


def _biquad_high_shelf(sample_rate: int) -> tuple[np.ndarray, np.ndarray]:
    f0 = 1681.9744509555319
    gain_db = 3.99984385397
    q = 0.7071752369554193
    k = np.tan(np.pi * f0 / sample_rate)
    vh = 10.0 ** (gain_db / 20.0)
    vb = vh**0.4996667741545416
    a0 = 1.0 + k / q + k * k
    b = np.array(
        [
            (vh + vb * k / q + k * k) / a0,
            2.0 * (k * k - vh) / a0,
            (vh - vb * k / q + k * k) / a0,
        ]
    )
    a = np.array([1.0, 2.0 * (k * k - 1.0) / a0, (1.0 - k / q + k * k) / a0])
    return b, a


def _biquad_high_pass(sample_rate: int) -> tuple[np.ndarray, np.ndarray]:
    f0 = 38.13547087602444
    q = 0.5003270373238773
    k = np.tan(np.pi * f0 / sample_rate)
    denom = 1.0 + k / q + k * k
    b = np.array([1.0, -2.0, 1.0])
    a = np.array([1.0, 2.0 * (k * k - 1.0) / denom, (1.0 - k / q + k * k) / denom])
    return b, a


def _biquad_response(b: np.ndarray, a: np.ndarray, freqs: np.ndarray, sample_rate: int) -> np.ndarray:
    z = np.exp(-2j * np.pi * freqs / sample_rate)
    num = b[0] + b[1] * z + b[2] * z**2
    den = a[0] + a[1] * z + a[2] * z**2
    return num / np.where(np.abs(den) < EPS, EPS, den)


def k_weighting_magnitude(freqs: np.ndarray, sample_rate: int) -> np.ndarray:
    """|H(f)| of the BS.1770 K-weighting chain on the given frequency grid."""
    shelf_b, shelf_a = _biquad_high_shelf(sample_rate)
    hp_b, hp_a = _biquad_high_pass(sample_rate)
    response = _biquad_response(shelf_b, shelf_a, freqs, sample_rate) * _biquad_response(
        hp_b, hp_a, freqs, sample_rate
    )
    return np.abs(response)


def _block_mean_square(block: np.ndarray, weight: np.ndarray) -> float:
    """K-weighted mean square of one block via Parseval on the rfft grid."""
    n = block.size
    spectrum = np.fft.rfft(block) * weight
    power = np.abs(spectrum) ** 2
    if n % 2 == 0:
        total = power[0] + 2.0 * power[1:-1].sum() + power[-1]
    else:
        total = power[0] + 2.0 * power[1:].sum()
    return float(total / (n * n))


def integrated_lufs(samples: np.ndarray, sample_rate: int) -> float:
    """Gated integrated loudness in LUFS (``-inf`` becomes ``-70.0``)."""
    data = np.atleast_2d(np.asarray(samples, dtype=np.float64))
    if data.shape[0] < data.shape[1]:
        pass  # already (channels, frames)? normalise below
    if samples.ndim == 1:
        channels = data
    else:
        channels = np.asarray(samples, dtype=np.float64).T  # (channels, frames)

    n_frames = channels.shape[1]
    block_len = int(0.4 * sample_rate)
    hop = int(0.1 * sample_rate)
    if n_frames < block_len:
        pad = block_len - n_frames
        channels = np.pad(channels, ((0, 0), (0, pad)))
        n_frames = channels.shape[1]

    freqs = np.fft.rfftfreq(block_len, 1.0 / sample_rate)
    weight = k_weighting_magnitude(freqs, sample_rate)
    channel_gain = [1.0, 1.0, 1.0, 1.41, 1.41]

    starts = range(0, n_frames - block_len + 1, max(hop, 1))
    block_loudness: list[float] = []
    block_power: list[float] = []
    for start in starts:
        z = 0.0
        for ch in range(channels.shape[0]):
            gain = channel_gain[ch] if ch < len(channel_gain) else 1.0
            z += gain * _block_mean_square(channels[ch, start : start + block_len], weight)
        if z <= 0:
            continue
        block_power.append(z)
        block_loudness.append(-0.691 + 10.0 * np.log10(z))

    if not block_power:
        return -70.0

    powers = np.asarray(block_power)
    loudness = np.asarray(block_loudness)

    above_absolute = loudness > -70.0
    if not np.any(above_absolute):
        return -70.0
    ungated_mean = powers[above_absolute].mean()
    relative_threshold = -0.691 + 10.0 * np.log10(ungated_mean) - 10.0
    gated = above_absolute & (loudness > relative_threshold)
    if not np.any(gated):
        gated = above_absolute
    return float(-0.691 + 10.0 * np.log10(powers[gated].mean()))


def db(value: float, floor: float = -120.0) -> float:
    if value <= 0:
        return floor
    return float(max(20.0 * np.log10(value), floor))


def short_term_rms(mono: np.ndarray, sample_rate: int, window: float = 0.05) -> np.ndarray:
    win = max(int(window * sample_rate), 1)
    n = mono.size // win
    if n == 0:
        return np.array([float(np.sqrt(np.mean(mono**2)) if mono.size else 0.0)])
    trimmed = mono[: n * win].reshape(n, win)
    return np.sqrt(np.mean(trimmed.astype(np.float64) ** 2, axis=1))


def level_metrics(samples: np.ndarray, sample_rate: int) -> dict[str, float]:
    """RMS / peak / crest / dynamic range / LUFS in one pass."""
    data = np.asarray(samples, dtype=np.float32)
    mono = data if data.ndim == 1 else data.mean(axis=1)
    rms = float(np.sqrt(np.mean(mono.astype(np.float64) ** 2))) if mono.size else 0.0
    peak = float(np.max(np.abs(data))) if data.size else 0.0
    st = short_term_rms(mono, sample_rate)
    st_db = np.array([db(v) for v in st])
    loud_frames = st_db[st_db > (st_db.max() - 40.0)] if st_db.size else st_db
    dynamic_range = float(np.percentile(loud_frames, 95) - np.percentile(loud_frames, 10)) if loud_frames.size > 2 else 0.0
    lufs = integrated_lufs(data, sample_rate)
    return {
        "rms_db": db(rms),
        "peak_db": db(peak),
        "crest_db": float(db(peak) - db(rms)) if rms > 0 else 0.0,
        "dynamic_range": dynamic_range,
        "lufs": lufs,
        "loudness_range": float(np.percentile(loud_frames, 95) - np.percentile(loud_frames, 5)) if loud_frames.size > 2 else 0.0,
    }
