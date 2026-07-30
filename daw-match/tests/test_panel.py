"""End-to-end HTTP tests against a live panel instance."""
import json
import os
import stat
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import helpers
import panel
from dawmatch import config


class PanelTestCase(unittest.TestCase):
    """Boots a real panel on an ephemeral port against a temp library."""

    @classmethod
    def setUpClass(cls):
        cls.state = tempfile.TemporaryDirectory()
        cls.work = tempfile.TemporaryDirectory()

        cls._saved = (config.STATE_DIR, config.INDEX_PATH, config.LINKS_PATH, config.CACHE_DIR)
        config.STATE_DIR = cls.state.name
        config.INDEX_PATH = os.path.join(cls.state.name, "index.json")
        config.LINKS_PATH = os.path.join(cls.state.name, "links.json")
        config.CACHE_DIR = os.path.join(cls.state.name, "cache")

        cls.library = os.path.join(cls.work.name, "library")
        os.makedirs(cls.library)
        helpers.make_arp_midi(os.path.join(cls.library, "Perfect 128bpm Amin.mid"),
                              bpm=128.0, tonic=9, mode="minor")
        helpers.make_arp_midi(os.path.join(cls.library, "Halftime 64bpm Amin.mid"),
                              bpm=64.0, tonic=9, mode="minor")
        helpers.make_arp_midi(os.path.join(cls.library, "Clash 103bpm Fsmaj.mid"),
                              bpm=103.0, tonic=6, mode="major")
        cls.project = os.path.join(cls.library, "Template 128bpm Amin.cpr")
        with open(cls.project, "wb") as fh:
            fh.write(b"cubase-placeholder")

        cls.track_file = os.path.join(cls.work.name, "source-track.wav")
        helpers.write_wav_loop(cls.track_file, bpm=128.0, chord="A minor", seconds=14.0)

        cls.opened_log = os.path.join(cls.work.name, "opened.log")
        cls.opener = os.path.join(cls.work.name, "opener.sh")
        with open(cls.opener, "w", encoding="utf-8") as fh:
            fh.write(f'#!/bin/sh\nprintf "%s|%s\\n" "$1" "$2" >> "{cls.opened_log}"\n')
        os.chmod(cls.opener, os.stat(cls.opener).st_mode | stat.S_IXUSR)

        cfg = config.Config()
        cfg.library_roots = [cls.library]
        cfg.sessions_dir = os.path.join(cls.work.name, "sessions")
        cfg.open_cmd = cls.opener
        cfg.external_script = ""

        cls.service = panel.MatchService(cfg)
        cls.service.scan()

        panel.Handler.service = cls.service
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), panel.Handler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=5)
        config.STATE_DIR, config.INDEX_PATH, config.LINKS_PATH, config.CACHE_DIR = cls._saved
        cls.state.cleanup()
        cls.work.cleanup()

    # ---- helpers ----------------------------------------------------------
    def url(self, path):
        return f"http://127.0.0.1:{self.port}{path}"

    def get(self, path):
        with urllib.request.urlopen(self.url(path), timeout=60) as res:
            return res.status, res.read(), res.headers.get("Content-Type", "")

    def get_json(self, path):
        status, body, _ = self.get(path)
        return status, json.loads(body)

    def post_json(self, path, payload):
        request = urllib.request.Request(
            self.url(path),
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as res:
                return res.status, json.loads(res.read())
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read())

    def read_opened(self):
        if not os.path.exists(self.opened_log):
            return []
        with open(self.opened_log, "r", encoding="utf-8") as fh:
            return [line.strip() for line in fh if line.strip()]


