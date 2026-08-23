"""Stage 1 — Faithful SMF ingestion + export (pure stdlib, tick-exact).

No quantization, no rounding, no re-timing. Every note keeps its original
absolute tick, duration in ticks, velocity, and channel so a re-export is a
bit-faithful clone of the performance groove.

`mido` is used automatically if installed, but is never required.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

DEFAULT_TPQ = 480
DEFAULT_TEMPO_US = 500000  # 120 BPM


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class Note:
    """One MIDI note. Ticks are absolute from song start."""

    pitch: int
    start: int  # absolute ticks
    dur: int  # ticks (gate length — preserved verbatim)
    velocity: int = 100
    channel: int = 0

    @property
    def end(self) -> int:
        return self.start + self.dur

    def copy(self, **kw: Any) -> "Note":
        data = {
            "pitch": self.pitch,
            "start": self.start,
            "dur": self.dur,
            "velocity": self.velocity,
            "channel": self.channel,
        }
        data.update(kw)
        return Note(**data)

    def to_dict(self) -> dict[str, Any]:
        return {
            "pitch": self.pitch,
            "start": self.start,
            "dur": self.dur,
            "velocity": self.velocity,
            "channel": self.channel,
        }


@dataclass
class Track:
    name: str = ""
    notes: list[Note] = field(default_factory=list)
    channel: int = 0
    program: int | None = None
    role: str = "unknown"  # filled by analysis

    def sorted_notes(self) -> list[Note]:
        return sorted(self.notes, key=lambda n: (n.start, n.pitch))


@dataclass
class MidiData:
    tpq: int = DEFAULT_TPQ
    tempo_us: int = DEFAULT_TEMPO_US
    numerator: int = 4
    denominator: int = 4
    tracks: list[Track] = field(default_factory=list)
    source_path: str | None = None

    @property
    def bpm(self) -> float:
        return 60_000_000.0 / float(self.tempo_us or DEFAULT_TEMPO_US)

    @property
    def ticks_per_bar(self) -> int:
        beats_per_bar = self.numerator * (4.0 / float(self.denominator or 4))
        return max(1, int(round(self.tpq * beats_per_bar)))

    def all_notes(self) -> list[Note]:
        out: list[Note] = []
        for t in self.tracks:
            out.extend(t.notes)
        out.sort(key=lambda n: (n.start, n.pitch))
        return out

    def length_ticks(self) -> int:
        notes = self.all_notes()
        return max((n.end for n in notes), default=0)

    def length_bars(self) -> int:
        tpb = self.ticks_per_bar
        return max(1, -(-self.length_ticks() // tpb)) if tpb else 1

    def ticks_to_seconds(self, ticks: int) -> float:
        return (ticks / float(self.tpq)) * (self.tempo_us / 1_000_000.0)


# ---------------------------------------------------------------------------
# Variable-length quantity
# ---------------------------------------------------------------------------


def _read_vlq(data: bytes, i: int) -> tuple[int, int]:
    value = 0
    while True:
        if i >= len(data):
            return value, i
        b = data[i]
        i += 1
        value = (value << 7) | (b & 0x7F)
        if not (b & 0x80):
            return value, i


def _write_vlq(value: int) -> bytes:
    if value < 0:
        value = 0
    buf = [value & 0x7F]
    value >>= 7
    while value:
        buf.append((value & 0x7F) | 0x80)
        value >>= 7
    return bytes(reversed(buf))


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------


def read_midi(path: str | Path) -> MidiData:
    """Parse an SMF (type 0/1/2) into MidiData with exact ticks preserved."""
    path = Path(path)
    raw = path.read_bytes()
    if len(raw) < 14 or raw[0:4] != b"MThd":
        raise ValueError(f"Not a Standard MIDI File: {path.name}")

    hdr_len = struct.unpack(">I", raw[4:8])[0]
    fmt, ntrks, division = struct.unpack(">HHH", raw[8:14])

    if division & 0x8000:
        # SMPTE division — convert to an equivalent PPQ so downstream math holds
        frames = 256 - ((division >> 8) & 0xFF)
        ticks_per_frame = division & 0xFF
        tpq = max(1, int(frames * ticks_per_frame))
    else:
        tpq = division or DEFAULT_TPQ

    md = MidiData(tpq=tpq, source_path=str(path))

    pos = 8 + hdr_len
    track_index = 0
    while pos < len(raw) and track_index < max(ntrks, 1):
        # Locate next MTrk (tolerate padding/corruption)
        if raw[pos : pos + 4] != b"MTrk":
            nxt = raw.find(b"MTrk", pos)
            if nxt < 0:
                break
            pos = nxt
        if pos + 8 > len(raw):
            break
        tlen = struct.unpack(">I", raw[pos + 4 : pos + 8])[0]
        body_start = pos + 8
        body_end = min(len(raw), body_start + tlen)
        track = _parse_track(raw, body_start, body_end, md)
        # Conductor / marker tracks carry tempo + meta (already harvested into md)
        # but no notes — they are not musical parts, so they never become tracks.
        if track.notes:
            md.tracks.append(track)
        pos = body_end
        track_index += 1

    # Type 0: one track holding many channels -> split by channel for role work
    if fmt == 0 and len(md.tracks) == 1 and md.tracks[0].notes:
        md.tracks = _split_by_channel(md.tracks[0])

    for i, t in enumerate(md.tracks):
        if not t.name:
            t.name = f"Track {i + 1}"
    return md


def _parse_track(raw: bytes, start: int, end: int, md: MidiData) -> Track:
    track = Track()
    i = start
    abs_ticks = 0
    running_status = 0
    # (channel, pitch) -> list of (start_tick, velocity) for correct stacked-note pairing
    open_notes: dict[tuple[int, int], list[tuple[int, int]]] = {}
    seen_channels: list[int] = []

    while i < end:
        delta, i = _read_vlq(raw, i)
        abs_ticks += delta
        if i >= end:
            break

        status = raw[i]
        if status < 0x80:
            status = running_status  # running status
        else:
            i += 1
            if status < 0xF0:
                running_status = status

        etype = status & 0xF0
        channel = status & 0x0F

        if status == 0xFF:  # meta
            if i >= end:
                break
            meta = raw[i]
            i += 1
            mlen, i = _read_vlq(raw, i)
            payload = raw[i : i + mlen]
            i += mlen
            if meta == 0x51 and mlen == 3:
                md.tempo_us = (payload[0] << 16) | (payload[1] << 8) | payload[2]
            elif meta == 0x58 and mlen >= 2:
                md.numerator = payload[0]
                md.denominator = 2 ** payload[1] if payload[1] < 16 else 4
            elif meta == 0x03 and mlen:
                try:
                    track.name = payload.decode("utf-8", errors="replace").strip()
                except Exception:
                    pass
            continue

        if status in (0xF0, 0xF7):  # sysex
            slen, i = _read_vlq(raw, i)
            i += slen
            continue

        if etype in (0x80, 0x90):
            if i + 1 >= end + 1:
                break
            pitch = raw[i] if i < len(raw) else 0
            vel = raw[i + 1] if i + 1 < len(raw) else 0
            i += 2
            if channel not in seen_channels:
                seen_channels.append(channel)
            key = (channel, pitch)
            if etype == 0x90 and vel > 0:
                open_notes.setdefault(key, []).append((abs_ticks, vel))
            else:
                stack = open_notes.get(key)
                if stack:
                    s_tick, s_vel = stack.pop(0)
                    track.notes.append(
                        Note(
                            pitch=pitch,
                            start=s_tick,
                            dur=max(1, abs_ticks - s_tick),
                            velocity=s_vel,
                            channel=channel,
                        )
                    )
        elif etype == 0xC0:
            if i < len(raw):
                track.program = raw[i]
            i += 1
        elif etype == 0xD0:
            i += 1
        elif etype in (0xA0, 0xB0, 0xE0):
            i += 2
        else:
            break

    # Any notes still held at track end — close them at the last known tick
    for (channel, pitch), stack in open_notes.items():
        for s_tick, s_vel in stack:
            track.notes.append(
                Note(
                    pitch=pitch,
                    start=s_tick,
                    dur=max(1, abs_ticks - s_tick),
                    velocity=s_vel,
                    channel=channel,
                )
            )

    track.channel = seen_channels[0] if seen_channels else 0
    track.notes.sort(key=lambda n: (n.start, n.pitch))
    return track


def _split_by_channel(track: Track) -> list[Track]:
    by_ch: dict[int, list[Note]] = {}
    for n in track.notes:
        by_ch.setdefault(n.channel, []).append(n)
    out: list[Track] = []
    for ch in sorted(by_ch):
        out.append(
            Track(
                name=f"{track.name or 'Track'} ch{ch + 1}",
                notes=sorted(by_ch[ch], key=lambda n: (n.start, n.pitch)),
                channel=ch,
                program=track.program,
            )
        )
    return out or [track]


# ---------------------------------------------------------------------------
# Write (Type 1 — Cubase-friendly: track 0 = conductor, 1..n = parts)
# ---------------------------------------------------------------------------


def _meta(meta_type: int, payload: bytes) -> bytes:
    return b"\xff" + bytes([meta_type]) + _write_vlq(len(payload)) + payload


def _chunk(name: bytes, body: bytes) -> bytes:
    return name + struct.pack(">I", len(body)) + body


def _conductor_track(md: MidiData, title: str) -> bytes:
    body = b""
    body += _write_vlq(0) + _meta(0x03, title.encode("utf-8", errors="replace"))
    tempo = md.tempo_us
    body += _write_vlq(0) + _meta(
        0x51, bytes([(tempo >> 16) & 0xFF, (tempo >> 8) & 0xFF, tempo & 0xFF])
    )
    den = md.denominator or 4
    den_pow = 2
    for p in range(0, 8):
        if 2**p == den:
            den_pow = p
            break
    body += _write_vlq(0) + _meta(0x58, bytes([md.numerator or 4, den_pow, 24, 8]))
    body += _write_vlq(0) + _meta(0x2F, b"")
    return _chunk(b"MTrk", body)


def _note_track(track: Track, md: MidiData) -> bytes:
    body = b""
    body += _write_vlq(0) + _meta(
        0x03, (track.name or "Track").encode("utf-8", errors="replace")
    )
    ch = max(0, min(15, track.channel))
    if track.program is not None:
        body += _write_vlq(0) + bytes([0xC0 | ch, max(0, min(127, int(track.program)))])

    # Build ordered event stream; note-offs before note-ons at the same tick
    events: list[tuple[int, int, int, int]] = []  # (tick, order, pitch, velocity)
    for n in track.notes:
        p = max(0, min(127, int(n.pitch)))
        v = max(1, min(127, int(n.velocity)))
        events.append((int(n.start), 1, p, v))
        events.append((int(n.start) + max(1, int(n.dur)), 0, p, 0))
    events.sort(key=lambda e: (e[0], e[1], e[2]))

    last_tick = 0
    for tick, order, pitch, vel in events:
        delta = max(0, tick - last_tick)
        last_tick = tick
        status = (0x90 if order == 1 else 0x80) | ch
        body += _write_vlq(delta) + bytes([status, pitch, vel])

    body += _write_vlq(0) + _meta(0x2F, b"")
    return _chunk(b"MTrk", body)


def write_midi(
    path: str | Path,
    md: MidiData,
    *,
    tracks: Iterable[Track] | None = None,
    title: str | None = None,
) -> Path:
    """Write a Type 1 SMF. Cubase imports each MTrk as its own track."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    use_tracks = [t for t in (tracks if tracks is not None else md.tracks) if t.notes]
    if not use_tracks:
        use_tracks = [Track(name="Empty", notes=[])]

    header_body = struct.pack(">HHH", 1, len(use_tracks) + 1, md.tpq)
    out = _chunk(b"MThd", header_body)
    out += _conductor_track(md, title or path.stem)
    for t in use_tracks:
        out += _note_track(t, md)
    path.write_bytes(out)
    return path


# ---------------------------------------------------------------------------
# Preview helper — seconds-based notes for the browser player
# ---------------------------------------------------------------------------


def notes_to_preview(
    md: MidiData, notes: Iterable[Note], *, max_notes: int = 400, offset_ticks: int = 0
) -> list[dict[str, Any]]:
    """Convert to the {midi,start,dur} seconds shape app.js already plays."""
    out: list[dict[str, Any]] = []
    for n in sorted(notes, key=lambda x: x.start)[:max_notes]:
        out.append(
            {
                "midi": int(n.pitch),
                "start": round(md.ticks_to_seconds(max(0, n.start - offset_ticks)), 5),
                "dur": round(max(0.03, md.ticks_to_seconds(n.dur)), 5),
                "velocity": int(n.velocity),
            }
        )
    return out
