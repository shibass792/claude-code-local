"""Step 2 & 3 — audio feature extraction and sound classification."""

from __future__ import annotations

import re
from pathlib import Path

import librosa
import numpy as np
import pyloudnorm as pyln

from music_brain.models.types import AudioFeatures, SoundCategory

# Camelot / chroma key names
KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Sub-style rules based on spectral + transient + path hints
BASS_STYLE_RULES: list[tuple[str, dict[str, tuple[float, float]]]] = [
    (
        "rolling_bass",
        {
            "transient_strength": (0.0, 0.35),
            "spectral_centroid": (800, 2500),
            "attack_ms": (5, 80),
        },
    ),
    (
        "offbeat_bass",
        {
            "transient_strength": (0.3, 0.7),
            "spectral_centroid": (400, 1800),
        },
    ),
    (
        "fullon_bass",
        {
            "transient_strength": (0.5, 1.0),
            "spectral_centroid": (1500, 5000),
            "attack_ms": (0, 30),
        },
    ),
    (
        "progressive_bass",
        {
            "transient_strength": (0.2, 0.55),
            "spectral_centroid": (600, 2200),
        },
    ),
    (
        "dark_bass",
        {
            "spectral_centroid": (100, 1200),
            "spectral_rolloff": (500, 3000),
        },
    ),
    (
        "goa_bass",
        {
            "transient_strength": (0.4, 0.9),
            "spectral_centroid": (1000, 3500),
        },
    ),
]

KICK_STYLE_RULES: list[tuple[str, dict[str, tuple[float, float]]]] = [
    ("fullon_kick", {"transient_strength": (0.7, 1.0), "attack_ms": (0, 15)}),
    ("psy_kick", {"transient_strength": (0.6, 1.0), "spectral_centroid": (80, 400)}),
    ("progressive_kick", {"transient_strength": (0.4, 0.75), "attack_ms": (5, 40)}),
    ("dark_kick", {"spectral_centroid": (40, 250), "spectral_rolloff": (200, 2000)}),
    ("techno_kick", {"transient_strength": (0.5, 0.9), "attack_ms": (0, 25)}),
]


def _estimate_key(chroma: np.ndarray) -> tuple[str | None, float, str | None]:
    if chroma.size == 0:
        return None, 0.0, None
    chroma_mean = np.mean(chroma, axis=1)
    if np.sum(chroma_mean) < 1e-6:
        return None, 0.0, None
    idx = int(np.argmax(chroma_mean))
    confidence = float(chroma_mean[idx] / (np.sum(chroma_mean) + 1e-9))
    # Simple major/minor via relative strength of major third
    major_third = (idx + 4) % 12
    minor_third = (idx + 3) % 12
    mode = "major" if chroma_mean[major_third] >= chroma_mean[minor_third] else "minor"
    return KEY_NAMES[idx], confidence, mode


def _estimate_bpm(y: np.ndarray, sr: int) -> tuple[float | None, float]:
    try:
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        tempo_val = float(np.atleast_1d(tempo)[0])
        if beat_frames is not None and len(beat_frames) > 2:
            confidence = min(1.0, len(beat_frames) / 32.0)
        else:
            confidence = 0.3
        # Psytrance often 138-150 — normalize doubled/halved tempos
        while tempo_val < 70:
            tempo_val *= 2
        while tempo_val > 200:
            tempo_val /= 2
        return tempo_val, confidence
    except Exception:
        return None, 0.0


def _transient_envelope(y: np.ndarray, sr: int) -> tuple[float, float, float, float]:
    """Returns attack_ms, release_ms, transient_strength, envelope_centroid."""
    hop = 512
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    if onset_env.size == 0:
        return 0.0, 0.0, 0.0, 0.0

    transient_strength = float(np.max(onset_env) / (np.mean(onset_env) + 1e-9))
    transient_strength = min(transient_strength / 10.0, 1.0)

    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    if rms.size == 0:
        return 0.0, 0.0, transient_strength, 0.0

    peak_idx = int(np.argmax(rms))
    threshold = float(np.max(rms)) * 0.1
    above = np.where(rms > threshold)[0]
    if above.size == 0:
        return 0.0, 0.0, transient_strength, 0.0

    attack_frames = max(1, peak_idx - int(above[0]))
    release_frames = max(1, int(above[-1]) - peak_idx)
    attack_ms = attack_frames * hop / sr * 1000
    release_ms = release_frames * hop / sr * 1000

    times = np.arange(len(rms)) * hop / sr
    envelope_centroid = float(np.sum(times * rms) / (np.sum(rms) + 1e-9))
    return attack_ms, release_ms, transient_strength, envelope_centroid