class PageTests(PanelTestCase):
    def test_serves_the_panel_page(self):
        status, body, content_type = self.get("/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", content_type)
        text = body.decode("utf-8")
        self.assertIn("DAW Match", text)
        self.assertIn('dir="rtl"', text)
        self.assertIn("פתח בקיובייס", text)
        # The boot payload must be substituted, not left as a placeholder.
        self.assertNotIn("__BOOT__", text)
        self.assertIn('"library_size"', text)

    def test_health_reports_library_state(self):
        status, body = self.get_json("/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["library_size"], 4)
        self.assertEqual(body["library_roots"], [self.library])

    def test_unknown_route_is_404(self):
        try:
            self.get("/api/nope")
            self.fail("expected 404")
        except urllib.error.HTTPError as err:
            self.assertEqual(err.code, 404)


class AnalyzeTests(PanelTestCase):
    def test_analyzes_a_local_file_and_ranks_the_library(self):
        status, body = self.post_json("/api/analyze", {"input": self.track_file})
        self.assertEqual(status, 200, body)
        track = body["track"]
        self.assertAlmostEqual(track["bpm"], 128.0, delta=2.0)
        self.assertEqual(track["key"], "A minor")
        self.assertEqual(body["library_size"], 4)

        matches = body["matches"]
        self.assertTrue(matches)
        self.assertEqual(matches[0]["name"], "Perfect 128bpm Amin")
        self.assertGreater(matches[0]["score"], 0.9)
        self.assertIn("same key", matches[0]["reasons"])
        # The 103 BPM / F# major file must not beat the exact match.
        self.assertEqual(matches[-1]["name"], "Clash 103bpm Fsmaj")

    def test_half_time_arp_outranks_the_clash(self):
        _status, body = self.post_json("/api/analyze", {"input": self.track_file})
        by_name = {m["name"]: m["score"] for m in body["matches"]}
        self.assertGreater(by_name["Halftime 64bpm Amin"], by_name["Clash 103bpm Fsmaj"])

    def test_prefer_project_promotes_the_project(self):
        _status, body = self.post_json(
            "/api/analyze", {"input": self.track_file, "prefer": "project"})
        kinds = [m["kind"] for m in body["matches"]]
        self.assertEqual(kinds[0], "project")

    def test_matches_carry_ids_for_preview_and_open(self):
        _status, body = self.post_json("/api/analyze", {"input": self.track_file})
        for match in body["matches"]:
            self.assertTrue(match["id"])

    def test_empty_input_is_rejected(self):
        status, body = self.post_json("/api/analyze", {"input": "   "})
        self.assertEqual(status, 400)
        self.assertIn("paste", body["error"])

    def test_missing_file_is_a_clean_error(self):
        status, body = self.post_json("/api/analyze", {"input": "/no/such/file.wav"})
        self.assertEqual(status, 400)
        self.assertIn("no such file", body["error"])


class PreviewTests(PanelTestCase):
    def match_id(self, name):
        _status, body = self.post_json("/api/analyze", {"input": self.track_file})
        for match in body["matches"]:
            if match["name"] == name:
                return match["id"]
        self.fail(f"no match named {name}")

    def test_streams_a_wav_for_an_arp(self):
        status, body, content_type = self.get(f"/api/preview?id={self.match_id('Perfect 128bpm Amin')}")
        self.assertEqual(status, 200)
        self.assertEqual(content_type, "audio/wav")
        self.assertTrue(body.startswith(b"RIFF"))
        self.assertGreater(len(body), 40_000)

    def test_target_bpm_changes_the_rendered_length(self):
        entry_id = self.match_id("Perfect 128bpm Amin")
        _s, slow, _c = self.get(f"/api/preview?id={entry_id}&bpm=64")
        _s2, fast, _c2 = self.get(f"/api/preview?id={entry_id}&bpm=256")
        self.assertGreater(len(slow), len(fast))

    def test_preview_info_describes_the_render(self):
        entry_id = self.match_id("Perfect 128bpm Amin")
        _status, body = self.get_json(f"/api/preview-info?id={entry_id}&bpm=90")
        self.assertIn("90", body["note"])
        self.assertGreater(body["bytes"], 0)

    def test_bad_bpm_is_ignored_rather_than_fatal(self):
        entry_id = self.match_id("Perfect 128bpm Amin")
        status, body, _ = self.get(f"/api/preview?id={entry_id}&bpm=not-a-number")
        self.assertEqual(status, 200)
        self.assertTrue(body.startswith(b"RIFF"))

    def test_project_without_audio_reports_why(self):
        _status, body = self.get_json(f"/api/preview-info?id={self.match_id('Template 128bpm Amin')}")
        self.assertIn("no audio", body["error"])

    def test_unknown_id_is_404(self):
        try:
            self.get("/api/preview?id=deadbeefdeadbeef")
            self.fail("expected 404")
        except urllib.error.HTTPError as err:
            self.assertEqual(err.code, 404)


class OpenTests(PanelTestCase):
    def analyze(self):
        _status, body = self.post_json("/api/analyze", {"input": self.track_file})
        return body

    def test_opens_an_arp_in_cubase_and_records_the_pairing(self):
        match = self.analyze()["matches"][0]
        status, body = self.post_json("/api/open", {"id": match["id"], "daw": "cubase"})
        self.assertEqual(status, 200, body)
        self.assertTrue(body["opened"], body.get("message"))

        opened_path = body["opened_path"]
        self.assertTrue(os.path.exists(opened_path))
        self.assertIn(f"{opened_path}|cubase", self.read_opened())

        record = body["record"]
        self.assertEqual(record["daw"], "cubase")
        self.assertEqual(record["match"]["name"], "Perfect 128bpm Amin")
        self.assertAlmostEqual(record["track"]["bpm"], 128.0, delta=2.0)

        # The staged folder holds the arp plus the paperwork.
        session = record["session_dir"]
        self.assertTrue(os.path.exists(os.path.join(session, "session.json")))
        self.assertTrue(os.path.exists(os.path.join(session, "README.txt")))
        self.assertTrue(os.path.exists(os.path.join(session, "Perfect 128bpm Amin.mid")))

    def test_opens_a_project_in_place(self):
        project = next(m for m in self.analyze()["matches"] if m["kind"] == "project")
        _status, body = self.post_json("/api/open", {"id": project["id"], "daw": "cubase"})
        self.assertEqual(body["opened_path"], self.project)

    def test_ableton_button_uses_the_ableton_id(self):
        match = self.analyze()["matches"][0]
        _status, body = self.post_json("/api/open", {"id": match["id"], "daw": "ableton"})
        self.assertTrue(body["opened"])
        self.assertTrue(any(line.endswith("|ableton") for line in self.read_opened()))

    def test_links_endpoint_lists_the_pairings(self):
        match = self.analyze()["matches"][0]
        self.post_json("/api/open", {"id": match["id"], "daw": "cubase"})
        _status, body = self.get_json("/api/links")
        self.assertTrue(body["links"])
        newest = body["links"][0]
        self.assertEqual(newest["match"]["name"], "Perfect 128bpm Amin")
        self.assertIn("session_dir", newest)

    def test_unknown_id_is_404(self):
        status, body = self.post_json("/api/open", {"id": "nope", "daw": "cubase"})
        self.assertEqual(status, 404)
        self.assertIn("unknown match", body["error"])


class ReindexTests(PanelTestCase):
    def test_reindex_picks_up_a_new_file(self):
        added = os.path.join(self.library, "Added 128bpm Amin.mid")
        helpers.make_arp_midi(added, bpm=128.0)
        self.addCleanup(lambda: os.path.exists(added) and os.remove(added))
        status, body = self.post_json("/api/reindex", {})
        self.assertEqual(status, 200)
        self.assertGreaterEqual(body["library_size"], 5)
        self.assertIn("scanned", body["stats"])


class ExternalScriptTests(PanelTestCase):
    def test_script_results_are_merged_and_tagged(self):
        extra_dir = os.path.join(self.work.name, "outside-the-library")
        os.makedirs(extra_dir, exist_ok=True)
        outside = os.path.join(extra_dir, "From My Script 128bpm Amin.mid")
        helpers.make_arp_midi(outside, bpm=128.0, tonic=9, mode="minor")

        script = os.path.join(self.work.name, "my-matcher.sh")
        with open(script, "w", encoding="utf-8") as fh:
            fh.write(f'#!/bin/sh\nprintf "{outside}\\n"\n')
        os.chmod(script, os.stat(script).st_mode | stat.S_IXUSR)

        previous = self.service.config.external_script
        self.service.config.external_script = script
        self.addCleanup(setattr, self.service.config, "external_script", previous)

        _status, body = self.post_json("/api/analyze", {"input": self.track_file})
        from_script = [m for m in body["matches"] if m["source"] == "script"]
        self.assertEqual(len(from_script), 1)
        self.assertEqual(from_script[0]["name"], "From My Script 128bpm Amin")
        # It competes on the same ranking as the built-in library.
        self.assertGreater(from_script[0]["score"], 0.9)
        self.assertEqual(body["library_size"], 5)

    def test_broken_script_warns_but_still_returns_library_matches(self):
        script = os.path.join(self.work.name, "broken-matcher.sh")
        with open(script, "w", encoding="utf-8") as fh:
            fh.write('#!/bin/sh\necho "kaboom" >&2\nexit 1\n')
        os.chmod(script, os.stat(script).st_mode | stat.S_IXUSR)

        previous = self.service.config.external_script
        self.service.config.external_script = script
        self.addCleanup(setattr, self.service.config, "external_script", previous)

        status, body = self.post_json("/api/analyze", {"input": self.track_file})
        self.assertEqual(status, 200)
        self.assertTrue(body["matches"])
        self.assertTrue(any("kaboom" in w for w in body["warnings"]))


if __name__ == "__main__":
    unittest.main()
