"""Synthetic studio fixtures.

The tests never need real sample packs: every sound is generated so the expected
answer is known by construction. A "rolling bass" here really does have three
gated sixteenths per beat, so when the taxonomy calls it ``rolling`` that is a
meaningful assertion rather than a snapshot of whatever the code did last.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from soundbrain.audio.io import write_wav  # noqa: E402
from soundbrain.config import Config  # noqa: E402
from soundbrain.db import Database  # noqa: E402

SR = 44100


def _stereo(mono: np.ndarray, width: float = 0.0) -> np.ndarray:
    """Turn a mono signal into stereo with a controllable amount of side energy."""
    if width <= 0:
        return np.stack([mono, mono], axis=1)
    side = width * np.roll(mono, 37)
    return np.stack([mono + side, mono - side], axis=1)


def _envelope(n: int, attack: float, decay: float, sr: int = SR) -> np.ndarray:
    attack_samples = max(int(attack * sr), 1)
    env = np.ones(n, dtype=np.float32)
    env[:attack_samples] = np.linspace(0.0, 1.0, attack_samples)
    tail = np.exp(-np.arange(n - attack_samples) / max(decay * sr, 1.0))
    env[attack_samples:] = tail
    return env


def make_kick(duration: float = 0.42, start_hz: float = 160.0, end_hz: float = 45.0, click: float = 0.35, sr: int = SR) -> np.ndarray:
    """A pitch-dropping sine with a noise click — a psytrance-style kick."""
    n = int(duration * sr)
    t = np.arange(n) / sr
    sweep = end_hz + (start_hz - end_hz) * np.exp(-t * 28.0)
    phase = 2 * np.pi * np.cumsum(sweep) / sr
    body = np.sin(phase) * np.exp(-t * 11.0)
    transient = np.random.default_rng(3).normal(0, 1, n) * np.exp(-t * 320.0) * click
    return ((body + transient) * 0.9).astype(np.float32)


def make_rolling_bass(bpm: float = 145.0, bars: int = 2, note_hz: float = 55.0, sr: int = SR) -> np.ndarray:
    """Three gated sixteenths per beat, the classic full-on rolling pattern."""
    beat = 60.0 / bpm
    step = beat / 4.0
    total = int(bars * 4 * beat * sr)
    out = np.zeros(total, dtype=np.float32)
    note_len = int(step * sr * 0.8)
    t = np.arange(note_len) / sr
    tone = (np.sin(2 * np.pi * note_hz * t) + 0.3 * np.sin(4 * np.pi * note_hz * t)) * _envelope(note_len, 0.004, 0.035, sr)
    for beat_index in range(int(bars * 4)):
        for sixteenth in (1, 2, 3):  # the kick owns sixteenth 0
            start = int((beat_index * beat + sixteenth * step) * sr)
            end = min(start + note_len, total)
            out[start:end] += tone[: end - start]
    return (out * 0.7).astype(np.float32)


def make_offbeat_bass(bpm: float = 136.0, bars: int = 2, note_hz: float = 58.0, sr: int = SR) -> np.ndarray:
    """One hit on the "and" of every beat, longer and rounder than a roll."""
    beat = 60.0 / bpm
    total = int(bars * 4 * beat * sr)
    out = np.zeros(total, dtype=np.float32)
    note_len = int(beat * sr * 0.45)
    t = np.arange(note_len) / sr
    tone = np.sin(2 * np.pi * note_hz * t) * _envelope(note_len, 0.02, 0.12, sr)
    for beat_index in range(int(bars * 4)):
        start = int((beat_index * beat + beat / 2.0) * sr)
        end = min(start + note_len, total)
        out[start:end] += tone[: end - start]
    return (out * 0.7).astype(np.float32)


def make_sustained_bass(duration: float = 2.0, note_hz: float = 55.0, sr: int = SR) -> np.ndarray:
    """A bass that never gets out of the way — the bad partner for a kick."""
    n = int(duration * sr)
    t = np.arange(n) / sr
    tone = np.sin(2 * np.pi * note_hz * t) + 0.4 * np.sin(4 * np.pi * note_hz * t)
    return (tone * 0.8).astype(np.float32)


def make_lead(duration: float = 2.0, root_hz: float = 440.0, sr: int = SR) -> np.ndarray:
    """A bright saw-ish arpeggio in the upper register."""
    steps = [0, 3, 7, 10, 12, 7, 3, 0]
    note_len = int(duration * sr / len(steps))
    out = np.zeros(note_len * len(steps), dtype=np.float32)
    for index, semitones in enumerate(steps):
        hz = root_hz * 2 ** (semitones / 12.0)
        t = np.arange(note_len) / sr
        tone = sum(np.sin(2 * np.pi * hz * h * t) / h for h in (1, 2, 3, 4, 5))
        out[index * note_len : (index + 1) * note_len] = (tone * _envelope(note_len, 0.005, 0.15, sr)).astype(np.float32)
    return (out * 0.4).astype(np.float32)


def make_pad(duration: float = 6.0, root_hz: float = 220.0, sr: int = SR) -> np.ndarray:
    """A slow, wide minor chord — long attack, high sustain."""
    n = int(duration * sr)
    t = np.arange(n) / sr
    chord = sum(np.sin(2 * np.pi * root_hz * ratio * t) for ratio in (1.0, 1.19, 1.5, 2.0))
    attack = np.clip(t / 1.5, 0.0, 1.0)
    release = np.clip((duration - t) / 1.5, 0.0, 1.0)
    return (chord * attack * release * 0.2).astype(np.float32)


def make_riser(duration: float = 3.0, sr: int = SR) -> np.ndarray:
    """Filtered noise whose spectral centre climbs — a riser."""
    n = int(duration * sr)
    rng = np.random.default_rng(11)
    noise = rng.normal(0, 1, n).astype(np.float32)
    # crude time-varying brightness: mix noise with a rising-frequency tone
    t = np.arange(n) / sr
    sweep = np.sin(2 * np.pi * np.cumsum(np.linspace(300, 9000, n)) / sr).astype(np.float32)
    ramp = (t / duration).astype(np.float32)
    return ((noise * (1 - ramp) * 0.2 + sweep * ramp * 0.6) * (0.2 + 0.8 * ramp)).astype(np.float32)


def make_chord_progression(sr: int = SR, root: int = 57) -> np.ndarray:
    """A minor progression with a clear tonal centre (A minor by default)."""
    triads = [(0, 3, 7), (5, 8, 12), (7, 10, 14), (0, 3, 7)]
    note_len = int(1.2 * sr)
    out = np.zeros(note_len * len(triads), dtype=np.float32)
    for index, triad in enumerate(triads):
        block = np.zeros(note_len, dtype=np.float32)
        for semitone in triad:
            hz = 440.0 * 2 ** ((root + semitone - 69) / 12.0)
            t = np.arange(note_len) / sr
            block += (np.sin(2 * np.pi * hz * t) + 0.3 * np.sin(4 * np.pi * hz * t)).astype(np.float32)
        out[index * note_len : (index + 1) * note_len] = block * _envelope(note_len, 0.02, 1.5, sr)
    return (out * 0.25).astype(np.float32)


# ---------------------------------------------------------------------------
# synthetic DAW projects
# ---------------------------------------------------------------------------

DEFAULT_TRACKS = (
    ("Bass", "Serum", ("Pro-Q 3", "Saturn", "Soothe", "Serial Clipper")),
    ("Lead", "Sylenth1", ("Pro-Q 3", "Valhalla")),
    ("Kick", "Kick 3", ("Pro-Q 3",)),
)


def write_als(
    path: Path,
    bpm: float = 145.0,
    tracks: tuple = DEFAULT_TRACKS,
    samples: tuple[str, ...] = (),
) -> Path:
    """Write a minimal but structurally real ``.als`` (gzipped XML)."""
    import gzip

    track_xml = []
    for name, instrument, effects in tracks:
        devices = [instrument, *effects]
        device_xml = "".join(
            f"""<PluginDevice><PluginDesc><Vst3PluginInfo><Name Value="{device}" /></Vst3PluginInfo></PluginDesc></PluginDevice>"""
            for device in devices
        )
        track_xml.append(
            f"""<MidiTrack><Name><EffectiveName Value="{name}" /></Name>
            <DeviceChain><DeviceChain><Devices>{device_xml}</Devices></DeviceChain></DeviceChain></MidiTrack>"""
        )
    sample_xml = "".join(
        f"""<SampleRef><FileRef><Path Value="{sample}" /></FileRef></SampleRef>""" for sample in samples
    )
    document = f"""<?xml version="1.0" encoding="UTF-8"?>
