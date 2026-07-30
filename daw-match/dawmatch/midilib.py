"""Minimal Standard MIDI File reader plus a small synth for auditioning arps.

Parsing is stdlib-only on purpose: the panel should work on a fresh Mac with no
pip install step. The synth is deliberately simple — detuned saw/square with an
ADSR and a one-pole lowpass — because the goal is "does this arp fit my track",
not a finished sound.
"""
import struct

import numpy as np

from .analysis import KS_MAJOR, KS_MINOR, PITCH_NAMES, _pearson

DEFAULT_TEMPO_US = 500000  # 120 BPM, the SMF default when no set_tempo appears

# Key signature meta values map to a number of sharps (positive) or flats.
_SHARP_ORDER = [0, 7, 2, 9, 4, 11, 6]  # C G D A E B F#
_FLAT_ORDER = [0, 5, 10, 3, 8, 1, 6]   # C F Bb Eb Ab Db Gb


class MidiError(ValueError):
    pass


class Note:
    __slots__ = ("pitch", "start", "end", "velocity", "channel")

    def __init__(self, pitch, start, end, velocity, channel):
        self.pitch = pitch
        self.start = start
        self.end = end
        self.velocity = velocity
        self.channel = channel

    @property
    def duration(self):
        return max(0.0, self.end - self.start)

    def __repr__(self):
        return f"Note(p={self.pitch}, {self.start:.3f}-{self.end:.3f}, v={self.velocity})"


def _read_varlen(data, pos):
    value = 0
    while True:
        if pos >= len(data):
            raise MidiError("truncated variable-length quantity")
        byte = data[pos]
        pos += 1
        value = (value << 7) | (byte & 0x7F)
        if not byte & 0x80:
            return value, pos


def _parse_track(data, ticks_per_beat):
    """Return (events, tempo_changes, key_signature) in tick time."""
    pos = 0
    time = 0
    status = None
    events = []       # (tick, kind, pitch, velocity, channel)
    tempos = []       # (tick, microseconds_per_beat)
    key_sig = None

    while pos < len(data):
        delta, pos = _read_varlen(data, pos)
        time += delta
        if pos >= len(data):
            break
        byte = data[pos]

        if byte == 0xFF:  # meta event
            pos += 1
            meta_type = data[pos]
            pos += 1
            length, pos = _read_varlen(data, pos)
            payload = data[pos:pos + length]
            pos += length
            if meta_type == 0x51 and length == 3:
                tempos.append((time, struct.unpack(">I", b"\x00" + payload)[0]))
            elif meta_type == 0x59 and length >= 2 and key_sig is None:
                accidentals = struct.unpack(">b", payload[0:1])[0]
                minor = payload[1] == 1
                key_sig = (accidentals, minor)
            elif meta_type == 0x2F:
                break
            continue

        if byte in (0xF0, 0xF7):  # sysex — skip
            pos += 1
            length, pos = _read_varlen(data, pos)
            pos += length
            continue

        if byte & 0x80:
            status = byte
            pos += 1
        elif status is None:
            raise MidiError("running status used before any status byte")

        command = status & 0xF0
        channel = status & 0x0F

        if command in (0x80, 0x90, 0xA0, 0xB0, 0xE0):
            if pos + 1 >= len(data) + 1:
                break
            d1 = data[pos] if pos < len(data) else 0
            d2 = data[pos + 1] if pos + 1 < len(data) else 0
            pos += 2
            if command == 0x90 and d2 > 0:
                events.append((time, "on", d1, d2, channel))
            elif command == 0x80 or (command == 0x90 and d2 == 0):
                events.append((time, "off", d1, 0, channel))
        elif command in (0xC0, 0xD0):
            pos += 1
        else:
            pos += 1

    return events, tempos, key_sig


def _tick_to_seconds(tick, tempo_map, ticks_per_beat):
    """Walk the tempo map so tempo changes mid-file are honoured."""
    seconds = 0.0
    last_tick = 0
    tempo = DEFAULT_TEMPO_US
    for change_tick, change_tempo in tempo_map:
        if change_tick >= tick:
            break
        seconds += (change_tick - last_tick) * tempo / 1e6 / ticks_per_beat
        last_tick, tempo = change_tick, change_tempo
    seconds += (tick - last_tick) * tempo / 1e6 / ticks_per_beat
    return seconds


