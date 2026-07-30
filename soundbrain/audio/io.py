"""Audio decoding.

Three decoders are tried in order, so the engine works on a bare Python
install and gets better when optional tools are present:

1. ``soundfile`` (libsndfile) — wav / aiff / flac / ogg, fast and exact
2. the stdlib ``wave`` module — plain PCM wav, always available
3. ``ffmpeg`` on ``PATH`` — mp3 / m4a / opus / anything else

Everything is returned as float32 in ``[-1, 1]`` with shape ``(frames, channels)``.
"""

from __future__ import annotations

import shutil
import subprocess
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np

try:  # pragma: no cover - optional dependency
    import soundfile as _soundfile
except Exception:  # pragma: no cover
    _soundfile = None  # type: ignore[assignment]


class AudioLoadError(RuntimeError):
    """Raised when no decoder could read a file."""


@dataclass
class AudioBuffer:
    """Decoded audio, always float32 shaped ``(frames, channels)``."""

    samples: np.ndarray
    sample_rate: int
    source_sample_rate: int
    duration: float
    channels: int
    bit_depth: int | None = None
    truncated: bool = False
    decoder: str = ""

    @property
    def mono(self) -> np.ndarray:
        if self.samples.ndim == 1:
            return self.samples
        if self.samples.shape[1] == 1:
            return self.samples[:, 0]
        return self.samples.mean(axis=1)

    @property
    def frames(self) -> int:
        return int(self.samples.shape[0])


def decoders_available() -> dict[str, bool]:
    return {
        "soundfile": _soundfile is not None,
        "wave": True,
        "ffmpeg": shutil.which("ffmpeg") is not None,
    }


# ---------------------------------------------------------------------------
# resampling
# ---------------------------------------------------------------------------


def resample(samples: np.ndarray, src_sr: int, dst_sr: int) -> np.ndarray:
    """Linear-interpolation resampler with a decimation pre-filter.

    Good enough for feature extraction: the pre-average keeps aliasing out of
    the spectral statistics when downsampling (e.g. 96 kHz -> 44.1 kHz).
    """
    if src_sr == dst_sr or samples.size == 0:
        return samples
    ratio = src_sr / float(dst_sr)
    if ratio > 1.2:
        taps = max(2, int(round(ratio)))
        kernel = np.ones(taps, dtype=np.float32) / taps
        filtered = np.empty_like(samples)
        for ch in range(samples.shape[1]):
            filtered[:, ch] = np.convolve(samples[:, ch], kernel, mode="same")
        samples = filtered
    n_out = int(round(samples.shape[0] / ratio))
    if n_out <= 1:
        return samples[:1]
    src_idx = np.linspace(0.0, samples.shape[0] - 1.0, n_out, dtype=np.float64)
    out = np.empty((n_out, samples.shape[1]), dtype=np.float32)
    base = np.arange(samples.shape[0], dtype=np.float64)
    for ch in range(samples.shape[1]):
        out[:, ch] = np.interp(src_idx, base, samples[:, ch]).astype(np.float32)
    return out


def _as_2d(samples: np.ndarray) -> np.ndarray:
    if samples.ndim == 1:
        return samples.reshape(-1, 1)
    return samples


# ---------------------------------------------------------------------------
# decoders
# ---------------------------------------------------------------------------


def _load_soundfile(path: Path, max_frames: int | None) -> tuple[np.ndarray, int, int | None]:
    assert _soundfile is not None
    with _soundfile.SoundFile(str(path)) as handle:
        sr = int(handle.samplerate)
        frames = handle.read(frames=max_frames or -1, dtype="float32", always_2d=True)
        subtype = handle.subtype or ""
    depth = None
    for token, bits in (("PCM_16", 16), ("PCM_24", 24), ("PCM_32", 32), ("FLOAT", 32), ("DOUBLE", 64), ("PCM_U8", 8)):
        if token in subtype:
            depth = bits
            break
    return frames, sr, depth


