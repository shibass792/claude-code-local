"""Ingest helpers: URL detection, yt-dlp output parsing, WAV round trips."""
import os
import tempfile
import unittest
import wave

import numpy as np

import helpers
from dawmatch import audioio


class UrlDetectionTests(unittest.TestCase):
    def test_recognises_links(self):
        for text in ("https://youtu.be/abc", "http://example.com/a.mp3",
                     "HTTPS://WWW.YOUTUBE.COM/watch?v=x"):
            with self.subTest(text=text):
                self.assertTrue(audioio.is_url(text))

    def test_rejects_paths_and_empties(self):
        for text in ("/Users/me/track.wav", "~/Music/a.mp3", "track.mp3", "", None):
            with self.subTest(text=text):
                self.assertFalse(audioio.is_url(text))


class YtDlpOutputTests(unittest.TestCase):
    """yt-dlp prints each field at its own stage, so order must not matter."""

    def test_title_printed_before_path(self):
        path, title = audioio._parse_ytdlp_output(
            "DAWMATCH_TITLE:Some Track\nDAWMATCH_PATH:/tmp/x/abc.m4a\n")
        self.assertEqual(path, "/tmp/x/abc.m4a")
        self.assertEqual(title, "Some Track")

    def test_path_printed_before_title(self):
        path, title = audioio._parse_ytdlp_output(
            "DAWMATCH_PATH:/tmp/x/abc.m4a\nDAWMATCH_TITLE:Some Track\n")
        self.assertEqual(path, "/tmp/x/abc.m4a")
        self.assertEqual(title, "Some Track")

    def test_unrelated_chatter_is_ignored(self):
        path, title = audioio._parse_ytdlp_output(
            "[download] Destination: whatever\n"
            "DAWMATCH_PATH:/tmp/x/abc.m4a\n"
            "[download] 100%\n"
            "DAWMATCH_TITLE:Some Track\n")
        self.assertEqual(path, "/tmp/x/abc.m4a")
        self.assertEqual(title, "Some Track")

    def test_missing_title_falls_back_to_the_filename(self):
        path, title = audioio._parse_ytdlp_output("DAWMATCH_PATH:/tmp/x/my-track.m4a\n")
        self.assertEqual(path, "/tmp/x/my-track.m4a")
        self.assertEqual(title, "my-track")

    def test_paths_with_spaces_survive(self):
        path, _title = audioio._parse_ytdlp_output("DAWMATCH_PATH:/tmp/a b/My Track.m4a\n")
        self.assertEqual(path, "/tmp/a b/My Track.m4a")

    def test_no_output_yields_nothing(self):
        self.assertEqual(audioio._parse_ytdlp_output(""), ("", ""))
        self.assertEqual(audioio._parse_ytdlp_output(None), ("", ""))


class ResolveInputTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_local_file_resolves_to_itself(self):
        target = os.path.join(self.tmp.name, "My Track.wav")
        helpers.write_wav_loop(target, seconds=3.0)
        path, title, kind = audioio.resolve_input(target)
        self.assertEqual(path, target)
        self.assertEqual(title, "My Track")
        self.assertEqual(kind, "file")

    def test_surrounding_quotes_are_stripped(self):
        target = os.path.join(self.tmp.name, "Quoted.wav")
        helpers.write_wav_loop(target, seconds=3.0)
        path, _title, _kind = audioio.resolve_input(f'"{target}"')
        self.assertEqual(path, target)

    def test_empty_input_is_rejected(self):
        with self.assertRaises(audioio.IngestError) as ctx:
            audioio.resolve_input("   ")
        self.assertIn("paste a link", str(ctx.exception))

    def test_missing_file_is_rejected(self):
        with self.assertRaises(audioio.IngestError) as ctx:
            audioio.resolve_input("/no/such/file.wav")
        self.assertIn("no such file", str(ctx.exception))


class DecodeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_decodes_to_mono_float(self):
        target = os.path.join(self.tmp.name, "loop.wav")
        helpers.write_wav_loop(target, seconds=5.0)
        samples = audioio.decode(target)
        self.assertEqual(samples.dtype, np.float32)
        self.assertGreater(samples.size, audioio.SAMPLE_RATE * 4)
        self.assertLessEqual(float(np.max(np.abs(samples))), 1.0)

    def test_max_seconds_truncates(self):
        target = os.path.join(self.tmp.name, "long.wav")
        helpers.write_wav_loop(target, seconds=20.0)
        samples = audioio.decode(target, max_seconds=5.0)
        self.assertLess(samples.size, audioio.SAMPLE_RATE * 6)

    def test_missing_file_is_rejected(self):
        with self.assertRaises(audioio.IngestError):
            audioio.decode("/no/such/file.wav")

    def test_non_audio_file_is_rejected_cleanly(self):
        target = os.path.join(self.tmp.name, "notaudio.wav")
        with open(target, "wb") as fh:
            fh.write(b"this is not audio")
        with self.assertRaises(audioio.IngestError) as ctx:
            audioio.decode(target)
        self.assertIn("could not decode", str(ctx.exception))


class WavWritingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_write_wav_produces_a_correct_header(self):
        target = os.path.join(self.tmp.name, "out.wav")
        samples = np.sin(np.linspace(0, 200, 44100)).astype(np.float32)
        audioio.write_wav(target, samples, sample_rate=44100)
        with wave.open(target) as wav:
            self.assertEqual(wav.getnchannels(), 1)
            self.assertEqual(wav.getsampwidth(), 2)
            self.assertEqual(wav.getframerate(), 44100)
            self.assertEqual(wav.getnframes(), 44100)

    def test_wav_bytes_reports_a_truthful_duration(self):
        import io

        samples = np.zeros(22050, dtype=np.float32)
        data = audioio.wav_bytes(samples, sample_rate=22050)
        with wave.open(io.BytesIO(data)) as wav:
            self.assertAlmostEqual(wav.getnframes() / wav.getframerate(), 1.0, places=3)

    def test_loud_input_is_normalised_not_clipped(self):
        import io

        samples = (np.sin(np.linspace(0, 100, 22050)) * 12.0).astype(np.float32)
        data = audioio.wav_bytes(samples, sample_rate=22050)
        with wave.open(io.BytesIO(data)) as wav:
            pcm = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2")
        self.assertLess(int(np.max(np.abs(pcm))), 32767)
        self.assertGreater(int(np.max(np.abs(pcm))), 20000)

    def test_excerpt_has_the_requested_length(self):
        import io

        source = os.path.join(self.tmp.name, "source.wav")
        helpers.write_wav_loop(source, seconds=20.0)
        data = audioio.excerpt_wav_bytes(source, start=2.0, duration=4.0, sample_rate=22050)
        with wave.open(io.BytesIO(data)) as wav:
            self.assertAlmostEqual(wav.getnframes() / wav.getframerate(), 4.0, delta=0.25)


if __name__ == "__main__":
    unittest.main()
