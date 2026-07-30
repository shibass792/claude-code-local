"""Staging, pairing records and the DAW launch call."""
import json
import os
import stat
import tempfile
import unittest

import helpers  # noqa: F401  (path setup)
from dawmatch import config, daw


class DawTestCase(unittest.TestCase):
    def setUp(self):
        self.state = tempfile.TemporaryDirectory()
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.state.cleanup)
        self.addCleanup(self.work.cleanup)

        self._saved = (config.STATE_DIR, config.LINKS_PATH)
        config.STATE_DIR = self.state.name
        config.LINKS_PATH = os.path.join(self.state.name, "links.json")
        self.addCleanup(self._restore)

        self.sessions = os.path.join(self.work.name, "sessions")
        self.opened_log = os.path.join(self.work.name, "opened.log")
        self.opener = os.path.join(self.work.name, "opener.sh")
        with open(self.opener, "w", encoding="utf-8") as fh:
            fh.write('#!/bin/sh\nprintf "%s|%s\\n" "$1" "$2" >> "$LOG"\n')
        os.chmod(self.opener, os.stat(self.opener).st_mode | stat.S_IXUSR)
        os.environ["LOG"] = self.opened_log
        self.addCleanup(os.environ.pop, "LOG", None)

        self.cfg = config.Config()
        self.cfg.sessions_dir = self.sessions
        self.cfg.open_cmd = self.opener

        self.arp = os.path.join(self.work.name, "Dark Arp 128bpm Amin.mid")
        helpers.make_arp_midi(self.arp, bpm=128.0)

        self.track = {"title": "Some Track", "source": "https://example.com/watch?v=x",
                      "bpm": 128.0, "key": "A minor", "duration": 200.0}
        self.entry = {"path": self.arp, "name": "Dark Arp 128bpm Amin", "kind": "arp",
                      "bpm": 128.0, "key": "A minor", "score": 0.97, "reasons": ["same tempo", "same key"]}

    def _restore(self):
        config.STATE_DIR, config.LINKS_PATH = self._saved

    def read_log(self):
        if not os.path.exists(self.opened_log):
            return []
        with open(self.opened_log, "r", encoding="utf-8") as fh:
            return [line.strip() for line in fh if line.strip()]


class SlugTests(unittest.TestCase):
    def test_makes_filesystem_safe_names(self):
        self.assertEqual(daw.slugify("Daft Punk — Around the World (HD)"),
                         "Daft-Punk-Around-the-World-HD")

    def test_keeps_hebrew_characters(self):
        self.assertEqual(daw.slugify("שיר בעברית"), "שיר-בעברית")

    def test_empty_falls_back(self):
        self.assertEqual(daw.slugify("", fallback="track"), "track")
        self.assertEqual(daw.slugify("///"), "track")

    def test_length_is_capped(self):
        self.assertLessEqual(len(daw.slugify("a" * 200)), 60)


class StagingTests(DawTestCase):
    def test_arp_is_copied_into_the_session_folder(self):
        folder, staged = daw.stage(self.track, self.entry, self.cfg)
        self.assertTrue(os.path.isdir(folder))
        self.assertTrue(os.path.exists(staged))
        self.assertEqual(os.path.dirname(staged), folder)
        self.assertEqual(os.path.basename(staged), os.path.basename(self.arp))
        # The original stays where it was.
        self.assertTrue(os.path.exists(self.arp))

    def test_session_manifest_records_the_pairing(self):
        folder, _ = daw.stage(self.track, self.entry, self.cfg)
        with open(os.path.join(folder, "session.json"), "r", encoding="utf-8") as fh:
            manifest = json.load(fh)
        self.assertEqual(manifest["track"]["title"], "Some Track")
        self.assertEqual(manifest["track"]["bpm"], 128.0)
        self.assertEqual(len(manifest["matches"]), 1)
        self.assertEqual(manifest["matches"][0]["original"], self.arp)
        self.assertEqual(manifest["matches"][0]["score"], 0.97)

    def test_readme_is_human_readable(self):
        folder, _ = daw.stage(self.track, self.entry, self.cfg)
        with open(os.path.join(folder, "README.txt"), "r", encoding="utf-8") as fh:
            text = fh.read()
        self.assertIn("Some Track", text)
        self.assertIn("128.0 BPM", text)
        self.assertIn("A minor", text)
        self.assertIn("same tempo", text)
        self.assertIn("97%", text)

    def test_restaging_the_same_arp_does_not_duplicate_it(self):
        daw.stage(self.track, self.entry, self.cfg)
        folder, _ = daw.stage(self.track, self.entry, self.cfg)
        with open(os.path.join(folder, "session.json"), "r", encoding="utf-8") as fh:
            manifest = json.load(fh)
        self.assertEqual(len(manifest["matches"]), 1)

    def test_second_arp_is_added_to_the_same_session(self):
        other = os.path.join(self.work.name, "Other 128bpm Amin.mid")
        helpers.make_arp_midi(other, bpm=128.0)
        daw.stage(self.track, self.entry, self.cfg)
        folder, _ = daw.stage(self.track, {**self.entry, "path": other, "name": "Other"}, self.cfg)
        with open(os.path.join(folder, "session.json"), "r", encoding="utf-8") as fh:
            manifest = json.load(fh)
        self.assertEqual(len(manifest["matches"]), 2)

    def test_project_files_are_left_in_place(self):
        project = os.path.join(self.work.name, "Session 128bpm Amin.cpr")
        with open(project, "wb") as fh:
            fh.write(b"cpr")
        folder, staged = daw.stage(self.track, {**self.entry, "path": project, "kind": "project"}, self.cfg)
        self.assertEqual(staged, project)
        self.assertFalse(os.path.exists(os.path.join(folder, os.path.basename(project))))

    def test_tracks_get_their_own_folders(self):
        first, _ = daw.stage(self.track, self.entry, self.cfg)
        second, _ = daw.stage({**self.track, "title": "Another Track"}, self.entry, self.cfg)
        self.assertNotEqual(first, second)


