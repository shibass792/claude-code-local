"""Light tests for demucs_wav_hook path logic (no demucs run)."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import demucs_wav_hook as hook  # noqa: E402


class DemucsHookTests(unittest.TestCase):
    def test_missing_file_returns_1(self) -> None:
        with patch.object(sys, "argv", ["demucs_wav_hook.py", r"C:\no\such\file.wav"]):
            self.assertEqual(hook.main(), 1)

    def test_missing_venv_returns_1(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(b"RIFF")
            wav = tmp.name
        try:
            env = {
                "SHIBASS_ROOT": tempfile.gettempdir(),
                "SHIBASS_DEMUCS_VENV": str(Path(tempfile.gettempdir()) / "no-venv-here"),
            }
            with patch.dict(os.environ, env, clear=False):
                with patch.object(sys, "argv", ["demucs_wav_hook.py", wav]):
                    self.assertEqual(hook.main(), 1)
        finally:
            os.unlink(wav)

    def test_usage_returns_2(self) -> None:
        with patch.object(sys, "argv", ["demucs_wav_hook.py"]):
            self.assertEqual(hook.main(), 2)


if __name__ == "__main__":
    unittest.main()
