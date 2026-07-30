"""Shared data models and enums."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class FileKind(str, Enum):
    AUDIO = "audio"
    PRESET = "preset"
    PROJECT = "project"
    SAMPLE = "sample"
    VIDEO = "video"
    GUIDE = "guide"
    UNKNOWN = "unknown"


class SoundCategory(str, Enum):
    BASS = "bass"
    LEAD = "lead"
    KICK = "kick"
    PAD = "pad"
    FX = "fx"
    VOCAL = "vocal"
    DRUM = "drum"
    PERCUSSION = "percussion"
    UNKNOWN = "unknown"


@dataclass
class ScannedFile:
    path: str
    kind: FileKind
    size_bytes: int
    mtime: float
    content_hash: str
    plugin_hint: str | None = None
    category_hint: SoundCategory = SoundCategory.UNKNOWN


@dataclass
class AudioFeatures:
  """Step 3 — extracted DSP / ML features."""

  # Basic
  duration_sec: float = 0.0
  sample_rate: int = 44100
  bpm: float | None = None
  bpm_confidence: float = 0.0
  key: str | None = None
  key_confidence: float = 0.0
  mode: str | None = None  # major / minor

  # Loudness
  rms_db: float = 0.0
  lufs: float = 0.0
  peak_db: float = 0.0
  dynamic_range_db: float = 0.0

  # Transient / envelope
  attack_ms: float = 0.0
  release_ms: float = 0.0
  transient_strength: float = 0.0
  envelope_centroid: float = 0.0

  # Stereo
  stereo_width: float = 0.0
  correlation: float = 1.0

  # Spectral
  spectral_centroid: float = 0.0
  spectral_rolloff: float = 0.0
  spectral_contrast: list[float] = field(default_factory=list)
  spectral_bandwidth: float = 0.0
  zero_crossing_rate: float = 0.0

  # Harmonic
  chroma: list[float] = field(default_factory=list)
  tonnetz: list[float] = field(default_factory=list)
  mfcc: list[float] = field(default_factory=list)

  # Classification (Step 2)
  category: SoundCategory = SoundCategory.UNKNOWN
  sub_style: str | None = None  # e.g. rolling_bass, fullon_kick

  def to_dict(self) -> dict[str, Any]:
    return {
      "duration_sec": self.duration_sec,
      "sample_rate": self.sample_rate,
      "bpm": self.bpm,
      "bpm_confidence": self.bpm_confidence,
      "key": self.key,
      "key_confidence": self.key_confidence,
      "mode": self.mode,
      "rms_db": self.rms_db,
      "lufs": self.lufs,
      "peak_db": self.peak_db,
      "dynamic_range_db": self.dynamic_range_db,
      "attack_ms": self.attack_ms,
      "release_ms": self.release_ms,
      "transient_strength": self.transient_strength,
      "envelope_centroid": self.envelope_centroid,
      "stereo_width": self.stereo_width,
      "correlation": self.correlation,
      "spectral_centroid": self.spectral_centroid,
      "spectral_rolloff": self.spectral_rolloff,
      "spectral_contrast": self.spectral_contrast,
      "spectral_bandwidth": self.spectral_bandwidth,
      "zero_crossing_rate": self.zero_crossing_rate,
      "chroma": self.chroma,
      "tonnetz": self.tonnetz,
      "mfcc": self.mfcc,
      "category": self.category.value,
      "sub_style": self.sub_style,
    }


@dataclass
class ProjectDNA:
  """Step 8 — fingerprint of a DAW project."""

  project_path: str
  bpm: float | None = None
  key: str | None = None
  mood: str | None = None
  genre: str | None = None
  bass_style: str | None = None
  lead_style: str | None = None
  fx_style: str | None = None
  energy: float = 0.0
  mix_lufs: float = 0.0
  stereo_width: float = 0.0
  compression_ratio: float = 0.0
  kick_type: str | None = None
  bass_type: str | None = None
  preset_list: list[str] = field(default_factory=list)
  plugin_list: list[str] = field(default_factory=list)
  sample_list: list[str] = field(default_factory=list)
  plugin_chains: list[list[str]] = field(default_factory=list)

  def to_dict(self) -> dict[str, Any]:
    return {
      "project_path": self.project_path,
      "bpm": self.bpm,
      "key": self.key,
      "mood": self.mood,
      "genre": self.genre,
      "bass_style": self.bass_style,
      "lead_style": self.lead_style,
      "fx_style": self.fx_style,
      "energy": self.energy,
      "mix_lufs": self.mix_lufs,
      "stereo_width": self.stereo_width,
      "compression_ratio": self.compression_ratio,
      "kick_type": self.kick_type,
      "bass_type": self.bass_type,
      "preset_list": self.preset_list,
      "plugin_list": self.plugin_list,
      "sample_list": self.sample_list,
      "plugin_chains": self.plugin_chains,
    }


@dataclass
class MatchResult:
  source_id: int
  target_id: int
  score: float
  reasons: list[str] = field(default_factory=list)
