"""Stage 3 — the analyser.

One pass over a file produces every descriptor the rest of the engine needs:
transient, attack, release, envelope, stereo width, dynamics, RMS, LUFS, MFCC,
spectral roll-off, tonnetz, chroma, spectral contrast, tempo confidence and key
confidence — plus the stage 2 role/subtype decision and a compact similarity
vector used by the matcher.
"""

from __future__ import annotations

import math
import time
from pathlib import Path
from typing import Any, Callable, Sequence

import numpy as np

from . import taxonomy
from .audio import io as audio_io
from .audio import dsp, envelope as env_mod, key as key_mod, loudness, stereo as stereo_mod, tempo as tempo_mod
from .config import Config
from .db import Database

ProgressFn = Callable[[str, int, int], None]

N_FFT = 2048
HOP = 512
#: chroma and key need finer frequency resolution than the general features:
#: 8192 samples at 44.1 kHz is ~5.4 Hz per bin, enough to resolve semitones
#: down to the low bass register
CHROMA_N_FFT = 8192
CHROMA_HOP = 2048


def _sanitize(value: Any) -> Any:
    """Replace NaN/Inf so the record is JSON-serialisable."""
    if isinstance(value, dict):
        return {k: _sanitize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sanitize(v) for v in value]
    if isinstance(value, (np.floating, float)):
        f = float(value)
        return 0.0 if (math.isnan(f) or math.isinf(f)) else round(f, 6)
    if isinstance(value, (np.integer, int)):
        return int(value)
    if isinstance(value, np.ndarray):
        return _sanitize(value.tolist())
    return value


def _slope_per_second(values: np.ndarray, times: np.ndarray) -> float:
    """Least-squares slope of log2(values) against time, in octaves/second."""
    usable = values > 1.0
    if usable.sum() < 4:
        return 0.0
    y = np.log2(values[usable])
    x = times[usable]
    if x.max() - x.min() < 1e-3:
        return 0.0
    slope = float(np.polyfit(x, y, 1)[0])
    return slope


def similarity_vector(features: dict[str, Any]) -> list[float]:
    """Compact, roughly unit-scaled vector for nearest-neighbour search."""
    mfcc = list(features.get("mfcc_mean") or [])[:13]
    mfcc = (mfcc + [0.0] * 13)[:13]
    contrast = list(features.get("contrast_mean") or [])[:7]
    contrast = (contrast + [0.0] * 7)[:7]
    vector = [
        *[v / 40.0 for v in mfcc],
        *[v / 20.0 for v in contrast],
        math.log2(max(features.get("centroid_hz") or 1.0, 1.0)) / 15.0,
        math.log2(max(features.get("rolloff85_hz") or 1.0, 1.0)) / 15.0,
        math.log2(max(features.get("fundamental_hz") or 1.0, 1.0)) / 12.0,
        min(float(features.get("attack_ms") or 0.0) / 500.0, 1.0),
        min(float(features.get("release_ms") or 0.0) / 2000.0, 1.0),
        float(features.get("sustain_ratio") or 0.0),
        float(features.get("transient") or 0.0),
        float(features.get("stereo_width") or 0.0) / 2.0,
        float(features.get("flatness") or 0.0) * 5.0,
        float(features.get("energy") or 0.0),
    ]
    return [round(float(v), 6) for v in vector]


def _energy_score(level: dict[str, float], high_share: float, onsets_per_beat: float, transient: float) -> float:
    """Perceived intensity, 0 (ambient) .. 1 (peak-time)."""
    lufs = level.get("lufs", -70.0)
    loud = np.clip((lufs + 30.0) / 24.0, 0.0, 1.0)
    bright = np.clip(high_share * 3.0, 0.0, 1.0)
    dense = np.clip(onsets_per_beat / 4.0, 0.0, 1.0)
    return float(np.clip(0.45 * loud + 0.2 * bright + 0.2 * dense + 0.15 * transient, 0.0, 1.0))