class OpenTests(DawTestCase):
    def test_open_cmd_receives_path_and_daw(self):
        ok, command, message = daw.open_file(self.arp, "cubase", self.cfg)
        self.assertTrue(ok, message)
        self.assertIn("opener.sh", command)
        self.assertEqual(self.read_log(), [f"{self.arp}|cubase"])

    def test_failing_opener_is_reported_not_raised(self):
        broken = os.path.join(self.work.name, "broken.sh")
        with open(broken, "w", encoding="utf-8") as fh:
            fh.write('#!/bin/sh\necho "no such app" >&2\nexit 3\n')
        os.chmod(broken, os.stat(broken).st_mode | stat.S_IXUSR)
        self.cfg.open_cmd = broken
        ok, _command, message = daw.open_file(self.arp, "cubase", self.cfg)
        self.assertFalse(ok)
        self.assertIn("no such app", message)

    def test_missing_opener_is_reported_not_raised(self):
        self.cfg.open_cmd = os.path.join(self.work.name, "does-not-exist.sh")
        ok, _command, message = daw.open_file(self.arp, "cubase", self.cfg)
        self.assertFalse(ok)
        self.assertTrue(message)


class LinkTests(DawTestCase):
    def test_link_stages_and_records(self):
        record, to_open = daw.link(self.track, self.entry, "cubase", self.cfg, opened=True)
        self.assertEqual(record["daw"], "cubase")
        self.assertEqual(record["track"]["title"], "Some Track")
        self.assertEqual(record["match"]["name"], "Dark Arp 128bpm Amin")
        self.assertEqual(record["match"]["score"], 0.97)
        self.assertTrue(os.path.exists(to_open))
        self.assertEqual(record["opened_path"], to_open)

    def test_project_link_opens_the_original_path(self):
        project = os.path.join(self.work.name, "Session 128bpm Amin.cpr")
        with open(project, "wb") as fh:
            fh.write(b"cpr")
        _record, to_open = daw.link(
            self.track, {**self.entry, "path": project, "kind": "project"}, "cubase", self.cfg)
        self.assertEqual(to_open, project)

    def test_links_persist_newest_first(self):
        daw.link(self.track, self.entry, "cubase", self.cfg)
        daw.link({**self.track, "title": "Second"}, self.entry, "ableton", self.cfg)
        links = daw.recent_links()
        self.assertEqual(len(links), 2)
        self.assertEqual(links[0]["track"]["title"], "Second")
        self.assertEqual(links[0]["daw"], "ableton")

    def test_recent_links_respects_the_limit(self):
        for i in range(5):
            daw.link({**self.track, "title": f"T{i}"}, self.entry, "cubase", self.cfg)
        self.assertEqual(len(daw.recent_links(limit=3)), 3)

    def test_recent_links_is_empty_before_anything_happens(self):
        self.assertEqual(daw.recent_links(), [])

    def test_corrupt_links_file_does_not_break_reading(self):
        with open(config.LINKS_PATH, "w", encoding="utf-8") as fh:
            fh.write("{broken")
        self.assertEqual(daw.recent_links(), [])
        # ...and writing recovers from it.
        daw.link(self.track, self.entry, "cubase", self.cfg)
        self.assertEqual(len(daw.recent_links()), 1)

    def test_hebrew_titles_survive_the_round_trip(self):
        daw.link({**self.track, "title": "שיר בעברית"}, self.entry, "cubase", self.cfg)
        self.assertEqual(daw.recent_links()[0]["track"]["title"], "שיר בעברית")


if __name__ == "__main__":
    unittest.main()
