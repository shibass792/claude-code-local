"""The adapter for a matcher script you already have."""
import json
import os
import stat
import tempfile
import unittest

import helpers
from dawmatch import external


def make_script(path, body):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(body)
    os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR)
    return path


class ParseOutputTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.arp = os.path.join(self.tmp.name, "From Script 128bpm Amin.mid")
        helpers.make_arp_midi(self.arp, bpm=128.0)

    def test_plain_path_lines(self):
        entries, warning = external.parse_output(f"{self.arp}\n")
        self.assertEqual(warning, "")
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["path"], self.arp)
        self.assertEqual(entries[0]["source"], "script")

    def test_comments_and_blank_lines_ignored(self):
        entries, _ = external.parse_output(f"# a comment\n\n{self.arp}\n")
        self.assertEqual(len(entries), 1)

    def test_quoted_paths(self):
        entries, _ = external.parse_output(f'"{self.arp}"\n')
        self.assertEqual(len(entries), 1)

    def test_json_object_with_matches(self):
        payload = json.dumps({"matches": [{"path": self.arp, "bpm": 174, "key": "D minor",
                                           "score": 0.9, "note": "my tagger"}]})
        entries, warning = external.parse_output(payload)
        self.assertEqual(warning, "")
        self.assertEqual(entries[0]["bpm"], 174)
        self.assertEqual(entries[0]["key"], "D minor")
        self.assertEqual(entries[0]["script_score"], 0.9)
        self.assertEqual(entries[0]["script_note"], "my tagger")

    def test_json_array_of_objects(self):
        entries, _ = external.parse_output(json.dumps([{"path": self.arp}]))
        self.assertEqual(len(entries), 1)

    def test_json_array_of_strings(self):
        entries, _ = external.parse_output(json.dumps([self.arp]))
        self.assertEqual(len(entries), 1)

    def test_json_results_key_also_accepted(self):
        entries, _ = external.parse_output(json.dumps({"results": [self.arp]}))
        self.assertEqual(len(entries), 1)

    def test_script_metadata_overrides_the_file(self):
        # The MIDI itself says 128 BPM / A minor; the script insists otherwise.
        entries, _ = external.parse_output(json.dumps([{"path": self.arp, "bpm": 90, "key": "E major"}]))
        self.assertEqual(entries[0]["bpm"], 90)
        self.assertEqual(entries[0]["key"], "E major")

    def test_malformed_json_falls_back_to_lines(self):
        entries, warning = external.parse_output("[not really json")
        self.assertIn("did not parse", warning)
        self.assertEqual(entries, [])

    def test_missing_files_are_warned_about(self):
        entries, warning = external.parse_output("/nope/missing-arp.mid\n")
        self.assertEqual(entries, [])
        self.assertIn("missing files", warning)
        self.assertIn("missing-arp.mid", warning)

    def test_many_missing_files_are_summarised(self):
        _entries, warning = external.parse_output("\n".join(f"/nope/{i}.mid" for i in range(6)))
        self.assertIn("+3 more", warning)

    def test_empty_output_is_warned_about(self):
        entries, warning = external.parse_output("   \n")
        self.assertEqual(entries, [])
        self.assertIn("printed nothing", warning)


class RunTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.arp = os.path.join(self.tmp.name, "Script Arp 128bpm Amin.mid")
        helpers.make_arp_midi(self.arp, bpm=128.0)

    def script(self, body, name="script.sh"):
        return make_script(os.path.join(self.tmp.name, name), body)

    def test_no_script_configured_is_a_no_op(self):
        self.assertEqual(external.run("", "anything"), ([], ""))
        self.assertEqual(external.run(None, "anything"), ([], ""))

    def test_script_receives_the_user_input(self):
        echo = os.path.join(self.tmp.name, "argv.txt")
        path = self.script(f'#!/bin/sh\nprintf "%s" "$1" > "{echo}"\nprintf "{self.arp}\\n"\n')
        entries, warning = external.run(path, "https://youtu.be/abc123")
        self.assertEqual(warning, "")
        self.assertEqual(len(entries), 1)
        with open(echo, "r", encoding="utf-8") as fh:
            self.assertEqual(fh.read(), "https://youtu.be/abc123")

    def test_json_output_from_a_real_script(self):
        payload = json.dumps({"matches": [{"path": self.arp, "note": "hand tagged"}]})
        path = self.script(f"#!/bin/sh\ncat <<'EOF'\n{payload}\nEOF\n")
        entries, warning = external.run(path, "track")
        self.assertEqual(warning, "")
        self.assertEqual(entries[0]["script_note"], "hand tagged")

    def test_missing_script_is_reported(self):
        entries, warning = external.run(os.path.join(self.tmp.name, "ghost.sh"), "x")
        self.assertEqual(entries, [])
        self.assertIn("not found", warning)

    def test_non_executable_script_is_reported(self):
        path = os.path.join(self.tmp.name, "noexec.sh")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("#!/bin/sh\necho hi\n")
        os.chmod(path, 0o644)
        entries, warning = external.run(path, "x")
        self.assertEqual(entries, [])
        self.assertIn("chmod +x", warning)

    def test_failing_script_is_reported_not_raised(self):
        path = self.script('#!/bin/sh\necho "boom" >&2\nexit 2\n')
        entries, warning = external.run(path, "x")
        self.assertEqual(entries, [])
        self.assertIn("boom", warning)

    def test_timeout_is_reported_not_raised(self):
        path = self.script("#!/bin/sh\nsleep 5\n")
        entries, warning = external.run(path, "x", timeout=1)
        self.assertEqual(entries, [])
        self.assertIn("timed out", warning)


if __name__ == "__main__":
    unittest.main()