def _stereo_features(y: np.ndarray) -> tuple[float, float]:
    if y.ndim < 2 or y.shape[0] < 2:
        return 0.0, 1.0
    left, right = y[0], y[1]
    mid = (left + right) / 2
    side = (left - right) / 2
    mid_energy = float(np.mean(mid**2) + 1e-9)
    side_energy = float(np.mean(side**2))
    width = side_energy / mid_energy
    width = min(width, 2.0)
    corr = float(np.corrcoef(left, right)[0, 1]) if len(left) > 1 else 1.0
    return width, corr


def _classify_sub_style(
    category: SoundCategory, features: AudioFeatures, path_hint: str
) -> str | None:
    path_lower = path_hint.lower()

    # Path-based overrides
    path_map = {
        "rolling": "rolling_bass",
        "offbeat": "offbeat_bass",
        "fullon": "fullon_bass",
        "full_on": "fullon_bass",
        "progressive": "progressive_bass",
        "dark": "dark_bass",
        "goa": "goa_bass",
        "reese": "reese_bass",
        "psy": "psy_kick",
        "techno": "techno_kick",
    }
    for token, style in path_map.items():
        if token in path_lower:
            return style

    rules = BASS_STYLE_RULES if category == SoundCategory.BASS else (
        KICK_STYLE_RULES if category == SoundCategory.KICK else []
    )
    if not rules:
        return None

    best_style: str | None = None
    best_score = 0.0
    feat_map = {
        "transient_strength": features.transient_strength,
        "spectral_centroid": features.spectral_centroid,
        "spectral_rolloff": features.spectral_rolloff,
        "attack_ms": features.attack_ms,
    }
    for style_name, constraints in rules:
        score = 0.0
        for key, (lo, hi) in constraints.items():
            val = feat_map.get(key, 0.0)
            if lo <= val <= hi:
                score += 1.0
        if score > best_score:
            best_score = score
            best_style = style_name
    return best_style if best_score > 0 else None


def _infer_category_from_path(path: str) -> SoundCategory:
    path_lower = path.lower()
    if any(k in path_lower for k in ["kick", "bd", "bassdrum"]):
        return SoundCategory.KICK
    if any(k in path_lower for k in ["bass", "sub", "reese"]):
        return SoundCategory.BASS
    if any(k in path_lower for k in ["lead", "melody", "arp"]):
        return SoundCategory.LEAD
    if "pad" in path_lower:
        return SoundCategory.PAD
    if any(k in path_lower for k in ["vocal", "vox", "voice"]):
        return SoundCategory.VOCAL
    if any(k in path_lower for k in ["fx", "sfx", "riser", "impact"]):
        return SoundCategory.FX
    return SoundCategory.UNKNOWN


def _infer_category_from_spectrum(features: AudioFeatures) -> SoundCategory:
    """Heuristic category from spectral shape."""
    sc = features.spectral_centroid
    ts = features.transient_strength
    if sc < 300 and ts > 0.5:
        return SoundCategory.KICK
    if sc < 800:
        return SoundCategory.BASS
    if sc > 3000 and features.zero_crossing_rate > 0.1:
        return SoundCategory.LEAD
    if sc > 1500 and ts < 0.3:
        return SoundCategory.PAD
    return SoundCategory.UNKNOWN