def analyze_buffer(
    buffer: audio_io.AudioBuffer,
    path: str = "",
    extra_text: Sequence[str] = (),
    bpm_hint: float | None = None,
    key_hint: str | None = None,
) -> dict[str, Any]:
    """Full stage 3 + stage 2 analysis of an already decoded buffer."""
    mono = buffer.mono
    sr = buffer.sample_rate
    spec = dsp.stft(mono, sr, n_fft=N_FFT, hop=HOP)

    centroid = dsp.spectral_centroid(spec)
    rolloff85 = dsp.spectral_rolloff(spec, 0.85)
    rolloff95 = dsp.spectral_rolloff(spec, 0.95)
    flatness = dsp.spectral_flatness(spec)
    bandwidth = dsp.spectral_bandwidth(spec, centroid)
    flux = dsp.spectral_flux(spec)
    contrast = dsp.spectral_contrast(spec)
    mfcc = dsp.mfcc(spec)
    chroma_spec = dsp.stft(mono, sr, n_fft=CHROMA_N_FFT, hop=CHROMA_HOP)
    chroma = dsp.chromagram(chroma_spec)
    tonnetz = dsp.tonnetz(chroma)
    zcr = dsp.zero_crossing_rate(mono, N_FFT, HOP)
    fundamental, pitch_conf = dsp.dominant_pitch(spec)

    hop_seconds = HOP / float(sr)
    onset_times, onset_strengths = env_mod.detect_onsets(flux, hop_seconds)
    envelope = env_mod.analyze_envelope(mono, sr, onset_env=flux, onset_times=onset_times)
    tempo_features = tempo_mod.analyze_tempo(flux, hop_seconds, onset_times, buffer.duration, bpm_hint=bpm_hint)
    key_estimate = key_mod.detect_key(chroma)
    level = loudness.level_metrics(buffer.samples, sr)
    stereo = stereo_mod.stereo_metrics(buffer.samples)
    bands = stereo_mod.band_energies(spec.magnitude, spec.freqs)

    high_share = bands.get("band_4000_8000", 0.0) + bands.get("band_8000_16000", 0.0)

    features: dict[str, Any] = {
        "path": path or "",
        "name": Path(path).name if path else "",
        "analyzed_at": time.time(),
        "duration": buffer.duration,
        "sample_rate": buffer.source_sample_rate,
        "analysis_sample_rate": sr,
        "channels": buffer.channels,
        "bit_depth": buffer.bit_depth,
        "decoder": buffer.decoder,
        "truncated": buffer.truncated,
        # spectral
        "centroid_hz": float(np.mean(centroid)),
        "centroid_slope": _slope_per_second(centroid, spec.times),
        "rolloff85_hz": float(np.mean(rolloff85)),
        "rolloff95_hz": float(np.mean(rolloff95)),
        "bandwidth_hz": float(np.mean(bandwidth)),
        "flatness": float(np.mean(flatness)),
        "flux_mean": float(np.mean(flux)),
        "zcr": float(np.mean(zcr)),
        "mfcc_mean": [float(v) for v in mfcc.mean(axis=1)],
        "mfcc_std": [float(v) for v in mfcc.std(axis=1)],
        "chroma": [float(v) for v in chroma.mean(axis=1)],
        "tonnetz": [float(v) for v in tonnetz.mean(axis=1)],
        "contrast_mean": [float(v) for v in contrast.mean(axis=1)],
        # pitch / key
        "fundamental_hz": float(fundamental),
        "pitch_conf": float(pitch_conf),
        "midi_note": float(dsp.hz_to_midi(fundamental)) if fundamental > 0 else 0.0,
        "note_name": dsp.midi_to_note(dsp.hz_to_midi(fundamental)) if fundamental > 0 else "",
        # levels
        **level,
        # stereo
        **stereo,
        **bands,
    }
    features.update(envelope.as_dict())
    features.update(tempo_features.as_dict())
    features.update(key_estimate.as_dict())

    if key_hint:
        features["key_hint"] = key_hint
        if key_estimate.confidence < 0.45:
            features["musical_key"] = key_hint
            features["key_tonic"] = key_hint.split(" ")[0]
            features["key_mode"] = key_hint.split(" ")[-1]
            features["key_conf"] = 0.55
            features["camelot"] = key_mod.CAMELOT.get(key_hint, "")
            features["key_source"] = "filename"
        else:
            features["key_source"] = "audio"
            features["key_agrees_with_name"] = key_hint == key_estimate.key
    else:
        features["key_source"] = "audio"

    features["energy"] = _energy_score(level, high_share, tempo_features.onsets_per_beat, envelope.transient)

    classification = taxonomy.classify(features, path=path, extra_text=extra_text)
    features.update(classification.as_dict())
    features["role_scores"] = classification.role_scores
    features["vector"] = similarity_vector(features)
    return _sanitize(features)


def analyze_file(
    path: str | Path,
    cfg: Config | None = None,
    extra_text: Sequence[str] = (),
) -> dict[str, Any]:
    """Decode and analyse one audio file."""
    cfg = cfg or Config()
    target = Path(path)
    buffer = audio_io.load(
        target,
        sample_rate=cfg.analysis_sample_rate,
        max_seconds=cfg.analysis_seconds,
        max_bytes=int(cfg.max_audio_mb * 1024 * 1024),
    )
    bpm_hint = taxonomy.bpm_from_name(str(target))
    key_hint = taxonomy.key_from_name(target.name)
    return analyze_buffer(buffer, path=str(target), extra_text=extra_text, bpm_hint=bpm_hint, key_hint=key_hint)


def analyze_pending(
    db: Database,
    cfg: Config,
    limit: int | None = None,
    progress: ProgressFn | None = None,
) -> dict[str, Any]:
    """Analyse every audio file whose analysis is missing or stale."""
    rows = db.pending_analysis("audio", limit=limit)
    total = len(rows)
    done = 0
    failed: list[dict[str, str]] = []
    started = time.time()
    for index, row in enumerate(rows, start=1):
        path = str(row["path"])
        try:
            features = analyze_file(path, cfg, extra_text=[str(row["library"] or ""), str(row["tool"] or "")])
            db.save_analysis(int(row["id"]), features)
            done += 1
        except Exception as exc:  # noqa: BLE001 - a broken sample must not stop the run
            failed.append({"path": path, "error": f"{type(exc).__name__}: {exc}"})
        if progress:
            progress(path, index, total)
        if index % 50 == 0:
            db.commit()
    db.commit()
    return {
        "total": total,
        "analyzed": done,
        "failed": len(failed),
        "failures": failed[:25],
        "elapsed": round(time.time() - started, 2),
    }
