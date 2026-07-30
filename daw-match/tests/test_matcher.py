"""Scoring behaviour: tempo relationships, key relationships, ranking."""
import unittest

import helpers  # noqa: F401  (path setup)
from dawmatch import matcher


def entry(bpm=None, tonic=-1, mode="", kind="arp", name="x", **extra):
    base = {"bpm": bpm, "tonic": tonic, "mode": mode, "kind": kind, "name": name, "path": f"/lib/{name}.mid"}
    base.update(extra)
    return base


class TempoScoreTests(unittest.TestCase):
    def test_exact_match_is_perfect(self):
        score, label = matcher.tempo_score(128.0, 128.0)
        self.assertAlmostEqual(score, 1.0, places=3)
        self.assertEqual(label, "same tempo")

    def test_half_and_double_time_score_well(self):
        for entry_bpm, expected in ((64.0, "half-time"), (256.0, "double-time")):
            with self.subTest(entry_bpm=entry_bpm):
                score, label = matcher.tempo_score(128.0, entry_bpm)
                self.assertGreater(score, 0.85)
                self.assertEqual(label, expected)

    def test_exact_beats_half_time(self):
        exact, _ = matcher.tempo_score(128.0, 128.0)
        halved, _ = matcher.tempo_score(128.0, 64.0)
        self.assertGreater(exact, halved)

    def test_three_two_ratio_is_credited_but_penalised(self):
        score, label = matcher.tempo_score(128.0, 192.0)
        self.assertEqual(label, "3:2 tempo")
        self.assertGreater(score, 0.6)
        self.assertLess(score, 0.85)

    def test_unrelated_tempo_scores_poorly(self):
        score, _ = matcher.tempo_score(128.0, 103.0)
        self.assertLess(score, 0.1)

    def test_small_drift_still_counts_as_same_tempo(self):
        score, _ = matcher.tempo_score(128.0, 129.0)
        self.assertGreater(score, 0.9)

    def test_missing_tempo_is_neutral(self):
        for pair in ((None, 128.0), (128.0, None), (None, None)):
            with self.subTest(pair=pair):
                score, label = matcher.tempo_score(*pair)
                self.assertEqual(label, "tempo unknown")
                self.assertAlmostEqual(score, 0.35)


class KeyScoreTests(unittest.TestCase):
    def test_same_key_is_perfect(self):
        score, label = matcher.key_score(9, "minor", 9, "minor")
        self.assertEqual(score, 1.0)
        self.assertEqual(label, "same key")

    def test_relative_major_of_a_minor_is_c_major(self):
        score, label = matcher.key_score(9, "minor", 0, "major")
        self.assertEqual(label, "relative major")
        self.assertGreater(score, 0.8)

    def test_relative_minor_of_c_major_is_a_minor(self):
        score, label = matcher.key_score(0, "major", 9, "minor")
        self.assertEqual(label, "relative minor")
        self.assertGreater(score, 0.8)

    def test_fifth_beats_tritone(self):
        fifth, label = matcher.key_score(0, "minor", 7, "minor")
        tritone, _ = matcher.key_score(0, "minor", 6, "minor")
        self.assertEqual(label, "a fifth away")
        self.assertGreater(fifth, tritone)

    def test_ordering_same_key_then_relative_then_fifth(self):
        same, _ = matcher.key_score(9, "minor", 9, "minor")
        relative, _ = matcher.key_score(9, "minor", 0, "major")
        fifth, _ = matcher.key_score(9, "minor", 4, "minor")
        self.assertGreater(same, relative)
        self.assertGreater(relative, fifth)

    def test_tonic_only_hint_rewards_matching_root(self):
        match, label = matcher.key_score(9, "minor", 9, "")
        far, _ = matcher.key_score(9, "minor", 3, "")
        self.assertEqual(label, "same root")
        self.assertGreater(match, far)
        self.assertLess(match, 1.0)

    def test_unknown_key_is_neutral(self):
        score, label = matcher.key_score(-1, "", 9, "minor")
        self.assertEqual(label, "key unknown")
        self.assertAlmostEqual(score, 0.35)


