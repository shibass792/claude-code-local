"""Build the audio the ▶ button plays.

MIDI arps are synthesised on the fly, optionally time-scaled to the tempo of the
track you are matching against, so you hear the arp at the speed it would run in
your session. Audio loops are transcoded to a short WAV excerpt. DAW project
files have no audio of their own, so we look for a bounce or a sidecar preview
sitting next to them.
"""
import os

from . import config
from .audioio import IngestError, excerpt_wav_bytes, wav_bytes
from .midilib import MidiError, MidiFile, render

PREVIEW_SECONDS = 14.0


class PreviewError(RuntimeError):
    pass


def build(entry, target_bpm=None, seconds=PREVIEW_SECONDS):
    """Return (wav_bytes, description)."""
    kind = entry.get("kind")
    path = entry.get("path", "")

    if kind == "arp":
        return _midi_preview(path, target_bpm, seconds)
    if kind == "loop":
        return _audio_preview(path, seconds)
    if kind == "project":
        return _project_preview(entry, target_bpm, seconds)
    raise PreviewError(f"nothing to preview for {os.path.basename(path) or 'this entry'}")


def _midi_preview(path, target_bpm, seconds):
    try:
        midi = MidiFile.load(path)
    except (OSError, MidiError) as exc:
        raise PreviewError(str(exc)) from exc
    if not midi.notes:
        raise PreviewError("this MIDI file has no notes to play")

    samples = render(midi, target_bpm=target_bpm, max_seconds=seconds)
    if target_bpm and midi.bpm:
        note = f"synthesised at {float(target_bpm):g} BPM (file is {midi.bpm:g})"
    else:
        note = f"synthesised at {midi.bpm:g} BPM"
    return wav_bytes(samples), note


def _audio_preview(path, seconds):
    try:
        # Skip the first two seconds: loops and stems often start with silence
        # or a lone count-in hit.
        return excerpt_wav_bytes(path, start=2.0, duration=seconds), "audio excerpt"
    except IngestError as exc:
        raise PreviewError(str(exc)) from exc


def _project_preview(entry, target_bpm, seconds):
    companion = find_companion(entry)
    if not companion:
        raise PreviewError(
            "DAW projects hold no audio on their own — drop a bounce or an .mid "
            "next to the project (same filename) and it becomes previewable"
        )
    kind = "arp" if os.path.splitext(companion)[1].lower() in config.ARP_EXTS else "loop"
    if kind == "arp":
        wav, note = _midi_preview(companion, target_bpm, seconds)
    else:
        wav, note = _audio_preview(companion, seconds)
    return wav, f"{note} — from {os.path.basename(companion)}"


def find_companion(entry):
    """A bounce/MIDI sitting next to a project file, used as its preview."""
    explicit = entry.get("preview")
    if explicit:
        explicit = os.path.expanduser(str(explicit))
        if os.path.exists(explicit):
            return explicit

    path = entry.get("path", "")
    if not path:
        return None
    stem = os.path.splitext(path)[0]
    folder = os.path.dirname(path)
    base = os.path.basename(stem).lower()

    candidates = []
    for ext in list(config.AUDIO_EXTS) + list(config.ARP_EXTS):
        candidates.append(stem + ext)
    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate

    # Cubase writes bounces into an Audio/ subfolder of the project.
    for sub in ("Audio", "Bounces", "Mixdown", "Exports"):
        folder_path = os.path.join(folder, sub)
        if not os.path.isdir(folder_path):
            continue
        try:
            names = sorted(os.listdir(folder_path))
        except OSError:
            continue
        for name in names:
            ext = os.path.splitext(name)[1].lower()
            if ext in config.AUDIO_EXTS and base.split()[0] in name.lower():
                return os.path.join(folder_path, name)
        for name in names:
            if os.path.splitext(name)[1].lower() in config.AUDIO_EXTS:
                return os.path.join(folder_path, name)
    return None
