#!/usr/bin/env python3
"""Run Demucs on one WAV/MP3 (called from MIDI Forge DAW watcher or PowerShell).

Usage:
  python tools/demucs_wav_hook.py "H:\\shibass-ai\\10_OUTPUTS\\MIDI_EXPORT\\test30.wav"

Env (optional):
  SHIBASS_ROOT          default H:\\shibass-ai
  SHIBASS_DEMUCS_VENV   default {root}\\.venv-demucs
  SHIBASS_STEMS_OUTPUT  default {root}\\10_OUTPUTS\\stems
  SHIBASS_DEMUCS_MODEL  default htdemucs
  SHIBASS_DEMUCS_DEVICE default cuda (falls back to cpu)
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: demucs_wav_hook.py <audio-file>", file=sys.stderr)
        return 2

    audio = Path(sys.argv[1]).resolve()
    if not audio.is_file():
        print(f"file not found: {audio}", file=sys.stderr)
        return 1

    root = Path(os.environ.get("SHIBASS_ROOT", r"H:\shibass-ai"))
    venv = Path(os.environ.get("SHIBASS_DEMUCS_VENV", root / ".venv-demucs"))
    out_dir = Path(os.environ.get("SHIBASS_STEMS_OUTPUT", root / r"10_OUTPUTS\stems"))
    model = os.environ.get("SHIBASS_DEMUCS_MODEL", "htdemucs")
    device = os.environ.get("SHIBASS_DEMUCS_DEVICE", "cuda")

    if sys.platform == "win32":
        py = venv / "Scripts" / "python.exe"
    else:
        py = venv / "bin" / "python"

    if not py.is_file():
        print(f"Demucs venv missing: {py}", file=sys.stderr)
        print("Run: scripts\\wire-demucs-for-midi-forge.ps1", file=sys.stderr)
        return 1

    out_dir.mkdir(parents=True, exist_ok=True)
    job_dir = out_dir / audio.stem
    job_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        str(py),
        "-m",
        "demucs",
        "--out",
        str(job_dir),
        "-n",
        model,
        "-d",
        device,
        str(audio),
    ]

    print(f"[demucs] {' '.join(cmd)}")
    try:
        proc = subprocess.run(cmd, check=False)
    except FileNotFoundError:
        print("demucs module not installed in venv", file=sys.stderr)
        return 1

    if proc.returncode != 0 and device == "cuda":
        print("[demucs] cuda failed, retrying on cpu...", file=sys.stderr)
        cmd[-2] = "cpu"
        proc = subprocess.run(cmd, check=False)

    if proc.returncode != 0:
        print(f"[demucs] failed exit {proc.returncode}", file=sys.stderr)
        return proc.returncode

    print(f"[demucs] ok -> {job_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
