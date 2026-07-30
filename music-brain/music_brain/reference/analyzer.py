"""Analyze a reference track from YouTube URL or local audio path."""

from __future__ import annotations

import hashlib
import time
from pathlib import Path
from typing import Any

from music_brain.analyzer.audio_analyzer import AudioAnalyzer
from music_brain.reference.youtube import (
    download_youtube_audio,
    fetch_youtube_metadata,
    is_youtube_url,
    save_reference_registry,
)

AUDIO_EXTENSIONS = {".wav", ".mp3", ".flac", ".m4a", ".ogg", ".aac", ".aiff", ".aif", ".wma"}


class ReferenceAnalyzer:
    def __init__(
        self,
        cache_dir: str | Path = "data/references",
        registry_path: str | Path = "data/reference_registry.json",
        max_analyze_sec: float = 90.0,
    ) -> None:
        self.cache_dir = Path(cache_dir)
        self.registry_path = Path(registry_path)
        self.max_analyze_sec = max_analyze_sec
        self._analyzer = AudioAnalyzer(max_duration_sec=max_analyze_sec)

    def analyze(self, source: str) -> dict[str, Any]:
        source = source.strip()
        if not source:
            raise ValueError("נא להדביק קישור YouTube או נתיב לקובץ אודיו")

        if is_youtube_url(source):
            return self._analyze_youtube(source)
        return self._analyze_local(source)

    def _analyze_youtube(self, url: str) -> dict[str, Any]:
        meta = fetch_youtube_metadata(url)
        ref_id = meta["video_id"]
        ref_dir = self.cache_dir / ref_id
        audio_path = ref_dir / f"{ref_id}.wav"
        if not audio_path.is_file():
            audio_path = download_youtube_audio(url, ref_dir, self.max_analyze_sec)

        features = self._analyzer.analyze(str(audio_path))
        entry = self._build_entry(
            ref_id=ref_id,
            source_type="youtube",
            source_url=url,
            title=meta.get("title") or ref_id,
            audio_path=audio_path,
            features=features,
        )
        save_reference_registry(self.registry_path, entry)
        return entry

    def _analyze_local(self, path_str: str) -> dict[str, Any]:
        path = Path(path_str).expanduser()
        if not path.is_file():
            raise FileNotFoundError(f"קובץ לא נמצא: {path}")
        if path.suffix.lower() not in AUDIO_EXTENSIONS:
            raise ValueError("סוג קובץ לא נתמך — השתמש ב-WAV/MP3/FLAC וכו'")

        digest = hashlib.sha1(str(path.resolve()).encode("utf-8")).hexdigest()[:12]
        ref_id = f"local_{digest}"
        features = self._analyzer.analyze(str(path))
        entry = self._build_entry(
            ref_id=ref_id,
            source_type="local",
            source_url=str(path.resolve()),
            title=path.stem,
            audio_path=path,
            features=features,
        )
        save_reference_registry(self.registry_path, entry)
        return entry

    def _build_entry(
        self,
        ref_id: str,
        source_type: str,
        source_url: str,
        title: str,
        audio_path: Path,
        features: Any,
    ) -> dict[str, Any]:
        return {
            "id": ref_id,
            "source_type": source_type,
            "source_url": source_url,
            "title": title,
            "audio_path": str(audio_path.resolve()),
            "bpm": features.bpm,
            "bpm_confidence": features.bpm_confidence,
            "key": features.key,
            "key_confidence": features.key_confidence,
            "mode": features.mode,
            "lufs": features.lufs,
            "analyzed_at": time.time(),
            "preview_url": f"/api/reference/{ref_id}/stream",
        }

    def get_cached(self, ref_id: str) -> dict[str, Any] | None:
        if not self.registry_path.is_file():
            return None
        import json

        data = json.loads(self.registry_path.read_text(encoding="utf-8"))
        for ref in data.get("references", []):
            if ref.get("id") == ref_id:
                return ref
        return None

    def resolve_audio_path(self, ref_id: str) -> Path | None:
        ref = self.get_cached(ref_id)
        if not ref:
            return None
        path = Path(ref["audio_path"])
        return path if path.is_file() else None
