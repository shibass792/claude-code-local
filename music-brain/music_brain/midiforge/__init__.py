"""MIDI Forge — MIDI Transformation & Song Expansion Engine for Music Brain.

Four stages, all pure stdlib (no mido / numpy / music21 required):

  1. Ingestion    — tick-exact SMF parse; groove, gate and velocity preserved
  2. Analysis     — key/mode (incl. Phrygian family), roles, groove, density
  3. Generation   — pad, arp mutation, counter-melody, root-synced bass
  4. Cubase Bridge— per-role Type 1 MIDI + markdown arrangement guide

Served on the existing player port (8788) via `api.handle_get/handle_post`.
"""

from __future__ import annotations

__version__ = "1.0.0"

from music_brain.midiforge.smf import MidiData, Note, Track, read_midi, write_midi  # noqa: F401

__all__ = ["MidiData", "Note", "Track", "read_midi", "write_midi", "__version__"]
