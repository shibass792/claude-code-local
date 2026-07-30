"""DSP correctness: the numbers have to mean what they claim to mean."""

from __future__ import annotations

import numpy as np
import pytest

from soundbrain.audio import dsp, envelope, key as key_mod, loudness, stereo, tempo
from soundbrain.audio.io import load, write_wav

SR = 44100


def sine(hz: float, seconds: float = 1.0, amplitude: float = 0.5, sr: int = SR) -> np.ndarray:
    t = np.arange(int(seconds * sr)) / sr
    return (amplitude * np.sin(2 * np.pi * hz * t)).astype(np.float32)


def test_stft_finds_the_right_bin():
    spec = dsp.stft(sine(1000.0), SR)
    peak_bin = int(np.argmax(spec.magnitude.mean(axis=1)))
    assert abs(spec.freqs[peak_bin] - 1000.0) < 25.0


def test_dominant_pitch_recovers_fundamental():
    signal = sine(110.0) + 0.5 * sine(220.0) + 0.25 * sine(330.0)
    spec = dsp.stft(signal.astype(np.float32), SR)
    hz, confidence = dsp.dominant_pitch(spec)
    assert 105.0 < hz < 115.0
    assert confidence > 0.0


def test_spectral_centroid_orders_bright_before_dark():
    dark = dsp.stft(sine(200.0), SR)
    bright = dsp.stft(sine(6000.0), SR)
    assert np.mean(dsp.spectral_centroid(dark)) < np.mean(dsp.spectral_centroid(bright))


def test_rolloff_is_monotonic_in_fraction():
    spec = dsp.stft((sine(300.0) + sine(3000.0) + sine(9000.0)).astype(np.float32), SR)
    assert np.mean(dsp.spectral_rolloff(spec, 0.85)) <= np.mean(dsp.spectral_rolloff(spec, 0.95))


def test_flatness_separates_noise_from_tone():
    rng = np.random.default_rng(0)
    noise = rng.normal(0, 0.3, SR).astype(np.float32)
    tone_flatness = float(np.mean(dsp.spectral_flatness(dsp.stft(sine(440.0), SR))))
    noise_flatness = float(np.mean(dsp.spectral_flatness(dsp.stft(noise, SR))))
    assert noise_flatness > tone_flatness * 10


def test_mfcc_shape_and_dct_orthonormality():
    spec = dsp.stft(sine(440.0), SR)
    coefficients = dsp.mfcc(spec, n_mfcc=13, n_mels=40)
    assert coefficients.shape[0] == 13
    matrix = dsp.dct_matrix(40, 40)
    identity = matrix @ matrix.T
    assert np.allclose(identity, np.eye(40), atol=1e-5)


def test_chroma_puts_energy_in_the_played_pitch_class():
    # A4 = 440 Hz is pitch class 9
    spec = dsp.stft(sine(440.0, 2.0), SR, n_fft=8192, hop=2048)
    chroma = dsp.chromagram(spec)
    assert int(np.argmax(chroma.mean(axis=1))) == 9


def test_tonnetz_has_six_dimensions():
    spec = dsp.stft(sine(440.0), SR, n_fft=8192, hop=2048)
    assert dsp.tonnetz(dsp.chromagram(spec)).shape[0] == 6


def test_spectral_contrast_band_count():
    spec = dsp.stft(sine(440.0), SR)
    assert dsp.spectral_contrast(spec, n_bands=6).shape[0] == 7


@pytest.mark.parametrize("hz,expected", [(440.0, "A4"), (261.63, "C4"), (55.0, "A1")])
def test_note_naming(hz: float, expected: str):
    assert dsp.midi_to_note(dsp.hz_to_midi(hz)) == expected


# ---------------------------------------------------------------------------
# loudness
# ---------------------------------------------------------------------------