def _load_wave(path: Path, max_frames: int | None) -> tuple[np.ndarray, int, int | None]:
    with wave.open(str(path), "rb") as handle:
        sr = handle.getframerate()
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        n_frames = handle.getnframes()
        want = min(n_frames, max_frames) if max_frames else n_frames
        raw = handle.readframes(want)

    if width == 1:
        data = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    elif width == 2:
        data = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    elif width == 3:
        buf = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        ints = (buf[:, 0] | (buf[:, 1] << 8) | (buf[:, 2] << 16)).astype(np.int32)
        ints = np.where(ints & 0x800000, ints - 0x1000000, ints)
        data = ints.astype(np.float32) / 8388608.0
    elif width == 4:
        data = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
    else:  # pragma: no cover - exotic widths
        raise AudioLoadError(f"unsupported sample width {width} in {path}")

    usable = (data.size // channels) * channels
    frames = data[:usable].reshape(-1, channels)
    return frames, int(sr), width * 8


def _load_ffmpeg(path: Path, max_seconds: float | None, target_sr: int) -> tuple[np.ndarray, int, int | None]:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise AudioLoadError("ffmpeg not available")
    cmd = [exe, "-v", "quiet", "-i", str(path)]
    if max_seconds:
        cmd += ["-t", f"{max_seconds:.3f}"]
    cmd += ["-f", "f32le", "-acodec", "pcm_f32le", "-ar", str(target_sr), "-"]
    proc = subprocess.run(cmd, capture_output=True, check=False)
    if proc.returncode != 0 or not proc.stdout:
        raise AudioLoadError(f"ffmpeg failed on {path}")
    data = np.frombuffer(proc.stdout, dtype="<f4")
    channels = _ffmpeg_channels(exe, path)
    usable = (data.size // channels) * channels
    return data[:usable].reshape(-1, channels).astype(np.float32), target_sr, None


def _ffmpeg_channels(exe: str, path: Path) -> int:
    probe = shutil.which("ffprobe")
    if probe:
        proc = subprocess.run(
            [probe, "-v", "quiet", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "csv=p=0", str(path)],
            capture_output=True,
            check=False,
            text=True,
        )
        value = (proc.stdout or "").strip().split("\n")[0]
        if value.isdigit() and int(value) > 0:
            return int(value)
    return 2


def load(
    path: str | Path,
    sample_rate: int = 44100,
    max_seconds: float | None = 30.0,
    max_bytes: int | None = None,
) -> AudioBuffer:
    """Decode ``path`` and return an :class:`AudioBuffer` at ``sample_rate``."""
    target = Path(path)
    if not target.is_file():
        raise AudioLoadError(f"not a file: {target}")
    if max_bytes and target.stat().st_size > max_bytes:
        raise AudioLoadError(f"file too large ({target.stat().st_size} bytes): {target}")

    errors: list[str] = []
    frames: np.ndarray | None = None
    src_sr = sample_rate
    depth: int | None = None
    decoder = ""

    # soundfile / wave read at the native rate, so read a generous number of
    # frames and trim after we know the rate.
    if _soundfile is not None:
        try:
            frames, src_sr, depth = _load_soundfile(target, None)
            decoder = "soundfile"
        except Exception as exc:  # pragma: no cover - depends on file
            errors.append(f"soundfile: {exc}")
            frames = None

    if frames is None and target.suffix.lower() in (".wav", ".wave", ".w64"):
        try:
            frames, src_sr, depth = _load_wave(target, None)
            decoder = "wave"
        except Exception as exc:
            errors.append(f"wave: {exc}")
            frames = None

    if frames is None:
        try:
            frames, src_sr, depth = _load_ffmpeg(target, max_seconds, sample_rate)
            decoder = "ffmpeg"
        except Exception as exc:
            errors.append(f"ffmpeg: {exc}")
            frames = None

    if frames is None or frames.size == 0:
        raise AudioLoadError(f"could not decode {target}: {'; '.join(errors) or 'empty file'}")

    frames = _as_2d(np.asarray(frames, dtype=np.float32))
    truncated = False
    if max_seconds:
        limit = int(max_seconds * src_sr)
        if frames.shape[0] > limit:
            frames = frames[:limit]
            truncated = True

    resampled = resample(frames, src_sr, sample_rate)
    resampled = np.nan_to_num(resampled, nan=0.0, posinf=0.0, neginf=0.0)
    duration = resampled.shape[0] / float(sample_rate)
    return AudioBuffer(
        samples=resampled,
        sample_rate=sample_rate,
        source_sample_rate=src_sr,
        duration=duration,
        channels=int(resampled.shape[1]),
        bit_depth=depth,
        truncated=truncated,
        decoder=decoder,
    )


def write_wav(path: str | Path, samples: np.ndarray, sample_rate: int = 44100) -> Path:
    """Write float samples as 24-bit PCM wav (used by tests and exports)."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    data = _as_2d(np.asarray(samples, dtype=np.float32))
    clipped = np.clip(data, -1.0, 1.0)
    ints = np.round(clipped * 8388607.0).astype(np.int32)
    packed = np.empty((ints.shape[0], ints.shape[1], 3), dtype=np.uint8)
    packed[:, :, 0] = (ints & 0xFF).astype(np.uint8)
    packed[:, :, 1] = ((ints >> 8) & 0xFF).astype(np.uint8)
    packed[:, :, 2] = ((ints >> 16) & 0xFF).astype(np.uint8)
    with wave.open(str(target), "wb") as handle:
        handle.setnchannels(data.shape[1])
        handle.setsampwidth(3)
        handle.setframerate(sample_rate)
        handle.writeframes(packed.tobytes())
    return target
