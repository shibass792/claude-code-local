"""Library scanning: filename parsing, file parsing, sidecars, index caching."""
import gzip
import json
import os
import tempfile
import unittest

import helpers
from dawmatch import config, library


class StateDirMixin:
    """Point the index cache at a throwaway directory."""

    def setUp(self):
        super().setUp()
        self.state = tempfile.TemporaryDirectory()
        self.addCleanup(self.state.cleanup)
        self._saved = (config.STATE_DIR, config.INDEX_PATH, config.LINKS_PATH, config.CACHE_DIR)
        config.STATE_DIR = self.state.name
        config.INDEX_PATH = os.path.join(self.state.name, "index.json")
        config.LINKS_PATH = os.path.join(self.state.name, "links.json")
        config.CACHE_DIR = os.path.join(self.state.name, "cache")
        self.addCleanup(self._restore)

    def _restore(self):
        config.STATE_DIR, config.INDEX_PATH, config.LINKS_PATH, config.CACHE_DIR = self._saved


class FilenameParsingTests(unittest.TestCase):
    def test_bpm_formats(self):
        cases = {
            "Dark Arp 128bpm Amin": 128.0,
            "Dark Arp 128 BPM": 128.0,
            "arp_bpm-174_dnb": 174.0,
            "Pluck_90_Emaj": 90.0,
            "Loop 174bpm": 174.0,
        }
        for name, expected in cases.items():
            with self.subTest(name=name):
                self.assertEqual(library.parse_bpm_from_name(name), expected)

    def test_implausible_tempo_rejected(self):
        self.assertIsNone(library.parse_bpm_from_name("Take 999 bpm"))
        self.assertIsNone(library.parse_bpm_from_name("no numbers here"))

    def test_key_formats(self):
        cases = {
            "Dark Arp 128bpm Amin": ("A minor", 9, "minor"),
            "Pluck 90 Emaj": ("E major", 4, "major"),
            "Riser F#m 140": ("F# minor", 6, "minor"),
            "Chords Bb major": ("A# major", 10, "major"),
            "Stab_Db_minor": ("C# minor", 1, "minor"),
        }
        for name, expected in cases.items():
            with self.subTest(name=name):
                self.assertEqual(library.parse_key_from_name(name), expected)

    def test_bare_letter_gives_tonic_without_mode(self):
        label, tonic, mode = library.parse_key_from_name("Arp A 128")
        self.assertEqual((label, tonic, mode), ("A", 9, ""))

    def test_no_key_in_name(self):
        self.assertEqual(library.parse_key_from_name("just_a_loop_128"), (None, -1, ""))