def test_lufs_of_a_calibrated_sine():
    """A -20 dBFS 1 kHz sine should read close to -20 LUFS on one channel pair."""
    signal = sine(1000.0, 5.0, amplitude=10 ** (-20.0 / 20.0) * np.sqrt(2))
    stereo_signal = np.stack([signal, signal], axis=1)
    measured = loudness.integrated_lufs(stereo_signal, SR)
    # stereo sums to +3 LU over a single channel
    assert -18.5 < measured < -15.5


def test_lufs_tracks_gain_changes():
    quiet = np.stack([sine(1000.0, 4.0, 0.05)] * 2, axis=1)
    loud = np.stack([sine(1000.0, 4.0, 0.5)] * 2, axis=1)
    delta = loudness.integrated_lufs(loud, SR) - loudness.integrated_lufs(quiet, SR)
    assert 19.0 < delta < 21.0


def test_k_weighting_boosts_highs_and_cuts_lows():
    freqs = np.array([30.0, 1000.0, 8000.0])
    response = loudness.k_weighting_magnitude(freqs, SR)
    assert response[0] < response[1] < response[2]


def test_level_metrics_reports_crest_for_a_sine():
    metrics = loudness.level_metrics(sine(440.0, 2.0), SR)
    assert 2.5 < metrics["crest_db"] < 3.5  # a sine's crest factor is 3.01 dB
    assert metrics["peak_db"] < 0.0


def test_silence_is_reported_as_the_floor():
    metrics = loudness.level_metrics(np.zeros(SR, dtype=np.float32), SR)
    assert metrics["lufs"] <= -70.0
    assert metrics["rms_db"] <= -100.0


# ---------------------------------------------------------------------------
# envelope / onsets / tempo
# ---------------------------------------------------------------------------


def test_attack_and_release_follow_the_shape():
    n = SR
    fast = np.concatenate([np.linspace(0, 1, 100), np.exp(-np.arange(n - 100) / 2000.0)]).astype(np.float32)
    slow = np.concatenate([np.linspace(0, 1, 20000), np.exp(-np.arange(n - 20000) / 20000.0)]).astype(np.float32)
    fast_features = envelope.analyze_envelope(fast * sine(200.0, 1.0), SR)
    slow_features = envelope.analyze_envelope(slow * sine(200.0, 1.0), SR)
    assert fast_features.attack_ms < slow_features.attack_ms
    assert fast_features.transient > slow_features.transient
    assert fast_features.release_ms < slow_features.release_ms


def test_onsets_are_found_at_the_right_times():
    sr = SR
    signal = np.zeros(2 * sr, dtype=np.float32)
    hits = [0.25, 0.75, 1.25, 1.75]
    click = (np.random.default_rng(1).normal(0, 1, 2000) * np.exp(-np.arange(2000) / 200.0)).astype(np.float32)
    for hit in hits:
        start = int(hit * sr)
        signal[start : start + click.size] += click
    spec = dsp.stft(signal, sr, hop=512)
    times, _strength = envelope.detect_onsets(dsp.spectral_flux(spec), 512 / sr)
    assert len(times) == len(hits)
    for detected, expected in zip(times, hits):
        assert abs(detected - expected) < 0.06


def test_tempo_estimate_matches_a_synthetic_grid():
    bpm = 145.0
    beat = 60.0 / bpm
    sr = SR
    duration = 8.0
    signal = np.zeros(int(duration * sr), dtype=np.float32)
    click = (np.random.default_rng(2).normal(0, 1, 1500) * np.exp(-np.arange(1500) / 150.0)).astype(np.float32)
    position = 0.0
    while position < duration - 0.1:
        start = int(position * sr)
        end = min(start + click.size, signal.size)
        signal[start:end] += click[: end - start]
        position += beat
    spec = dsp.stft(signal, sr, hop=512)
    flux = dsp.spectral_flux(spec)
    estimated, confidence, clarity = tempo.estimate_tempo(flux, 512 / sr)
    assert abs(estimated - bpm) < 4.0
    assert confidence > 0.1
    assert clarity > 0.1


