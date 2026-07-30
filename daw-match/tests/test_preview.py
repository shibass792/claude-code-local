"""The audio the play button streams."""
import os
import tempfile
import unittest
import wave

import helpers
from dawmatch import preview


class MidiPreviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.arp = os.path.join(self.tmp.name, "Arp 128bpm Amin.mid")
        helpers.make_arp_midi(self.arp, bpm=128.0, bars=4)
        self.entry = {"path": self.arp, "kind": "arp", "name": "Arp 128bpm Amin"}

    def test_produces_a_playable_wav(self):
        data, note = preview.build(self.entry)
        self.assertTrue(data.startswith(b"RIFF"))
        self.assertIn(b"WAVE", data[:16])
        self.assertIn("128", note)
        with wave.open(io_bytes(data)) as wav:
            self.assertEqual(wav.getnchannels(), 1)
            self.assertEqual(wav.getsampwidth(), 2)
            self.assertGreater(wav.getnframes(), wav.getframerate())

    def test_target_bpm_is_reflected_in_the_note(self):
        _data, note = preview.build(self.entry, target_bpm=90.0)
        self.assertIn("90", note)
        self.assertIn("128", note)

    def test_target_bpm_changes_the_length(self):
        slow, _ = preview.build(self.entry, target_bpm=64.0, seconds=30.0)
        fast, _ = preview.build(self.entry, target_bpm=256.0, seconds=30.0)
        self.assertGreater(len(slow), len(fast))

    def test_empty_midi_is_reported(self):
        from dawmatch import smf

        path = os.path.join(self.tmp.name, "empty.mid")
        smf.write(path, [], bpm=120.0)
        with self.assertRaises(preview.PreviewError) as ctx:
            preview.build({"path": path, "kind": "arp", "name": "empty"})
        self.assertIn("no notes", str(ctx.exception))

    def test_broken_midi_is_reported(self):
        path = os.path.join(self.tmp.name, "broken.mid")
        with open(path, "wb") as fh:
            fh.write(b"nope")
        with self.assertRaises(preview.PreviewError):
            preview.build({"path": path, "kind": "arp", "name": "broken"})


class AudioPreviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.loop = os.path.join(self.tmp.name, "Loop 128bpm Amin.wav")
        helpers.write_wav_loop(self.loop, seconds=20.0)

    def test_excerpt_is_returned(self):
        data, note = preview.build({"path": self.loop, "kind": "loop", "name": "Loop"}, seconds=5.0)
        self.assertTrue(data.startswith(b"RIFF"))
        self.assertEqual(note, "audio excerpt")
        with wave.open(io_bytes(data)) as wav:
            seconds = wav.getnframes() / wav.getframerate()
            self.assertGreater(seconds, 4.0)
            self.assertLess(seconds, 6.0)

    def test_unknown_kind_is_reported(self):
        with self.assertRaises(preview.PreviewError):
            preview.build({"path": self.loop, "kind": "something-else", "name": "x"})


class ProjectPreviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.project = os.path.join(self.tmp.name, "Session 128bpm Amin.cpr")
        with open(self.project, "wb") as fh:
            fh.write(b"cpr")
        self.entry = {"path": self.project, "kind": "project", "name": "Session"}

    def test_no_companion_explains_itself(self):
        with self.assertRaises(preview.PreviewError) as ctx:
            preview.build(self.entry)
        self.assertIn("no audio", str(ctx.exception))

    def test_sibling_midi_becomes_the_preview(self):
        sibling = os.path.join(self.tmp.name, "Session 128bpm Amin.mid")
        helpers.make_arp_midi(sibling, bpm=128.0)
        data, note = preview.build(self.entry)
        self.assertTrue(data.startswith(b"RIFF"))
        self.assertIn("Session 128bpm Amin.mid", note)

    def test_sibling_bounce_becomes_the_preview(self):
        sibling = os.path.join(self.tmp.name, "Session 128bpm Amin.wav")
        helpers.write_wav_loop(sibling, seconds=8.0)
        _data, note = preview.build(self.entry)
        self.assertIn(".wav", note)

    def test_explicit_preview_field_wins(self):
        chosen = os.path.join(self.tmp.name, "chosen-bounce.wav")
        helpers.write_wav_loop(chosen, seconds=8.0)
        _data, note = preview.build({**self.entry, "preview": chosen})
        self.assertIn("chosen-bounce.wav", note)

    def test_bounce_in_an_audio_subfolder_is_found(self):
        audio_dir = os.path.join(self.tmp.name, "Audio")
        os.makedirs(audio_dir)
        bounce = os.path.join(audio_dir, "Session mixdown.wav")
        helpers.write_wav_loop(bounce, seconds=8.0)
        self.assertEqual(preview.find_companion(self.entry), bounce)


def io_bytes(data):
    import io

    return io.BytesIO(data)


if __name__ == "__main__":
    unittest.main()