<Ableton MinorVersion="11.0"><LiveSet>
  <Tracks>{''.join(track_xml)}</Tracks>
  <MasterTrack><DeviceChain><Mixer><Tempo><Manual Value="{bpm}" /></Tempo></Mixer></DeviceChain></MasterTrack>
  {sample_xml}
</LiveSet></Ableton>"""
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wb") as handle:
        handle.write(document.encode("utf-8"))
    return path


def write_cpr(
    path: Path,
    bpm: float = 145.0,
    tracks: tuple = DEFAULT_TRACKS,
    samples: tuple[str, ...] = (),
) -> Path:
    """Write a fake ``.cpr``: real Cubase class markers around plugin strings.

    This mirrors the only structure the parser relies on — track class markers
    followed by the serialised plugin names — without pretending to be a
    byte-accurate Cubase file.
    """
    import struct

    blob = bytearray(b"Steinberg Cubase Project\x00" * 4)
    blob += b"MTempoTrackEvent\x00\x00"
    blob += struct.pack("<d", bpm)
    for name, instrument, effects in tracks:
        blob += b"\x00MInstrumentTrack\x00"
        blob += name.encode("ascii") + b"\x00\x00"
        for device in (instrument, *effects):
            blob += b"VstPlugin\x00" + device.encode("ascii") + b"\x00\x00"
    for sample in samples:
        blob += sample.encode("ascii") + b"\x00"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(bytes(blob))
    return path


def write_song(path: Path, bpm: float = 138.0, tracks: tuple = DEFAULT_TRACKS) -> Path:
    """Write a minimal Studio One ``.song`` (zip of XML)."""
    import zipfile

    devices = "".join(
        f'<Device name="{device}" />' for _n, instrument, effects in tracks for device in (instrument, *effects)
    )
    names = "".join(f'<AudioTrack name="{name}" />' for name, _i, _e in tracks)
    document = f'<?xml version="1.0"?><Song tempo="{bpm}">{names}{devices}<MediaPool><Media url="H:/Samples/kick.wav" /></MediaPool></Song>'
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("Song/song.xml", document)
    return path


def write_rpp(path: Path, bpm: float = 140.0, tracks: tuple = DEFAULT_TRACKS) -> Path:
    lines = ["<REAPER_PROJECT 0.1", f"  TEMPO {bpm} 4 4"]
    for name, instrument, effects in tracks:
        lines.append("  <TRACK")
        lines.append(f'    NAME "{name}"')
        for device in (instrument, *effects):
            lines.append(f'    <VST "VST3: {device} (Vendor)" {device}.vst3 0 "" 0<>')
            lines.append("    >")
        lines.append("  >")
    lines.append(">")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


@pytest.fixture()
def project_samples(library: Path) -> tuple[str, ...]:
    """Absolute paths of a few library samples, as a project would reference them."""
    packs = library / "Samples" / "Zenhiser Psytrance"
    return (
        str(packs / "Kicks" / "Kick FullOn 145.wav"),
        str(packs / "Bass" / "Rolling Bass 145 F#m.wav"),
        str(packs / "Leads" / "Lead Acid 145 F#m.wav"),
    )


@pytest.fixture()
def projects_dir(tmp_path: Path, project_samples: tuple[str, ...]) -> Path:
    """A folder of projects in four formats, all referencing library samples."""
    folder = tmp_path / "Projects"
    folder.mkdir(parents=True, exist_ok=True)
    write_cpr(folder / "Night Track 145 F#m.cpr", bpm=145.0, samples=project_samples)
    write_als(folder / "Live Idea 138.als", bpm=138.0, samples=project_samples)
    write_song(folder / "One Idea.song", bpm=136.0)
    write_rpp(folder / "Reaper Sketch.rpp", bpm=142.0)
    return folder


@pytest.fixture()
def sr() -> int:
    return SR


@pytest.fixture()
def library(tmp_path: Path) -> Path:
    """A miniature sample library on disk, with names a producer would use."""
    root = tmp_path / "H_drive"
    packs = root / "Samples" / "Zenhiser Psytrance"
    (packs / "Kicks").mkdir(parents=True)
    (packs / "Bass").mkdir(parents=True)
    (packs / "Leads").mkdir(parents=True)
    (packs / "Pads").mkdir(parents=True)
    (packs / "FX").mkdir(parents=True)

    write_wav(packs / "Kicks" / "Kick FullOn 145.wav", _stereo(make_kick()), SR)
    write_wav(packs / "Kicks" / "Kick Progressive 136.wav", _stereo(make_kick(duration=0.6, end_hz=42, click=0.15)), SR)
    write_wav(packs / "Bass" / "Rolling Bass 145 F#m.wav", _stereo(make_rolling_bass()), SR)
    write_wav(packs / "Bass" / "Offbeat Bass 136 Am.wav", _stereo(make_offbeat_bass()), SR)
    write_wav(packs / "Bass" / "Sustained Bass 145.wav", _stereo(make_sustained_bass()), SR)
    write_wav(packs / "Leads" / "Lead Acid 145 F#m.wav", _stereo(make_lead(), width=0.4), SR)
    write_wav(packs / "Leads" / "Arp Sequence 145 F#m.wav", _stereo(make_lead(root_hz=523.0), width=0.35), SR)
    write_wav(packs / "Pads" / "Pad Warm Am.wav", _stereo(make_pad(), width=0.5), SR)
    write_wav(packs / "FX" / "Riser Uplifter.wav", _stereo(make_riser(), width=0.3), SR)
    return root


@pytest.fixture()
def cfg(tmp_path: Path, library: Path) -> Config:
    config = Config(
        roots=[str(library)],
        home=str(tmp_path / "brain-home"),
        analysis_seconds=12.0,
        analysis_sample_rate=SR,
    )
    config.ensure_dirs()
    return config


@pytest.fixture()
def db(cfg: Config) -> Database:
    database = Database(cfg.db_path)
    yield database
    database.close()


@pytest.fixture()
def indexed(db: Database, cfg: Config) -> Database:
    """A database with the synthetic library scanned and analysed."""
    from soundbrain import analyzer, scanner

    scanner.scan(db, cfg)
    analyzer.analyze_pending(db, cfg)
    return db
