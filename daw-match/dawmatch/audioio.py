"""Audio ingest: pull a YouTube URL down with yt-dlp, decode anything with ffmpeg.

Decoding always lands on the same shape — mono float32 at SAMPLE_RATE — so the
analysis code never has to care whether the input was a link, an mp3, or a
bounced stem.
"""
import os
import re
import subprocess
import wave

import numpy as np

from . import config

SAMPLE_RATE = 22050
PREVIEW_RATE = 44100

_URL_RE = re.compile(r"^https?://", re.I)


class IngestError(RuntimeError):
    """Raised with a message meant to be shown straight to the user."""


def is_url(text):
    return bool(_URL_RE.match((text or "").strip()))


def decode(path, sample_rate=SAMPLE_RATE, max_seconds=180.0):
    """Decode an audio/video file to a mono float32 array in [-1, 1]."""
    if not config.have("ffmpeg"):
        raise IngestError("ffmpeg not found — install it with: brew install ffmpeg")
    if not os.path.exists(path):
        raise IngestError(f"file not found: {path}")

    cmd = [
        "ffmpeg", "-v", "error", "-nostdin",
        "-i", path,
        "-map", "a:0",
        "-t", str(max_seconds),
        "-ac", "1",
        "-ar", str(sample_rate),
        "-f", "s16le", "-",
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0 or not proc.stdout:
        detail = (proc.stderr or b"").decode("utf-8", "replace").strip().splitlines()
        hint = detail[-1] if detail else "no audio stream decoded"
        raise IngestError(f"ffmpeg could not decode {os.path.basename(path)}: {hint}")

    samples = np.frombuffer(proc.stdout, dtype="<i2").astype(np.float32) / 32768.0
    if samples.size < sample_rate:
        raise IngestError("clip is shorter than one second — nothing to analyze")
    return samples


_PATH_TAG = "DAWMATCH_PATH:"
_TITLE_TAG = "DAWMATCH_TITLE:"


def _parse_ytdlp_output(stdout):
    """Pull (path, title) out of yt-dlp's tagged --print output.

    yt-dlp emits each --print at the stage it belongs to, not in the order the
    flags were given, so the lines cannot be read positionally. Tagging each
    field makes the parse order-independent.
    """
    path = title = ""
    for line in (stdout or "").splitlines():
        line = line.strip()
        if line.startswith(_PATH_TAG):
            path = line[len(_PATH_TAG):].strip()
        elif line.startswith(_TITLE_TAG):
            title = line[len(_TITLE_TAG):].strip()
    if not title and path:
        title = os.path.splitext(os.path.basename(path))[0]
    return path, title


def fetch_url(url, dest_dir=None):
    """Download the audio track of a URL. Returns (path, title)."""
    if not config.have("yt-dlp"):
        raise IngestError(
            "yt-dlp not found — install it with: brew install yt-dlp "
            "(or pass a local audio file instead of a link)"
        )
    dest_dir = dest_dir or config.CACHE_DIR
    os.makedirs(dest_dir, exist_ok=True)

    template = os.path.join(dest_dir, "%(id)s.%(ext)s")
    cmd = [
        "yt-dlp", "--no-playlist", "--quiet", "--no-warnings",
        "-f", "bestaudio/best",
        "--print", f"after_move:{_PATH_TAG}%(filepath)s",
        "--print", f"before_dl:{_TITLE_TAG}%(title)s",
        "-o", template,
        url,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if proc.returncode != 0:
        detail = (proc.stderr or "").strip().splitlines()
        hint = detail[-1] if detail else "download failed"
        raise IngestError(f"yt-dlp failed: {hint}")

    path, title = _parse_ytdlp_output(proc.stdout)
    if not path:
        raise IngestError("yt-dlp did not report a downloaded file")
    if not os.path.exists(path):
        raise IngestError(f"yt-dlp reported {path} but it is not on disk")
    return path, title


def resolve_input(text, dest_dir=None):
    """Turn whatever the user pasted into (path, title, source_kind)."""
    text = (text or "").strip().strip('"').strip("'")
    if not text:
        raise IngestError("nothing to analyze — paste a link or a file path")
    if is_url(text):
        path, title = fetch_url(text, dest_dir)
        return path, title, "url"
    path = os.path.expanduser(text)
    if not os.path.exists(path):
        raise IngestError(f"no such file: {path}")
    return path, os.path.splitext(os.path.basename(path))[0], "file"


def write_wav(path, samples, sample_rate=PREVIEW_RATE):
    """Write a float array to a 16-bit mono WAV."""
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak > 0:
        samples = samples / peak * 0.89
    pcm = np.clip(samples * 32767.0, -32768, 32767).astype("<i2")
    with wave.open(path, "wb") as fh:
        fh.setnchannels(1)
        fh.setsampwidth(2)
        fh.setframerate(sample_rate)
        fh.writeframes(pcm.tobytes())
    return path


def wav_bytes(samples, sample_rate=PREVIEW_RATE):
    """Same as write_wav but straight to bytes, for streaming over HTTP."""
    import io

    buf = io.BytesIO()
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak > 0:
        samples = samples / peak * 0.89
    pcm = np.clip(samples * 32767.0, -32768, 32767).astype("<i2")
    with wave.open(buf, "wb") as fh:
        fh.setnchannels(1)
        fh.setsampwidth(2)
        fh.setframerate(sample_rate)
        fh.writeframes(pcm.tobytes())
    return buf.getvalue()


def excerpt_wav_bytes(path, start=0.0, duration=12.0, sample_rate=PREVIEW_RATE):
    """Transcode a slice of an audio file to WAV bytes for browser playback.

    ffmpeg cannot rewind a pipe to fill in the RIFF length, so asking it for
    `-f wav -` yields a header with placeholder sizes and players report a bogus
    duration. Taking raw PCM and writing our own header avoids that.
    """
    if not config.have("ffmpeg"):
        raise IngestError("ffmpeg not found — install it with: brew install ffmpeg")
    cmd = [
        "ffmpeg", "-v", "error", "-nostdin",
        "-ss", str(max(0.0, start)),
        "-i", path,
        "-t", str(duration),
        "-map", "a:0",
        "-ac", "1", "-ar", str(sample_rate),
        "-f", "s16le", "-",
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0 or not proc.stdout:
        raise IngestError(f"could not build a preview for {os.path.basename(path)}")
    samples = np.frombuffer(proc.stdout, dtype="<i2").astype(np.float32) / 32768.0
    return wav_bytes(samples, sample_rate)