class AudioAnalyzer:
    def __init__(self, max_duration_sec: float = 60.0) -> None:
        self.max_duration_sec = max_duration_sec

    def analyze(self, path: str, category_hint: str | None = None) -> AudioFeatures:
        p = Path(path)
        y, sr = librosa.load(
            str(p), sr=22050, mono=False, duration=self.max_duration_sec
        )
        if y.ndim == 1:
            y_mono = y
        else:
            y_mono = librosa.to_mono(y)

        duration = float(len(y_mono) / sr)
        features = AudioFeatures(duration_sec=duration, sample_rate=sr)

        # Skip heavy analysis for very short clips
        if duration < 1.0:
            if category_hint and category_hint != "unknown":
                try:
                    features.category = SoundCategory(category_hint)
                except ValueError:
                    features.category = _infer_category_from_path(str(p))
            else:
                features.category = _infer_category_from_path(str(p))
            atk, rel, ts, env_c = _transient_envelope(y_mono, sr)
            features.attack_ms = atk
            features.release_ms = rel
            features.transient_strength = ts
            features.envelope_centroid = env_c
            features.spectral_centroid = float(
                np.mean(librosa.feature.spectral_centroid(y=y_mono, sr=sr))
            )
            features.sub_style = _classify_sub_style(
                features.category, features, str(p)
            )
            return features

        # BPM & key
        bpm, bpm_conf = _estimate_bpm(y_mono, sr)
        features.bpm = bpm
        features.bpm_confidence = bpm_conf

        chroma = librosa.feature.chroma_cqt(y=y_mono, sr=sr)
        key, key_conf, mode = _estimate_key(chroma)
        features.key = key
        features.key_confidence = key_conf
        features.mode = mode
        features.chroma = chroma.mean(axis=1).tolist()

        # Loudness
        meter = pyln.Meter(sr)
        features.lufs = float(meter.integrated_loudness(y_mono.reshape(1, -1)))
        rms = float(np.sqrt(np.mean(y_mono**2) + 1e-12))
        features.rms_db = float(20 * np.log10(rms + 1e-12))
        features.peak_db = float(20 * np.log10(np.max(np.abs(y_mono)) + 1e-12))

        frame_rms = librosa.feature.rms(y=y_mono)[0]
        if frame_rms.size > 0:
            features.dynamic_range_db = float(
                20 * np.log10(np.max(frame_rms) / (np.min(frame_rms) + 1e-9) + 1e-12)
            )

        # Transient / envelope
        atk, rel, ts, env_c = _transient_envelope(y_mono, sr)
        features.attack_ms = atk
        features.release_ms = rel
        features.transient_strength = ts
        features.envelope_centroid = env_c

        # Stereo
        if y.ndim == 2:
            width, corr = _stereo_features(y)
            features.stereo_width = width
            features.correlation = corr

        # Spectral
        features.spectral_centroid = float(
            np.mean(librosa.feature.spectral_centroid(y=y_mono, sr=sr))
        )
        features.spectral_rolloff = float(
            np.mean(librosa.feature.spectral_rolloff(y=y_mono, sr=sr))
        )
        features.spectral_bandwidth = float(
            np.mean(librosa.feature.spectral_bandwidth(y=y_mono, sr=sr))
        )
        features.zero_crossing_rate = float(
            np.mean(librosa.feature.zero_crossing_rate(y_mono))
        )
        contrast = librosa.feature.spectral_contrast(y=y_mono, sr=sr)
        features.spectral_contrast = contrast.mean(axis=1).tolist()

        mfcc = librosa.feature.mfcc(y=y_mono, sr=sr, n_mfcc=13)
        features.mfcc = mfcc.mean(axis=1).tolist()

        tonnetz = librosa.feature.tonnetz(y=librosa.effects.harmonic(y_mono), sr=sr)
        features.tonnetz = tonnetz.mean(axis=1).tolist()

        # Category
        if category_hint and category_hint != "unknown":
            try:
                features.category = SoundCategory(category_hint)
            except ValueError:
                features.category = _infer_category_from_path(str(p))
        else:
            cat = _infer_category_from_path(str(p))
            if cat == SoundCategory.UNKNOWN:
                cat = _infer_category_from_spectrum(features)
            features.category = cat

        features.sub_style = _classify_sub_style(
            features.category, features, str(p)
        )
        return features
