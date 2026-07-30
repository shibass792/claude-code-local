"""Tempo, key and energy detection against signals with known ground truth."""
import unittest

import numpy as np

import helpers
from dawmatch import analysis


class TempoTests(unittest.TestCase):
    def test_detects_common_tempos(self):
        for bpm in (90.0, 120.0, 128.0, 140.0, 174.0):
            with self.subTest(bpm=bpm):
                detected, confidence = analysis.detect_tempo(helpers.make_track(bpm=bpm))
                self.assertAlmostEqual(detected, bpm, delta=1.5)
                self.assertGreater(confidence, 0.5)

    def test_silence_reports_no_tempo(self):
        detected, confidence = analysis.detect_tempo(np.zeros(analysis.SAMPLE_RATE * 3, dtype=np.float32))
        self.assertEqual(detected, 0.0)
        self.assertEqual(confidence, 0.0)

    def test_very_short_clip_does_not_raise(self):
        detected, _ = analysis.detect_tempo(np.zeros(64, dtype=np.float32))
        self.assertEqual(detected, 0.0)

    def test_parabolic_refinement_stays_between_neighbours(self):
        grid = np.array([120.0, 120.5, 121.0])
        scores = np.array([0.4, 1.0, 0.6])
        refined = analysis._refine_peak(grid, scores, 1)
        self.assertGreater(refined, 120.5)
        self.assertLess(refined, 121.0)


class KeyTests(unittest.TestCase):
    def test_detects_chord_keys(self):
        for chord in ("A minor", "C major", "F# minor", "G major", "D minor"):
            with self.subTest(chord=chord):
                label, tonic, mode, _ = analysis.detect_key(helpers.make_track(chord=chord))
                self.assertEqual(label, chord)
                self.assertGreaterEqual(tonic, 0)
                self.assertIn(mode, ("major", "minor"))

    def test_chroma_peaks_on_played_pitch_classes(self):
        chroma = analysis.chroma_vector(helpers.make_track(chord="A minor"))
        self.assertAlmostEqual(float(chroma.sum()), 1.0, places=5)
        # A minor triad is A, C, E -> pitch classes 9, 0, 4.
        top_three = set(np.argsort(-chroma)[:3].tolist())
        self.assertTrue(top_three & {9, 0, 4}, f"expected A/C/E energy, got {chroma.round(3)}")
        self.assertIn(9, np.argsort(-chroma)[:4].tolist())

    def test_silence_has_unknown_key(self):
        label, tonic, _, confidence = analysis.key_from_chroma(np.zeros(12))
        self.assertEqual(label, "unknown")
        self.assertEqual(tonic, -1)
        self.assertEqual(confidence, 0.0)


class EnergyTests(unittest.TestCase):
    def test_loud_signal_reads_louder_than_quiet_one(self):
        loud = helpers.make_track()
        quiet = loud * 0.05
        self.assertGreater(
            analysis.energy_profile(loud)["loudness"],
            analysis.energy_profile(quiet)["loudness"],
        )

    def test_bright_signal_reads_brighter(self):
        rate = analysis.SAMPLE_RATE
        t = np.arange(rate * 4) / rate
        low = np.sin(2 * np.pi * 110 * t).astype(np.float32)
        high = np.sin(2 * np.pi * 3200 * t).astype(np.float32)
        self.assertGreater(
            analysis.energy_profile(high)["brightness"],
            analysis.energy_profile(low)["brightness"],
        )

    def test_analyze_returns_full_fingerprint(self):
        result = analysis.analyze(helpers.make_track(bpm=128.0, chord="A minor"))
        for field in ("bpm", "key", "tonic", "mode", "duration", "brightness", "loudness"):
            self.assertIn(field, result)
        self.assertAlmostEqual(result["bpm"], 128.0, delta=1.5)
        self.assertEqual(result["key"], "A minor")


if __name__ == "__main__":
    unittest.main()