class MidiFile:
    """Parsed SMF: notes in seconds, plus tempo and key metadata."""

    def __init__(self, notes, bpm, ticks_per_beat, key_signature=None, track_count=1):
        self.notes = notes
        self.bpm = bpm
        self.ticks_per_beat = ticks_per_beat
        self.key_signature = key_signature
        self.track_count = track_count

    @property
    def duration(self):
        return max((n.end for n in self.notes), default=0.0)

    @classmethod
    def load(cls, path):
        with open(path, "rb") as fh:
            data = fh.read()
        return cls.parse(data)

    @classmethod
    def parse(cls, data):
        if len(data) < 14 or data[:4] != b"MThd":
            raise MidiError("not a Standard MIDI File (missing MThd)")
        header_len = struct.unpack(">I", data[4:8])[0]
        _fmt, ntracks, division = struct.unpack(">HHh", data[8:14])
        pos = 8 + header_len

        if division > 0:
            ticks_per_beat = division
        else:
            # SMPTE timing: frames per second * ticks per frame. Treating that as
            # ticks-per-beat keeps note ordering intact even if tempo is off.
            ticks_per_beat = abs(division >> 8) * (division & 0xFF) or 480

        all_events = []
        tempo_map = []
        key_sig = None
        seen_tracks = 0

        while pos + 8 <= len(data) and seen_tracks < max(ntracks, 1):
            chunk_id = data[pos:pos + 4]
            chunk_len = struct.unpack(">I", data[pos + 4:pos + 8])[0]
            body = data[pos + 8:pos + 8 + chunk_len]
            pos += 8 + chunk_len
            if chunk_id != b"MTrk":
                continue
            seen_tracks += 1
            events, tempos, track_key = _parse_track(body, ticks_per_beat)
            all_events.extend(events)
            tempo_map.extend(tempos)
            if key_sig is None:
                key_sig = track_key

        tempo_map.sort()
        bpm = round(60_000_000 / (tempo_map[0][1] if tempo_map else DEFAULT_TEMPO_US), 2)

        all_events.sort(key=lambda e: (e[0], 0 if e[1] == "off" else 1))
        notes = []
        pending = {}
        for tick, kind, pitch, velocity, channel in all_events:
            slot = (channel, pitch)
            if kind == "on":
                pending.setdefault(slot, []).append((tick, velocity))
            else:
                stack = pending.get(slot)
                if stack:
                    start_tick, vel = stack.pop(0)
                    notes.append(Note(
                        pitch,
                        _tick_to_seconds(start_tick, tempo_map, ticks_per_beat),
                        _tick_to_seconds(tick, tempo_map, ticks_per_beat),
                        vel,
                        channel,
                    ))
        # Anything still held at end-of-file gets an eighth-note tail.
        for (channel, pitch), stack in pending.items():
            for start_tick, vel in stack:
                start = _tick_to_seconds(start_tick, tempo_map, ticks_per_beat)
                notes.append(Note(pitch, start, start + 60.0 / bpm / 2, vel, channel))

        notes.sort(key=lambda n: (n.start, n.pitch))
        return cls(notes, bpm, ticks_per_beat, key_sig, seen_tracks)

    def chroma(self):
        """Duration-weighted pitch-class histogram."""
        chroma = np.zeros(12)
        for note in self.notes:
            chroma[note.pitch % 12] += max(note.duration, 0.05) * (note.velocity / 127.0)
        total = chroma.sum()
        return chroma / total if total > 0 else chroma

    def detect_key(self):
        """Prefer an explicit key signature, fall back to the note histogram."""
        if self.key_signature is not None:
            accidentals, minor = self.key_signature
            table = _SHARP_ORDER if accidentals >= 0 else _FLAT_ORDER
            tonic = table[min(abs(accidentals), 6)]
            if minor:
                tonic = (tonic - 3) % 12  # relative minor of the notated major
            mode = "minor" if minor else "major"
            return f"{PITCH_NAMES[tonic]} {mode}", tonic, mode, 1.0

        chroma = self.chroma()
        if chroma.sum() <= 0:
            return "unknown", -1, "", 0.0
        scored = []
        for tonic in range(12):
            rotated = np.roll(chroma, -tonic)
            for mode, profile in (("major", KS_MAJOR), ("minor", KS_MINOR)):
                scored.append((_pearson(rotated, profile), tonic, mode))
        scored.sort(reverse=True)
        best, tonic, mode = scored[0]
        confidence = max(0.0, min(1.0, best - scored[1][0]))
        return f"{PITCH_NAMES[tonic]} {mode}", tonic, mode, round(confidence, 3)