class DescribeTests(StateDirMixin, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.lib = tempfile.TemporaryDirectory()
        self.addCleanup(self.lib.cleanup)

    def path(self, name):
        return os.path.join(self.lib.name, name)

    def test_midi_metadata_beats_filename(self):
        # Filename claims 100 BPM; the file itself says 128.
        path = self.path("Mislabelled 100bpm Cmaj.mid")
        helpers.make_arp_midi(path, bpm=128.0, tonic=9, mode="minor")
        entry = library.describe(path)
        self.assertEqual(entry["kind"], "arp")
        self.assertAlmostEqual(entry["bpm"], 128.0, places=1)
        self.assertEqual(entry["key"], "A minor")
        self.assertEqual(entry["source"], "midi")
        self.assertEqual(entry["notes"], 32)
        # A readable file must not quietly land in the warning field.
        self.assertEqual(entry["warning"], "")

    def test_audio_loop_is_analysed(self):
        path = self.path("Loop unlabelled.wav")
        helpers.write_wav_loop(path, bpm=128.0, chord="A minor", seconds=8.0)
        entry = library.describe(path)
        self.assertEqual(entry["kind"], "loop")
        self.assertEqual(entry["source"], "audio")
        self.assertAlmostEqual(entry["bpm"], 128.0, delta=2.0)
        self.assertEqual(entry["key"], "A minor")
        self.assertIsNotNone(entry["brightness"])

    def test_project_file_uses_filename(self):
        path = self.path("Big Room 128bpm Fmin.cpr")
        with open(path, "wb") as fh:
            fh.write(b"cubase-binary-placeholder")
        entry = library.describe(path)
        self.assertEqual(entry["kind"], "project")
        self.assertEqual(entry["daw"], "cubase")
        self.assertEqual(entry["bpm"], 128.0)
        self.assertEqual(entry["key"], "F minor")

    def test_ableton_project_tempo_is_read_from_gzipped_xml(self):
        path = self.path("Untitled.als")
        xml = (
            '<?xml version="1.0"?><Ableton><LiveSet>'
            '<Tempo><LomId Value="0" /><Manual Value="137.5" /></Tempo>'
            '<ScaleInformation><RootNote Value="9" /><Name Value="Minor" /></ScaleInformation>'
            "</LiveSet></Ableton>"
        )
        with gzip.open(path, "wt", encoding="utf-8") as fh:
            fh.write(xml)
        entry = library.describe(path)
        self.assertEqual(entry["daw"], "ableton")
        self.assertAlmostEqual(entry["bpm"], 137.5, places=1)
        self.assertEqual(entry["key"], "A minor")
        self.assertEqual(entry["source"], "project")

    def test_corrupt_ableton_project_does_not_raise(self):
        path = self.path("Broken 120bpm.als")
        with open(path, "wb") as fh:
            fh.write(b"not gzip at all")
        entry = library.describe(path)
        self.assertEqual(entry["bpm"], 120.0)  # fell back to the filename

    def test_sidecar_overrides_everything(self):
        path = self.path("Arp 128bpm Amin.mid")
        helpers.make_arp_midi(path, bpm=128.0, tonic=9, mode="minor")
        with open(self.path("Arp 128bpm Amin.dawmatch.json"), "w", encoding="utf-8") as fh:
            json.dump({"bpm": 174, "key": "D minor", "tonic": 2, "mode": "minor"}, fh)
        entry = library.describe(path)
        self.assertEqual(entry["bpm"], 174)
        self.assertEqual(entry["key"], "D minor")
        self.assertEqual(entry["tonic"], 2)
        self.assertEqual(entry["source"], "sidecar")

    def test_sidecar_key_string_backfills_tonic(self):
        path = self.path("Plain.mid")
        helpers.make_arp_midi(path, bpm=120.0)
        with open(self.path("Plain.dawmatch.json"), "w", encoding="utf-8") as fh:
            json.dump({"key": "F# minor"}, fh)
        entry = library.describe(path)
        self.assertEqual(entry["tonic"], 6)
        self.assertEqual(entry["mode"], "minor")

    def test_broken_midi_records_a_warning_instead_of_raising(self):
        path = self.path("Broken 128bpm.mid")
        with open(path, "wb") as fh:
            fh.write(b"definitely not midi")
        entry = library.describe(path)
        self.assertTrue(entry["warning"])
        self.assertEqual(entry["bpm"], 128.0)


class ScanTests(StateDirMixin, unittest.TestCase):
    def setUp(self):
        super().setUp()
        self.lib = tempfile.TemporaryDirectory()
        self.addCleanup(self.lib.cleanup)
        helpers.make_arp_midi(os.path.join(self.lib.name, "A 128bpm Amin.mid"), bpm=128.0)
        helpers.make_arp_midi(os.path.join(self.lib.name, "B 140bpm Dmin.mid"), bpm=140.0, tonic=2)
        nested = os.path.join(self.lib.name, "packs", "vol1")
        os.makedirs(nested)
        helpers.make_arp_midi(os.path.join(nested, "C 90bpm Emaj.mid"), bpm=90.0, tonic=4, mode="major")
        with open(os.path.join(self.lib.name, "notes.txt"), "w", encoding="utf-8") as fh:
            fh.write("ignore me")

    def test_finds_supported_files_recursively(self):
        entries, stats = library.scan([self.lib.name])
        self.assertEqual(len(entries), 3)
        self.assertEqual(stats["scanned"], 3)
        self.assertEqual(stats["cached"], 0)
        self.assertNotIn("notes.txt", [os.path.basename(e["path"]) for e in entries])

    def test_second_scan_uses_the_cache(self):
        library.scan([self.lib.name])
        _entries, stats = library.scan([self.lib.name])
        self.assertEqual(stats["cached"], 3)
        self.assertEqual(stats["scanned"], 0)

    def test_changed_file_is_rescanned(self):
        library.scan([self.lib.name])
        changed = os.path.join(self.lib.name, "A 128bpm Amin.mid")
        helpers.make_arp_midi(changed, bpm=150.0, bars=3)
        os.utime(changed, (0, 0))
        _entries, stats = library.scan([self.lib.name])
        self.assertEqual(stats["scanned"], 1)
        self.assertEqual(stats["cached"], 2)

    def test_missing_root_is_reported_not_fatal(self):
        entries, stats = library.scan([self.lib.name, "/no/such/place"])
        self.assertEqual(len(entries), 3)
        self.assertIn("/no/such/place", stats["missing_roots"])

    def test_hidden_files_and_folders_are_skipped(self):
        hidden_dir = os.path.join(self.lib.name, ".hidden")
        os.makedirs(hidden_dir)
        helpers.make_arp_midi(os.path.join(hidden_dir, "Sneaky 128bpm.mid"))
        helpers.make_arp_midi(os.path.join(self.lib.name, ".dotfile 128bpm.mid"))
        entries, _ = library.scan([self.lib.name])
        self.assertEqual(len(entries), 3)

    def test_max_files_caps_the_index(self):
        entries, stats = library.scan([self.lib.name], use_cache=False, max_files=2)
        self.assertEqual(len(entries), 2)
        self.assertGreaterEqual(stats["skipped"], 1)

    def test_load_index_reads_what_scan_wrote(self):
        library.scan([self.lib.name])
        self.assertEqual(len(library.load_index()), 3)

    def test_load_index_survives_a_corrupt_cache(self):
        with open(config.INDEX_PATH, "w", encoding="utf-8") as fh:
            fh.write("{not json")
        self.assertEqual(library.load_index(), [])

    def test_entry_ids_are_stable_and_unique(self):
        entries, _ = library.scan([self.lib.name])
        ids = [library.entry_id(e["path"]) for e in entries]
        self.assertEqual(len(set(ids)), 3)
        self.assertEqual(ids[0], library.entry_id(entries[0]["path"]))
        self.assertEqual(len(library.index_by_id(entries)), 3)


if __name__ == "__main__":
    unittest.main()