class TimbreScoreTests(unittest.TestCase):
    def test_similar_tone_scores_high(self):
        score, label = matcher.timbre_score(
            {"brightness": 0.5, "loudness": 0.6}, {"brightness": 0.52, "loudness": 0.58})
        self.assertGreater(score, 0.9)
        self.assertEqual(label, "similar tone")

    def test_opposite_tone_scores_low(self):
        score, label = matcher.timbre_score(
            {"brightness": 0.05, "loudness": 0.1}, {"brightness": 0.95, "loudness": 0.95})
        self.assertLess(score, 0.4)
        self.assertEqual(label, "contrasting tone")

    def test_missing_data_is_neutral(self):
        score, label = matcher.timbre_score({"brightness": 0.5}, {})
        self.assertEqual(score, 0.5)
        self.assertEqual(label, "")


class RankTests(unittest.TestCase):
    def setUp(self):
        self.track = {"bpm": 128.0, "tonic": 9, "mode": "minor", "brightness": 0.5, "loudness": 0.6}
        self.entries = [
            entry(bpm=128.0, tonic=9, mode="minor", name="perfect"),
            entry(bpm=64.0, tonic=9, mode="minor", name="halftime"),
            entry(bpm=128.0, tonic=0, mode="major", name="relative"),
            entry(bpm=103.0, tonic=6, mode="major", name="clash"),
            entry(bpm=128.0, tonic=9, mode="minor", name="project", kind="project"),
        ]

    def test_best_match_ranks_first(self):
        ranked = matcher.rank(self.track, self.entries)
        self.assertEqual(ranked[0]["name"], "perfect")
        self.assertEqual(ranked[-1]["name"], "clash")

    def test_scores_are_monotonically_decreasing(self):
        scores = [m["score"] for m in matcher.rank(self.track, self.entries)]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_scores_stay_in_unit_range(self):
        for match in matcher.rank(self.track, self.entries):
            self.assertGreaterEqual(match["score"], 0.0)
            self.assertLessEqual(match["score"], 1.0)

    def test_prefer_biases_a_kind(self):
        without = {m["name"]: m["score"] for m in matcher.rank(self.track, self.entries)}
        with_bias = {m["name"]: m["score"] for m in matcher.rank(self.track, self.entries, prefer="project")}
        self.assertGreater(with_bias["project"], without["project"])
        self.assertEqual(with_bias["perfect"], without["perfect"])

    def test_limit_and_min_score_are_applied(self):
        self.assertEqual(len(matcher.rank(self.track, self.entries, limit=2)), 2)
        filtered = matcher.rank(self.track, self.entries, min_score=0.9)
        self.assertTrue(all(m["score"] >= 0.9 for m in filtered))
        self.assertNotIn("clash", [m["name"] for m in filtered])

    def test_reasons_are_human_readable(self):
        top = matcher.rank(self.track, self.entries)[0]
        self.assertIn("same tempo", top["reasons"])
        self.assertIn("same key", top["reasons"])

    def test_parsed_metadata_outranks_guessed_filename(self):
        guessed = entry(bpm=128.0, tonic=9, mode="minor", name="guessed", source="filename")
        parsed = entry(bpm=128.0, tonic=9, mode="minor", name="parsed", source="midi")
        ranked = matcher.rank(self.track, [guessed, parsed])
        self.assertEqual(ranked[0]["name"], "parsed")

    def test_empty_library_returns_empty(self):
        self.assertEqual(matcher.rank(self.track, []), [])

    def test_original_entry_is_not_mutated(self):
        original = entry(bpm=128.0, tonic=9, mode="minor", name="keepme")
        matcher.rank(self.track, [original])
        self.assertNotIn("score", original)


class DescribeTests(unittest.TestCase):
    def test_summary_includes_tempo_and_key(self):
        self.assertEqual(
            matcher.describe_track({"bpm": 128.0, "key": "A minor"}), "128 BPM · A minor")

    def test_summary_handles_missing_values(self):
        self.assertEqual(matcher.describe_track({}), "tempo unknown · unknown key")

    def test_key_label(self):
        self.assertEqual(matcher.key_label(9, "minor"), "A minor")
        self.assertEqual(matcher.key_label(-1, ""), "unknown")


if __name__ == "__main__":
    unittest.main()
