"""Resolve a YouTube link, song title or local path into a match profile.

The Match Panel accepts whatever a producer pastes:

* a YouTube / youtu.be URL  → title + channel via oEmbed (metadata only)
* a local audio / project path → analyse or read from the index
* free text ("Astrix Deep Jungle 145") → title/artist/BPM/key tokens

Nothing is uploaded. YouTube audio is never downloaded; we only read the public
title so we can search *your* library for a matching ARP or DAW project.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import analyzer, search as search_mod
from .config import Config
from .db import Database
from .taxonomy import bpm_from_name, key_from_name, normalize_text

YOUTUBE_RE = re.compile(
    r"(?:https?://)?(?:www\.)?(?:youtube\.com/(?:watch\?v=|shorts/|embed/)|youtu\.be/)([\w\-]{6,})",
    re.IGNORECASE,
)
SEPARATORS = re.compile(r"\s*[-–—|·•]\s*|\s+by\s+", re.IGNORECASE)
NOISE_WORDS = {
    "official",
    "video",
    "audio",
    "lyrics",
    "hq",
    "hd",
    "4k",
    "visualizer",
    "full",
    "track",
    "premiere",
    "music",
}


@dataclass
class TrackReference:
    """What the producer brought in, normalised for matching."""

    source: str = "text"  # youtube | path | text | file_id
    input: str = ""
    url: str = ""
    title: str = ""
    artist: str = ""
    channel: str = ""
    path: str = ""
    file_id: int | None = None
    bpm: float | None = None
    key: str = ""
    query: str = ""
    notes: list[str] = field(default_factory=list)
    features: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "input": self.input,
            "url": self.url,
            "title": self.title,
            "artist": self.artist,
            "channel": self.channel,
            "path": self.path,
            "file_id": self.file_id,
            "bpm": self.bpm,
            "key": self.key,
            "query": self.query,
            "notes": self.notes,
            "has_features": bool(self.features.get("vector")),
        }

    def search_query(self) -> str:
        bits = [b for b in (self.artist, self.title, self.query) if b]
        if self.bpm:
            bits.append(f"{self.bpm:.0f} bpm")
        if self.key:
            bits.append(self.key)
        return " ".join(bits).strip() or self.input


def is_youtube_url(text: str) -> bool:
    return bool(YOUTUBE_RE.search(text.strip()))


def youtube_video_id(text: str) -> str | None:
    match = YOUTUBE_RE.search(text.strip())
    return match.group(1) if match else None


def _http_json(url: str, timeout: float = 8.0) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": "SoundBrain/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8", "ignore"))


def fetch_youtube_meta(url: str, timeout: float = 8.0) -> dict[str, Any]:
    """Public oEmbed metadata only — title, author, thumbnail. No audio."""
    video_id = youtube_video_id(url)
    if not video_id:
        raise ValueError("not a recognised YouTube URL")
    canonical = f"https://www.youtube.com/watch?v={video_id}"
    oembed = (
        "https://www.youtube.com/oembed?"
        + urllib.parse.urlencode({"url": canonical, "format": "json"})
    )
    try:
        data = _http_json(oembed, timeout=timeout)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        raise ValueError(f"could not read YouTube metadata: {exc}") from exc
    return {
        "video_id": video_id,
        "url": canonical,
        "title": str(data.get("title") or "").strip(),
        "channel": str(data.get("author_name") or "").strip(),
        "thumbnail": str(data.get("thumbnail_url") or ""),
    }


def split_title_artist(raw: str) -> tuple[str, str]:
    """Best-effort split of 'Artist - Track (Official Video)' style titles."""
    cleaned = re.sub(r"[\(\[\{].*?[\)\]\}]", " ", raw)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -–—|·•")
    parts = SEPARATORS.split(cleaned, maxsplit=1)
    if len(parts) == 2 and all(p.strip() for p in parts):
        left, right = parts[0].strip(), parts[1].strip()
        # Prefer shorter side as artist when it looks like a name
        if len(left.split()) <= 4:
            return left, right
        return right, left
    return "", cleaned


def extract_tokens(text: str) -> tuple[float | None, str, list[str]]:
    bpm = bpm_from_name(text)
    key = key_from_name(text) or ""
    words = [
        w
        for w in re.findall(r"[A-Za-zא-ת0-9#]+", text)
        if w.lower() not in NOISE_WORDS and len(w) > 1
    ]
    return bpm, key, words


def resolve(
    db: Database,
    cfg: Config,
    raw: str,
    *,
    file_id: int | None = None,
    analyze_local: bool = True,
) -> TrackReference:
    """Turn whatever the panel received into a ``TrackReference``."""
    text = (raw or "").strip()
    ref = TrackReference(input=text)

    if file_id is not None:
        features = db.analysis(file_id)
        if not features:
            raise FileNotFoundError(f"no analysis for file_id {file_id}")
        row = db.file_by_id(file_id) if hasattr(db, "file_by_id") else None
        if row is None:
            row = db.conn.execute("SELECT * FROM files WHERE id=?", (file_id,)).fetchone()
        ref.source = "file_id"
        ref.file_id = file_id
        ref.path = str(row["path"]) if row else str(features.get("path") or "")
        ref.title = Path(ref.path).stem
        ref.bpm = float(features["bpm"]) if features.get("bpm") else None
        ref.key = str(features.get("musical_key") or "")
        ref.features = features
        ref.query = ref.title
        ref.notes.append("seeded from an analysed library file")
        return ref

    if not text:
        raise ValueError("provide a YouTube link, song name or local path")

    if is_youtube_url(text):
        meta = fetch_youtube_meta(text)
        artist, title = split_title_artist(meta["title"])
        if not artist and meta.get("channel"):
            artist = meta["channel"]
        bpm, key, _words = extract_tokens(meta["title"])
        ref.source = "youtube"
        ref.url = meta["url"]
        ref.title = title or meta["title"]
        ref.artist = artist
        ref.channel = meta.get("channel", "")
        ref.bpm = bpm
        ref.key = key
        ref.query = f"{artist} {title}".strip() or meta["title"]
        ref.notes.append("YouTube metadata via oEmbed (title/channel only)")
        if bpm:
            ref.notes.append(f"BPM {bpm:.0f} read from the title")
        if key:
            ref.notes.append(f"key {key} read from the title")
        return ref

    candidate = Path(text)
    if candidate.exists() and candidate.is_file():
        resolved = str(candidate.resolve())
        ref.source = "path"
        ref.path = resolved
        ref.title = candidate.stem
        bpm, key, _ = extract_tokens(candidate.name)
        ref.bpm = bpm
        ref.key = key or ""
        row = db.file_by_path(resolved)
        if row is None:
            # try relative/alternate slash forms
            row = db.conn.execute(
                "SELECT * FROM files WHERE LOWER(path)=LOWER(?) LIMIT 1",
                (resolved,),
            ).fetchone()
        if row is not None:
            ref.file_id = int(row["id"])
            features = db.analysis(int(row["id"]))
            if features:
                ref.features = features
                ref.bpm = float(features["bpm"]) if features.get("bpm") else ref.bpm
                ref.key = str(features.get("musical_key") or ref.key)
                ref.notes.append("matched an indexed file")
        elif analyze_local and candidate.suffix.lower() in {
            ".wav", ".wave", ".aif", ".aiff", ".flac", ".mp3", ".ogg", ".m4a",
        }:
            try:
                features = analyzer.analyze_file(resolved, cfg)
                ref.features = features or {}
                if features:
                    ref.bpm = float(features["bpm"]) if features.get("bpm") else ref.bpm
                    ref.key = str(features.get("musical_key") or ref.key)
                    ref.notes.append("analysed local audio on the fly")
            except Exception as exc:  # noqa: BLE001 - keep matching usable
                ref.notes.append(f"local analysis skipped: {exc}")
        ref.query = ref.title
        return ref

    # Free-text song / style query
    artist, title = split_title_artist(text)
    bpm, key, words = extract_tokens(text)
    ref.source = "text"
    ref.artist = artist
    ref.title = title or text
    ref.bpm = bpm
    ref.key = key
    ref.query = " ".join(words) if words else text
    ref.notes.append("treated as a free-text song / style query")

    # If the library already has a close name match, prefer its analysis
    like = f"%{normalize_text(ref.title)[:40]}%"
    hit = db.conn.execute(
        """SELECT f.id, f.path, f.name FROM files f
           WHERE f.missing=0 AND f.kind='audio'
             AND (LOWER(f.name) LIKE ? OR LOWER(f.path) LIKE ?)
           LIMIT 1""",
        (like, like),
    ).fetchone()
    if hit is not None:
        features = db.analysis(int(hit["id"]))
        if features:
            ref.file_id = int(hit["id"])
            ref.path = str(hit["path"])
            ref.features = features
            ref.bpm = float(features["bpm"]) if features.get("bpm") else ref.bpm
            ref.key = str(features.get("musical_key") or ref.key)
            ref.notes.append(f"grounded in library file {hit['name']}")

    return ref


def profile_from_reference(ref: TrackReference) -> dict[str, Any]:
    """Build a matcher profile for ARP / lead / loop search."""
    profile: dict[str, Any] = {"role": "lead", "subtype": "arp"}
    if ref.bpm:
        profile["bpm"] = float(ref.bpm)
    if ref.key:
        profile["key"] = ref.key
    if ref.features.get("vector"):
        profile["vector"] = ref.features["vector"]
        if ref.features.get("energy") is not None:
            profile["energy"] = float(ref.features["energy"])
        if ref.features.get("centroid_hz"):
            profile["centroid_hz"] = float(ref.features["centroid_hz"])
    tags = [t for t in (ref.artist, ref.title, *(ref.query.split()[:6])) if t]
    if tags:
        profile["tags"] = [normalize_text(t) for t in tags if t]
    return profile


def plan_from_reference(ref: TrackReference) -> search_mod.QueryPlan:
    plan = search_mod.QueryPlan(
        query=ref.search_query(),
        role="lead",
        subtype="arp",
        bpm=ref.bpm,
        key=ref.key,
        reference=ref.artist,
        reference_kind="artist" if ref.artist else "",
        tags=[normalize_text(t) for t in (ref.artist, ref.title) if t],
        notes=list(ref.notes),
    )
    if ref.features.get("vector"):
        plan.vector = list(ref.features["vector"])
    return plan
