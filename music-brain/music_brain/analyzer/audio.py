"""Audio feature extraction (Stage 3).

Uses librosa when available; otherwise returns path/heuristic-only features so
scan + match still work without native audio deps.
"""

from __future__ import annotations

import math
import struct
import wave
from pathlib import Path
from typing import Any

from music_brain.analyzer.styles import classify_style

# Optional heavy deps
try:
    import numpy as np

    HAS_NUMPY = True
except ImportError:  # pragma: no cover
    np = None  # type: ignore
    HAS_NUMPY = False

try:
    import librosa

    HAS_LIBROSA = True
except ImportError:  # pragma: no cover
    librosa = None  # type: ignore
    HAS_LIBROSA = False


KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def analyze_file(path: str | Path, role_hint: str | None = None) -> dict[str, Any]:
    """Full analysis pipeline for one audio/sample file."""
    path = Path(path)
    features: dict[str, Any] = {"analyzer": "heuristic"}

    if HAS_LIBROSA and HAS_NUMPY and path.suffix.lower() in {
        ".wav",
        ".aiff",
        ".aif",
        ".flac",
        ".mp3",
        ".ogg",
    }:
        try:
            features = _librosa_features(path)
        except Exception as exc:  # pragma: no cover - defensive
            features = {"analyzer": "librosa_failed", "error": str(exc)}
            features.update(_wav_basic_features(path))
    else:
        features.update(_wav_basic_features(path))

    style, family = classify_style(str(path), role_hint, features)
    return {
        "key": features.get("key"),
        "key_confidence": features.get("key_confidence"),
        "bpm": features.get("bpm"),
        "tempo_confidence": features.get("tempo_confidence"),
        "style": style,
        "style_family": family or role_hint,
        "duration_sec": features.get("duration_sec"),
        "sample_rate": features.get("sample_rate"),
        "channels": features.get("channels"),
        "features": features,
    }


