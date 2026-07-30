#!/usr/bin/env python3
"""Tests for h_drive_ctl.py using a temporary fake H:\\ root."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

CTL = Path(__file__).with_name("h_drive_ctl.py")


def run(root: Path, *args: str, check: bool = True, input_text: str | None = None):
    env = os.environ.copy()
    env["H_DRIVE_ROOT"] = str(root)
    proc = subprocess.run(
        [sys.executable, str(CTL), *args],
        env=env,
        text=True,
        capture_output=True,
        input=input_text,
        check=False,
    )
    if check and proc.returncode != 0:
        raise AssertionError(
            f"cmd failed: {args}\nstdout={proc.stdout}\nstderr={proc.stderr}"
        )
    return proc


def test_list_write_read_rm():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        (root / "Projects").mkdir()
        (root / "Projects" / "readme.txt").write_text("hello h-drive\n", encoding="utf-8")

        listed = json.loads(run(root, "list").stdout)
        assert listed["count"] == 1
        assert listed["entries"][0]["path"] == "Projects"

        nested = json.loads(run(root, "list", "Projects").stdout)
        assert nested["entries"][0]["path"] == "Projects/readme.txt"

        out = run(root, "read", "Projects/readme.txt").stdout
        assert out == "hello h-drive\n"

        run(root, "write", "inbox/note.txt", "task one")
        assert (root / "inbox" / "note.txt").read_text(encoding="utf-8") == "task one"

        run(root, "mkdir", "work/tmp")
        assert (root / "work" / "tmp").is_dir()

        run(root, "rm", "inbox/note.txt")
        assert not (root / "inbox" / "note.txt").exists()

        run(root, "rm", "-r", "work")
        assert not (root / "work").exists()


def test_path_escape_rejected():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        proc = run(root, "read", "../outside.txt", check=False)
        assert proc.returncode != 0
        assert "escapes" in proc.stderr


def test_serve_health_and_list():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        (root / "a.txt").write_text("x", encoding="utf-8")
        env = os.environ.copy()
        env["H_DRIVE_ROOT"] = str(root)
        proc = subprocess.Popen(
            [sys.executable, str(CTL), "serve", "--host", "127.0.0.1", "--port", "18766"],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        try:
            # Wait for server
            deadline = time.time() + 5
            while time.time() < deadline:
                try:
                    with urllib.request.urlopen("http://127.0.0.1:18766/health") as resp:
                        payload = json.loads(resp.read().decode())
                        assert payload["ok"] is True
                        break
                except Exception:
                    time.sleep(0.05)
            else:
                raise AssertionError("server did not start")

            with urllib.request.urlopen("http://127.0.0.1:18766/list?path=.") as resp:
                listed = json.loads(resp.read().decode())
            assert any(e["path"] == "a.txt" for e in listed["entries"])

            req = urllib.request.Request(
                "http://127.0.0.1:18766/write",
                data=json.dumps({"path": "b.txt", "content": "hi"}).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req) as resp:
                written = json.loads(resp.read().decode())
            assert written["ok"] is True
            assert (root / "b.txt").read_text(encoding="utf-8") == "hi"
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()


def test_refuse_non_localhost_bind():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        proc = run(root, "serve", "--host", "0.0.0.0", "--port", "18767", check=False)
        assert proc.returncode != 0
        assert "non-localhost" in proc.stderr


if __name__ == "__main__":
    test_list_write_read_rm()
    test_path_escape_rejected()
    test_serve_health_and_list()
    test_refuse_non_localhost_bind()
    print("ok")
