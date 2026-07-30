"""MIDI round-trip: write with smf, read back with midilib, render to audio."""
import os
import tempfile
import unittest

import numpy as np

import helpers
from dawmatch import midilib, smf


class VarlenTests(unittest.TestCase):
    def test_round_trip(self):
        for value in (0, 1, 127, 128, 8192, 0x0FFFFFFF):
            with self.subTest(value=value):
                encoded = smf._varlen(value)
                decoded, pos = midilib._read_varlen(encoded, 0)
                self.assertEqual(decoded, value)
                self.assertEqual(pos, len(encoded))

    def test_negative_rejected(self):
        with self.assertRaises(ValueError):
            smf._varlen(-1)


class ParseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def path(self, name):
        return os.path.join(self.tmp.name, name)

    def test_reads_tempo_and_notes(self):
        path = self.path("arp.mid")
        helpers.make_arp_midi(path, bpm=128.0, tonic=9, mode="minor", bars=2)
        midi = midilib.MidiFile.load(path)
        self.assertAlmostEqual(midi.bpm, 128.0, places=1)
        self.assertEqual(len(midi.notes), 32)
        self.assertGreater(midi.duration, 3.5)
        self.assertLess(midi.duration, 4.1)

    def test_note_timing_matches_tempo(self):
        path = self.path("timing.mid")
        smf.write(path, [(0, 1, 60, 100), (1, 1, 62, 100)], bpm=120.0)
        midi = midilib.MidiFile.load(path)
        self.assertEqual(len(midi.notes), 2)
        # At 120 BPM a beat is 0.5s, so the second note starts there.
        self.assertAlmostEqual(midi.notes[0].start, 0.0, places=3)
        self.assertAlmostEqual(midi.notes[1].start, 0.5, places=3)
        self.assertAlmostEqual(midi.notes[0].duration, 0.5, places=3)

    def test_tempo_change_shifts_later_notes(self):
        # 120 BPM for one beat, then 60 BPM: the third note lands a full second
        # after the second one instead of half.
        path = self.path("tempochange.mid")
        track = bytearray()
        track += smf._varlen(0) + b"\xFF\x51\x03" + (500000).to_bytes(3, "big")
        track += smf._varlen(0) + bytes([0x90, 60, 100])
        track += smf._varlen(480) + bytes([0x80, 60, 0])
        track += smf._varlen(0) + b"\xFF\x51\x03" + (1000000).to_bytes(3, "big")
        track += smf._varlen(0) + bytes([0x90, 62, 100])
        track += smf._varlen(480) + bytes([0x80, 62, 0])
        track += smf._varlen(0) + b"\xFF\x2F\x00"
        data = (b"MThd" + (6).to_bytes(4, "big") + (0).to_bytes(2, "big")
                + (1).to_bytes(2, "big") + (480).to_bytes(2, "big")
                + b"MTrk" + len(track).to_bytes(4, "big") + bytes(track))
        midi = midilib.MidiFile.parse(data)
        self.assertEqual(len(midi.notes), 2)
        self.assertAlmostEqual(midi.notes[0].duration, 0.5, places=3)
        self.assertAlmostEqual(midi.notes[1].duration, 1.0, places=3)

    def test_running_status_is_honoured(self):
        track = bytearray()
        track += smf._varlen(0) + bytes([0x90, 60, 100])
        track += smf._varlen(10) + bytes([64, 100])      # running status note-on
        track += smf._varlen(10) + bytes([0x80, 60, 0])
        track += smf._varlen(0) + bytes([64, 0])
        track += smf._varlen(0) + b"\xFF\x2F\x00"
        data = (b"MThd" + (6).to_bytes(4, "big") + (0).to_bytes(2, "big")
                + (1).to_bytes(2, "big") + (480).to_bytes(2, "big")
                + b"MTrk" + len(track).to_bytes(4, "big") + bytes(track))
        midi = midilib.MidiFile.parse(data)
        self.assertEqual(sorted(n.pitch for n in midi.notes), [60, 64])

    def test_note_on_with_zero_velocity_ends_note(self):
        track = bytearray()
        track += smf._varlen(0) + bytes([0x90, 60, 100])
        track += smf._varlen(240) + bytes([0x90, 60, 0])  # note-off by convention
        track += smf._varlen(0) + b"\xFF\x2F\x00"
        data = (b"MThd" + (6).to_bytes(4, "big") + (0).to_bytes(2, "big")
                + (1).to_bytes(2, "big") + (480).to_bytes(2, "big")
                + b"MTrk" + len(track).to_bytes(4, "big") + bytes(track))
        midi = midilib.MidiFile.parse(data)
        self.assertEqual(len(midi.notes), 1)
        self.assertAlmostEqual(midi.notes[0].duration, 0.25, places=3)

    def test_rejects_non_midi(self):
        with self.assertRaises(midilib.MidiError):
            midilib.MidiFile.parse(b"this is not a midi file at all")


class KeyDetectionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_key_signature_meta_wins(self):
        path = os.path.join(self.tmp.name, "ksig.mid")
        # Notes spell A minor; the signature says 3 sharps minor -> F# minor.
        helpers.make_arp_midi(path, tonic=9, mode="minor", key_signature=(3, True))
        label, tonic, mode, confidence = midilib.MidiFile.load(path).detect_key()
        self.assertEqual(label, "F# minor")
        self.assertEqual(tonic, 6)
        self.assertEqual(mode, "minor")
        self.assertEqual(confidence, 1.0)

    def test_falls_back_to_note_histogram(self):
        path = os.path.join(self.tmp.name, "nosig.mid")
        helpers.make_arp_midi(path, tonic=9, mode="minor")
        label, tonic, mode, _ = midilib.MidiFile.load(path).detect_key()
        self.assertEqual(tonic, 9)
        self.assertEqual(mode, "minor")
        self.assertEqual(label, "A minor")

    def test_major_arp_reads_as_major(self):
        path = os.path.join(self.tmp.name, "major.mid")
        helpers.make_arp_midi(path, tonic=0, mode="major")
        _label, tonic, mode, _ = midilib.MidiFile.load(path).detect_key()
        self.assertEqual((tonic, mode), (0, "major"))

    def test_empty_midi_has_unknown_key(self):
        path = os.path.join(self.tmp.name, "empty.mid")
        smf.write(path, [], bpm=120.0)
        label, tonic, _, _ = midilib.MidiFile.load(path).detect_key()
        self.assertEqual(label, "unknown")
        self.assertEqual(tonic, -1)


class RenderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "arp.mid")
        helpers.make_arp_midi(self.path, bpm=120.0, bars=2)
        self.midi = midilib.MidiFile.load(self.path)

    def test_renders_audible_audio(self):
        audio = midilib.render(self.midi, sample_rate=22050)
        self.assertGreater(audio.size, 22050)
        self.assertGreater(float(np.max(np.abs(audio))), 0.05)
        self.assertLessEqual(float(np.max(np.abs(audio))), 1.0)
        self.assertTrue(np.all(np.isfinite(audio)))

    def test_target_bpm_scales_duration(self):
        at_source = midilib.render(self.midi, sample_rate=22050, max_seconds=60)
        doubled = midilib.render(self.midi, sample_rate=22050, target_bpm=240.0, max_seconds=60)
        # Twice the tempo, about half the length.
        self.assertLess(doubled.size, at_source.size * 0.65)
        self.assertGreater(doubled.size, at_source.size * 0.35)

    def test_respects_max_seconds(self):
        audio = midilib.render(self.midi, sample_rate=22050, max_seconds=1.0)
        self.assertLessEqual(audio.size, 22050 + 1)

    def test_empty_midi_renders_silence_without_crashing(self):
        path = os.path.join(self.tmp.name, "empty.mid")
        smf.write(path, [], bpm=120.0)
        audio = midilib.render(midilib.MidiFile.load(path), sample_rate=22050)
        self.assertGreater(audio.size, 0)
        self.assertEqual(float(np.max(np.abs(audio))), 0.0)

    def test_drum_channel_renders_noise(self):
        # Channel 10 (index 9) is GM percussion and takes the noise path.
        audio = midilib._voice(38, 0.2, 100, 22050, channel=9)
        self.assertGreater(float(np.max(np.abs(audio))), 0.0)

    def test_lowpass_reduces_high_frequency_energy(self):
        rate = 22050
        t = np.arange(rate) / rate
        tone = np.sin(2 * np.pi * 9000 * t).astype(np.float32)
        filtered = midilib._lowpass(tone, rate, cutoff=2000.0)
        self.assertLess(float(np.max(np.abs(filtered))), float(np.max(np.abs(tone))) * 0.6)
        self.assertTrue(np.all(np.isfinite(filtered)))


if __name__ == "__main__":
    unittest.main()
