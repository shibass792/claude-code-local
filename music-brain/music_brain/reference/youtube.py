"""YouTube / share URL helpers — metadata + optional audio download via yt-dlp."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

YOUTUBE_ID_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?v=|embed/|shorts/)|youtu\.be/)([A-Za-z0-9_-]{6,})"
)


def extract_youtube_id(url: str) -> str | None:
    match = YOUTUBE_ID_RE.search(url)
    if match:
        return match.group(1)
    parsed = urlparse(url)
    if "youtube.com" in parsed.netloc:
        qs = parse_qs(parsed.query)
        if "v" in qs and qs["v"]:
            return qs["v"][0]
    return None


def is_youtube_url(text: str) -> bool:
    return extract_youtube_id(text.strip()) is not None


def _yt_dlp_bin() -> str | None:
    for name in ("yt-dlp", "yt_dlp"):
        path = shutil.which(name)
        if path:
            return path
    return None


def fetch_youtube_metadata(url: str) -> dict[str, Any]:
    """Return title, id, duration without downloading audio."""
    video_id = extract_youtube_id(url)
    if not video_id:
        raise ValueError("לא זוהה קישור YouTube תקין")

    bin_path = _yt_dlp_bin()
    if bin_path:
        proc = subprocess.run(
            [
                bin_path,
                "--no-playlist",
                "--skip-download",
                "--print",
                "%(id)s\t%(title)s\t%(duration)s",
                url,
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            parts = proc.stdout.strip().split("\t", 2)
            if len(parts) >= 2:
                duration = float(parts[2]) if len(parts) > 2 and parts[2] else None
                return {
                    "video_id": parts[0],
                    "title": parts[1],
                    "duration_sec": duration,
                    "source_url": url,
                }

    return {
        "video_id": video_id,
        "title": f"YouTube {video_id}",
        "duration_sec": None,
        "source_url": url,
    }


def download_youtube_audio(url: str, dest_dir: Path, max_duration_sec: float = 90.0) -> Path:
    """Download reference audio snippet for BPM/key analysis."""
    bin_path = _yt_dlp_bin()
    if not bin_path:
        raise RuntimeError(
            "yt-dlp לא מותקן — התקן עם: pip install yt-dlp "
            "או העלה קובץ אודיו מקומי במקום קישור YouTube"
        )

    dest_dir.mkdir(parents=True, exist_ok=True)
    video_id = extract_youtube_id(url) or "reference"
    out_template = str(dest_dir / f"{video_id}.%(ext)s")

    cmd = [
        bin_path,
        "--no-playlist",
        "-f",
        "bestaudio/best",
        "--extract-audio",
        "--audio-format",
        "wav",
        "--audio-quality",
        "0",
        "--postprocessor-args",
        f"ffmpeg:-t {int(max_duration_sec)}",
        "-o",
        out_template,
        url,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180, check=False)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "הורדת YouTube נכשלה")

    candidates = sorted(dest_dir.glob(f"{video_id}.*"))
    audio_exts = {".wav", ".mp3", ".m4a", ".ogg", ".opus", ".webm"}
    for path in candidates:
        if path.suffix.lower() in audio_exts:
            return path
    if candidates:
        return candidates[0]
    raise RuntimeError("לא נמצא קובץ אודיו אחרי ההורדה")


def save_reference_registry(registry_path: Path, entry: dict[str, Any]) -> None:
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    data: dict[str, Any] = {"references": []}
    if registry_path.is_file():
        try:
            data = json.loads(registry_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            data = {"references": []}
    refs = data.setdefault("references", [])
    refs = [r for r in refs if r.get("id") != entry.get("id")]
    refs.insert(0, entry)
    data["references"] = refs[:200]
    registry_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
