"""Minimal Standard MIDI File writer.

Used by the starter pack and by the tests. Format 0, one track, absolute note
lists in beats — enough to write an arp, not a general-purpose sequencer.
"""
import struct

TICKS_PER_BEAT = 480


def _varlen(value):
    if value < 0:
        raise ValueError("variable-length quantities cannot be negative")
    out = bytearray([value & 0x7F])
    value >>= 7
    while value:
        out.insert(0, (value & 0x7F) | 0x80)
        value >>= 7
    return bytes(out)


def write(path, notes, bpm=120.0, ticks_per_beat=TICKS_PER_BEAT, key_signature=None, name=None):
    """Write notes to a MIDI file.

    notes: iterable of (start_beat, length_beats, pitch, velocity)
    key_signature: optional (sharps_or_flats, is_minor) as MIDI meta 0x59
    """
    events = []  # (tick, order, payload)
    for start, length, pitch, velocity in notes:
        on = int(round(start * ticks_per_beat))
        off = on + max(1, int(round(length * ticks_per_beat)))
        events.append((on, 1, bytes([0x90, pitch & 0x7F, max(1, min(127, velocity))])))
        events.append((off, 0, bytes([0x80, pitch & 0x7F, 0])))
    events.sort(key=lambda e: (e[0], e[1]))

    track = bytearray()
    if name:
        encoded = name.encode("utf-8")[:120]
        track += _varlen(0) + b"\xFF\x03" + _varlen(len(encoded)) + encoded
    tempo_us = int(round(60_000_000 / float(bpm)))
    track += _varlen(0) + b"\xFF\x51\x03" + struct.pack(">I", tempo_us)[1:]
    if key_signature is not None:
        sharps, minor = key_signature
        track += _varlen(0) + b"\xFF\x59\x02" + struct.pack(">bB", sharps, 1 if minor else 0)

    last = 0
    for tick, _order, payload in events:
        track += _varlen(tick - last) + payload
        last = tick
    track += _varlen(0) + b"\xFF\x2F\x00"

    header = b"MThd" + struct.pack(">IHHh", 6, 0, 1, ticks_per_beat)
    body = b"MTrk" + struct.pack(">I", len(track)) + bytes(track)
    with open(path, "wb") as fh:
        fh.write(header + body)
    return path
