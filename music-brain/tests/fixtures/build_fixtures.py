"""Generate tiny WAV fixtures + fake project for tests (no librosa required)."""

from __future__ import annotations

import math
import struct
import wave
from pathlib import Path


def write_tone_wav(
    path: Path,
    *,
    freq: float = 110.0,
    duration: float = 0.35,
    sr: int = 22050,
    attack_ms: float = 5.0,
    stereo: bool = False,
    amp: float = 0.5,
) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    nch = 2 if stereo else 1
    nframes = int(sr * duration)
    attack = int(sr * attack_ms / 1000.0)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(nch)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        frames = bytearray()
        for i in range(nframes):
            env = min(1.0, i / max(attack, 1))
            # exponential-ish release
            rel = math.exp(-3.0 * i / max(nframes, 1))
            sample = amp * env * rel * math.sin(2 * math.pi * freq * i / sr)
            s = int(max(-32767, min(32767, sample * 32767)))
            if nch == 1:
                frames += struct.pack("<h", s)
            else:
                # slight stereo difference
                s2 = int(max(-32767, min(32767, sample * 0.7 * 32767)))
                frames += struct.pack("<hh", s, s2)
        wf.writeframes(frames)
    return path


def build_fixture_tree(root: Path) -> Path:
    """Create a mini ShiBass-like library tree for pipeline tests."""
    root = Path(root)
    samples = root / "Samples"
    write_tone_wav(
        samples / "Kicks" / "FullOn_Kick_142bpm.wav",
        freq=60,
        attack_ms=3,
        duration=0.4,
        amp=0.8,
    )
    write_tone_wav(
        samples / "Kicks" / "Progressive_Kick_138bpm.wav",
        freq=55,
        attack_ms=12,
        duration=0.5,
        amp=0.6,
    )
    write_tone_wav(
        samples / "Bass" / "FullOn_Bass_F#_142bpm.wav",
        freq=92.5,
        attack_ms=8,
        duration=0.5,
        amp=0.55,
    )
    write_tone_wav(
        samples / "Bass" / "Rolling_Bass_Am_140bpm.wav",
        freq=110,
        attack_ms=20,
        duration=0.6,
        amp=0.45,
        stereo=True,
    )
    write_tone_wav(
        samples / "Bass" / "Offbeat_Bass_142.wav",
        freq=98,
        attack_ms=5,
        duration=0.35,
        amp=0.5,
    )
    write_tone_wav(
        samples / "Leads" / "Psy_Lead_F#_Ranji_style.wav",
        freq=440,
        attack_ms=10,
        duration=0.8,
        stereo=True,
        amp=0.35,
    )
    write_tone_wav(
        samples / "Leads" / "Supersaw_Lead_Astrix_F#.wav",
        freq=523,
        attack_ms=15,
        duration=1.0,
        stereo=True,
        amp=0.3,
    )
    write_tone_wav(
        samples / "FX" / "Riser_Impact_sweep.wav",
        freq=200,
        attack_ms=80,
        duration=1.2,
        amp=0.25,
        stereo=True,
    )
    write_tone_wav(
        samples / "Vocals" / "Psy_Vocal_chop.wav",
        freq=220,
        attack_ms=20,
        duration=0.7,
        amp=0.3,
    )

    # MIDI + "music" track stubs for SHIBASS player browser
    midi_dir = root / "MIDI"
    midi_dir.mkdir(parents=True, exist_ok=True)
    # Minimal Type-0 SMF: header + one track with Note On/Off C4
    mid = bytearray()
    mid += b"MThd"
    mid += (6).to_bytes(4, "big")
    mid += (0).to_bytes(2, "big")  # format 0
    mid += (1).to_bytes(2, "big")  # 1 track
    mid += (480).to_bytes(2, "big")
    track = bytearray()
    # delta 0, note on C4 vel 100
    track += bytes([0x00, 0x90, 60, 100])
    # delta 480, note off
    track += bytes([0x83, 0x60, 0x80, 60, 0])
    # end of track
    track += bytes([0x00, 0xFF, 0x2F, 0x00])
    mid += b"MTrk"
    mid += len(track).to_bytes(4, "big")
    mid += track
    (midi_dir / "01_Intro_MIDI.mid").write_bytes(mid)

    music = root / "Music"
    write_tone_wav(music / "Neon_Galaxy_Vandeta.wav", freq=220, duration=1.0, stereo=True, amp=0.4)

    presets = root / "Presets" / "Serum"
    presets.mkdir(parents=True, exist_ok=True)
    (presets / "FullOn_Bass_Rolling.fxp").write_bytes(b"CcnK" + b"\x00" * 64)
    (presets / "Psy_Lead_Screech.fxp").write_bytes(b"CcnK" + b"\x00" * 64)
    syl = root / "Presets" / "Sylenth1"
    syl.mkdir(parents=True, exist_ok=True)
    (syl / "Offbeat_Bass.fxb").write_bytes(b"CcnK" + b"\x00" * 32)

    # Fake Cubase project as binary-with-strings (simulates .cpr string table)
    projects = root / "Projects" / "Cubase"
    projects.mkdir(parents=True, exist_ok=True)
    fake = bytearray(b"\x00" * 256)
    blob = (
        b"Tempo 142.00 Key F# Serum Pro-Q 3 Saturn Soothe2 StandardCLIP "
        b"Limiter FullOn_Bass_Rolling.fxp Psy_Lead_Screech.fxp "
        b"Samples/Kicks/FullOn_Kick_142bpm.wav Cubase"
    )
    fake += blob
    (projects / "Track_Fsharp_142_FullOn.cpr").write_bytes(fake)

    # Plugin folder ref
    (root / "VST" / "Serum").mkdir(parents=True, exist_ok=True)
    (root / "VST" / "Vital").mkdir(parents=True, exist_ok=True)
    return root


if __name__ == "__main__":
    import sys

    out = Path(sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures/library")
    build_fixture_tree(out)
    print(f"fixtures at {out.resolve()}")