def test_rhythm_profile_flags_offbeats():
    bpm = 120.0
    beat = 60.0 / bpm
    onsets = [beat * i + beat / 2 for i in range(8)]
    profile = tempo.rhythm_profile(onsets, bpm, duration=8 * beat)
    assert profile["offbeat_ratio"] < 0.2 or profile["downbeat_ratio"] > 0.8  # phase is relative to the first onset
    assert 0.9 < profile["onsets_per_beat"] < 1.1


def test_rhythm_profile_counts_sixteenth_density():
    bpm = 145.0
    beat = 60.0 / bpm
    onsets = []
    for beat_index in range(8):
        for sixteenth in (1, 2, 3):
            onsets.append(beat_index * beat + sixteenth * beat / 4)
    profile = tempo.rhythm_profile(onsets, bpm, duration=8 * beat)
    assert profile["onsets_per_beat"] > 2.4


# ---------------------------------------------------------------------------
# key
# ---------------------------------------------------------------------------


def test_key_detection_on_a_minor_triad():
    sr = SR
    t = np.arange(3 * sr) / sr
    triad = sum(np.sin(2 * np.pi * hz * t) for hz in (220.0, 261.63, 329.63))  # A C E
    spec = dsp.stft(triad.astype(np.float32), sr, n_fft=8192, hop=2048)
    estimate = key_mod.detect_key(dsp.chromagram(spec))
    assert estimate.tonic == "A"
    assert estimate.mode == "minor"
    assert estimate.confidence > 0.2
    assert estimate.camelot == "8A"


def test_key_distance_ranks_relatives_above_strangers():
    assert key_mod.key_distance("A minor", "A minor") == 0.0
    assert key_mod.key_distance("A minor", "C major") < key_mod.key_distance("A minor", "D# major")
    assert key_mod.compatible_keys("A minor")


def test_interval_consonance_prefers_octaves_over_semitones():
    assert key_mod.interval_consonance(0.0) > key_mod.interval_consonance(7.0)
    assert key_mod.interval_consonance(7.0) > key_mod.interval_consonance(1.0)
    assert key_mod.interval_consonance(12.0) == pytest.approx(key_mod.interval_consonance(0.0))


# ---------------------------------------------------------------------------
# stereo
# ---------------------------------------------------------------------------


def test_stereo_metrics_separate_mono_from_wide():
    mono = np.stack([sine(440.0)] * 2, axis=1)
    wide = np.stack([sine(440.0), -sine(440.0)], axis=1)
    narrow_metrics = stereo.stereo_metrics(mono)
    wide_metrics = stereo.stereo_metrics(wide)
    assert narrow_metrics["stereo_width"] < 0.05
    assert wide_metrics["stereo_width"] > narrow_metrics["stereo_width"]
    assert narrow_metrics["correlation"] > 0.99
    assert wide_metrics["correlation"] < -0.99


def test_band_energies_sum_to_about_one():
    spec = dsp.stft((sine(80.0) + sine(800.0) + sine(5000.0)).astype(np.float32), SR)
    bands = stereo.band_energies(spec.magnitude, spec.freqs)
    assert 0.9 < sum(bands.values()) <= 1.0


# ---------------------------------------------------------------------------
# io
# ---------------------------------------------------------------------------


def test_wav_round_trip_and_resample(tmp_path):
    signal = np.stack([sine(440.0, 1.0), sine(440.0, 1.0) * 0.5], axis=1)
    path = write_wav(tmp_path / "probe.wav", signal, SR)
    buffer = load(path, sample_rate=22050, max_seconds=None)
    assert buffer.channels == 2
    assert buffer.sample_rate == 22050
    assert 0.98 < buffer.duration < 1.02
    spec = dsp.stft(buffer.mono, buffer.sample_rate)
    peak = spec.freqs[int(np.argmax(spec.magnitude.mean(axis=1)))]
    assert abs(peak - 440.0) < 30.0


def test_max_seconds_truncates(tmp_path):
    path = write_wav(tmp_path / "long.wav", sine(220.0, 4.0), SR)
    buffer = load(path, sample_rate=SR, max_seconds=1.0)
    assert buffer.truncated
    assert buffer.duration <= 1.05