def _wav_basic_features(path: Path) -> dict[str, Any]:
    """Stdlib wave reader — RMS / duration / crude stereo width for .wav."""
    out: dict[str, Any] = {"analyzer": out_analyzer_name()}
    if path.suffix.lower() != ".wav":
        # Still try to parse BPM/key from filename.
        out.update(_filename_hints(path))
        return out
    try:
        with wave.open(str(path), "rb") as wf:
            nch = wf.getnchannels()
            sw = wf.getsampwidth()
            sr = wf.getframerate()
            nframes = wf.getnframes()
            duration = nframes / float(sr) if sr else 0.0
            # Read up to ~10s for stats
            max_frames = min(nframes, sr * 10 if sr else nframes)
            raw = wf.readframes(max_frames)
    except Exception:
        out.update(_filename_hints(path))
        return out

    out.update(
        {
            "duration_sec": round(duration, 4),
            "sample_rate": sr,
            "channels": nch,
        }
    )
    out.update(_filename_hints(path))

    if sw != 2 or not raw:
        return out

    samples = struct.unpack("<" + "h" * (len(raw) // 2), raw)
    if not samples:
        return out

    # Normalize to -1..1
    vals = [s / 32768.0 for s in samples]
    if nch >= 2:
        left = vals[0::nch]
        right = vals[1::nch]
        mono = [(l + r) * 0.5 for l, r in zip(left, right)]
        # Stereo width ≈ mean |L-R| / (mean |L|+|R| + eps)
        diff = sum(abs(l - r) for l, r in zip(left, right)) / max(len(left), 1)
        mid = sum(abs(l) + abs(r) for l, r in zip(left, right)) / max(len(left), 1)
        out["stereo_width"] = round(diff / (mid + 1e-9), 4)
    else:
        mono = vals
        out["stereo_width"] = 0.0

    abs_m = [abs(x) for x in mono]
    rms = math.sqrt(sum(x * x for x in mono) / max(len(mono), 1))
    peak = max(abs_m) if abs_m else 0.0
    out["rms_mean"] = round(rms, 6)
    out["peak"] = round(peak, 6)
    # Crude LUFS-ish: loudness ≈ 20*log10(rms) (not true LUFS)
    out["lufs_approx"] = round(20 * math.log10(rms + 1e-12), 2)

    # Attack: time to reach 75% of peak from start
    thresh = peak * 0.75
    attack_i = 0
    for i, v in enumerate(abs_m):
        if v >= thresh:
            attack_i = i
            break
    attack_ms = (attack_i / sr) * 1000.0 if sr else 0.0
    out["attack_ms"] = round(attack_ms, 2)

    # Release: from peak index to drop below 25%
    peak_i = abs_m.index(peak) if abs_m else 0
    rel_i = peak_i
    rel_thresh = peak * 0.25
    for i in range(peak_i, len(abs_m)):
        if abs_m[i] <= rel_thresh:
            rel_i = i
            break
    else:
        rel_i = len(abs_m) - 1
    out["release_ms"] = round(((rel_i - peak_i) / sr) * 1000.0, 2) if sr else 0.0

    # Transient ratio: early energy / total energy
    early_n = max(1, int(0.01 * sr)) if sr else 1
    early = sum(x * x for x in mono[:early_n])
    total = sum(x * x for x in mono) + 1e-12
    out["transient_ratio"] = round(early / total, 6)

    # Spectral centroid proxy via zero-crossing rate (very rough without FFT)
    zc = sum(1 for a, b in zip(mono, mono[1:]) if (a >= 0) != (b >= 0))
    zcr = zc / max(len(mono) - 1, 1)
    # Map ZCR ~0..0.3 → centroid-ish 100..5000 Hz
    out["spectral_centroid_mean"] = round(100 + zcr * 15000, 2)
    out["spectral_rolloff_mean"] = round(out["spectral_centroid_mean"] * 1.8, 2)
    out["dynamic_range_db"] = round(20 * math.log10((peak + 1e-12) / (rms + 1e-12)), 2)

    return out


def out_analyzer_name() -> str:
    if HAS_LIBROSA:
        return "librosa"
    return "wav_stdlib"


def _filename_hints(path: Path) -> dict[str, Any]:
    text = path.stem.lower().replace("_", " ").replace("-", " ")
    out: dict[str, Any] = {}
    # BPM like 142bpm / 142 bpm / _142_
    m = re_search_bpm(text)
    if m:
        out["bpm"] = float(m)
        out["tempo_confidence"] = 0.55
    # Key like f# / f#m / am / cmaj
    k = re_search_key(text)
    if k:
        out["key"] = k
        out["key_confidence"] = 0.5
    return out


def re_search_bpm(text: str) -> int | None:
    import re

    m = re.search(r"(?<![0-9])(1[2-5][0-9]|1[0-9]{2})(?:\s*bpm)?", text)
    if m:
        val = int(m.group(1))
        if 100 <= val <= 180:
            return val
    return None


def re_search_key(text: str) -> str | None:
    import re

    m = re.search(r"(?<![a-z])([a-g])\s?(#|b|sharp|flat)?\s?(m|min|minor|maj|major)?(?![a-z])", text)
    if not m:
        return None
    note = m.group(1).upper()
    acc = m.group(2) or ""
    mode = (m.group(3) or "").lower()
    if acc in ("#", "sharp"):
        note += "#"
    elif acc in ("b", "flat"):
        # Flatten to sharp equivalents where needed
        flat_map = {"D": "C#", "E": "D#", "G": "F#", "A": "G#", "B": "A#", "C": "B", "F": "E"}
        note = flat_map.get(note, note)
    if mode in ("m", "min", "minor"):
        return f"{note}m"
    return note


def _librosa_features(path: Path) -> dict[str, Any]:  # pragma: no cover - optional
    assert librosa is not None and np is not None
    y, sr = librosa.load(str(path), sr=None, mono=False)
    if y.ndim == 1:
        mono = y
        stereo_width = 0.0
        channels = 1
    else:
        channels = int(y.shape[0])
        left, right = y[0], y[1] if y.shape[0] > 1 else y[0]
        mono = librosa.to_mono(y)
        diff = np.mean(np.abs(left - right))
        mid = np.mean(np.abs(left) + np.abs(right)) + 1e-9
        stereo_width = float(diff / mid)

    duration = float(librosa.get_duration(y=mono, sr=sr))
    rms = librosa.feature.rms(y=mono)[0]
    rms_mean = float(np.mean(rms))
    peak = float(np.max(np.abs(mono)) + 1e-12)
    centroid = librosa.feature.spectral_centroid(y=mono, sr=sr)[0]
    rolloff = librosa.feature.spectral_rolloff(y=mono, sr=sr)[0]
    contrast = librosa.feature.spectral_contrast(y=mono, sr=sr)
    mfcc = librosa.feature.mfcc(y=mono, sr=sr, n_mfcc=13)
    chroma = librosa.feature.chroma_stft(y=mono, sr=sr)
    try:
        tonnetz = librosa.feature.tonnetz(y=librosa.effects.harmonic(mono), sr=sr)
        tonnetz_mean = float(np.mean(tonnetz))
    except Exception:
        tonnetz_mean = 0.0

    tempo, beats = librosa.beat.beat_track(y=mono, sr=sr)
    tempo = float(np.atleast_1d(tempo)[0])
    onset_env = librosa.onset.onset_strength(y=mono, sr=sr)
    tempo_conf = float(np.std(onset_env) / (np.mean(onset_env) + 1e-9))
    tempo_conf = max(0.0, min(1.0, tempo_conf / 3.0))

    chroma_mean = np.mean(chroma, axis=1)
    key_idx = int(np.argmax(chroma_mean))
    key_conf = float(chroma_mean[key_idx] / (np.sum(chroma_mean) + 1e-9) * len(chroma_mean) / 4)
    key_conf = max(0.0, min(1.0, key_conf))
    # crude major/minor via relative minor strength
    minor_idx = (key_idx + 9) % 12
    mode = "m" if chroma_mean[minor_idx] > chroma_mean[key_idx] * 0.85 else ""
    key = KEY_NAMES[key_idx] + mode

    # Envelope attack / release via amplitude envelope
    hop = 512
    env = rms
    peak_i = int(np.argmax(env))
    thresh = float(env[peak_i]) * 0.75
    attack_i = int(np.argmax(env >= thresh))
    attack_ms = (attack_i * hop / sr) * 1000.0
    rel_thresh = float(env[peak_i]) * 0.25
    rel_slice = env[peak_i:]
    rel_rel = np.where(rel_slice <= rel_thresh)[0]
    release_ms = float((rel_rel[0] if len(rel_rel) else len(rel_slice)) * hop / sr * 1000.0)

    early = float(np.sum(mono[: max(1, int(0.01 * sr))] ** 2))
    total = float(np.sum(mono**2) + 1e-12)

    out = {
        "analyzer": "librosa",
        "duration_sec": round(duration, 4),
        "sample_rate": int(sr),
        "channels": channels,
        "rms_mean": round(rms_mean, 6),
        "peak": round(peak, 6),
        "lufs_approx": round(20 * math.log10(rms_mean + 1e-12), 2),
        "dynamic_range_db": round(20 * math.log10(peak / (rms_mean + 1e-12)), 2),
        "stereo_width": round(stereo_width, 4),
        "attack_ms": round(attack_ms, 2),
        "release_ms": round(release_ms, 2),
        "transient_ratio": round(early / total, 6),
        "spectral_centroid_mean": round(float(np.mean(centroid)), 2),
        "spectral_rolloff_mean": round(float(np.mean(rolloff)), 2),
        "spectral_contrast_mean": round(float(np.mean(contrast)), 4),
        "mfcc_mean": [round(float(x), 4) for x in np.mean(mfcc, axis=1)],
        "chroma_mean": [round(float(x), 4) for x in chroma_mean],
        "tonnetz_mean": round(tonnetz_mean, 4),
        "bpm": round(tempo, 2) if tempo > 0 else None,
        "tempo_confidence": round(tempo_conf, 4),
        "key": key,
        "key_confidence": round(key_conf, 4),
        "envelope": {
            "attack_ms": round(attack_ms, 2),
            "release_ms": round(release_ms, 2),
        },
    }
    # Filename can still override weak detections
    hints = _filename_hints(path)
    if hints.get("bpm") and (not out["bpm"] or (out.get("tempo_confidence") or 0) < 0.4):
        out["bpm"] = hints["bpm"]
        out["tempo_confidence"] = hints.get("tempo_confidence", 0.55)
    if hints.get("key") and (out.get("key_confidence") or 0) < 0.35:
        out["key"] = hints["key"]
        out["key_confidence"] = hints.get("key_confidence", 0.5)
    return out