def render(midi, sample_rate=44100, target_bpm=None, max_seconds=20.0, gain=0.25):
    """Synthesise a MIDI file to a mono float array.

    When target_bpm is given the whole performance is time-scaled to that tempo,
    so an arp can be auditioned at the tempo of the track it is matched against.
    """
    scale = 1.0
    if target_bpm and midi.bpm > 0:
        scale = midi.bpm / float(target_bpm)

    if not midi.notes:
        return np.zeros(int(sample_rate * 0.5), dtype=np.float32)

    length = min(midi.duration * scale + 0.6, max_seconds)
    buf = np.zeros(int(sample_rate * length) + 1, dtype=np.float32)

    for note in midi.notes:
        start = note.start * scale
        if start >= length:
            continue
        dur = min(max(note.duration * scale, 0.05), length - start)
        if dur <= 0:
            continue
        voice = _voice(note.pitch, dur, note.velocity, sample_rate, note.channel)
        begin = int(start * sample_rate)
        end = min(begin + voice.size, buf.size)
        if end > begin:
            buf[begin:end] += voice[: end - begin]

    buf = _lowpass(buf, sample_rate, cutoff=5200.0)
    peak = float(np.max(np.abs(buf)))
    if peak > 0:
        buf = buf / peak * gain * 3.4
    return np.clip(buf, -1.0, 1.0)


def _voice(pitch, duration, velocity, sample_rate, channel=0):
    freq = 440.0 * (2.0 ** ((pitch - 69) / 12.0))
    n = max(1, int(duration * sample_rate))
    t = np.arange(n, dtype=np.float32) / sample_rate

    if channel == 9:  # GM drum channel — a short noise burst reads as percussion
        wave = np.random.default_rng(pitch).standard_normal(n).astype(np.float32)
        env = np.exp(-t * 26.0).astype(np.float32)
        return wave * env * (velocity / 127.0) * 0.5

    # Two slightly detuned saws plus a quiet square give a usable synth-arp tone.
    saw_a = 2.0 * ((t * freq) % 1.0) - 1.0
    saw_b = 2.0 * ((t * freq * 1.004) % 1.0) - 1.0
    square = np.sign(np.sin(2 * np.pi * freq * 0.5 * t))
    wave = (0.5 * saw_a + 0.4 * saw_b + 0.18 * square).astype(np.float32)
    return wave * _adsr(n, sample_rate, duration) * (velocity / 127.0)


def _adsr(n, sample_rate, duration, attack=0.006, decay=0.05, sustain=0.65, release=0.09):
    env = np.full(n, sustain, dtype=np.float32)
    a = min(int(attack * sample_rate), n)
    d = min(int(decay * sample_rate), max(0, n - a))
    r = min(int(release * sample_rate), n)
    if a:
        env[:a] = np.linspace(0.0, 1.0, a, dtype=np.float32)
    if d:
        env[a:a + d] = np.linspace(1.0, sustain, d, dtype=np.float32)
    if r:
        env[n - r:] *= np.linspace(1.0, 0.0, r, dtype=np.float32)
    return env


def _lowpass(signal, sample_rate, cutoff=5000.0):
    """Gentle FIR lowpass — a Hann-windowed moving average.

    A one-pole IIR would need a sample-by-sample recursion; a short symmetric FIR
    gets the same "take the edge off" result in one vectorised convolution.
    """
    if signal.size == 0 or cutoff <= 0:
        return signal
    taps = max(3, int(round(sample_rate / cutoff)) | 1)  # odd length keeps phase
    if taps >= signal.size:
        return signal
    kernel = np.hanning(taps).astype(np.float32)
    kernel /= kernel.sum()
    return np.convolve(signal, kernel, mode="same").astype(np.float32)
