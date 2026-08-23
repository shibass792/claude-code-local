"""Audio Worker — the audio stage of the SHIBASS pipeline.

Watches the shared inbox for audio files and runs, per file:

    1. Demucs (htdemucs, CUDA) ............ 4 stems -> 10_OUTPUTS/MIDIFORGE/<name>_STEMS
    2. Basic Pitch (CPU venv, optional) ... bass/other/vocals stems -> .mid
    3. MIDI Forge (HTTP, port 8788) ....... best transcription -> full Cubase package

Runs in .venv-music-pilot-gpu (torch+cu128 + demucs). Transcription is delegated
to .venv-audio via subprocess (it has basic_pitch); if absent, step 2-3 are skipped
and you still get stems. MIDI files in the inbox are ignored — daw_bridge owns those.

Usage:
    python audio_worker.py --watch H:\\shibass-ai\\10_OUTPUTS\\MIDI_EXPORT
    python audio_worker.py --once <file-or-folder>          # process and exit
    python audio_worker.py --once <file> --no-transcribe    # stems only
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

# --- fixed machine layout -------------------------------------------------
GPU_PY = Path(r"H:\shibass-ai\.venv-music-pilot-gpu\Scripts\python.exe")
BP_VENV = Path(r"H:\shibass-ai\.venv-audio")           # has basic_pitch (CPU)
OUT_ROOT = Path(r"H:\shibass-ai\10_OUTPUTS\MIDIFORGE")
FORGE_URL = "http://127.0.0.1:8788"
SEGMENT = 7            # htdemucs transformer hard limit is 7.8s
AUDIO_EXTS = {".wav", ".mp3", ".flac", ".m4a", ".aiff", ".aif", ".ogg"}
TRANSCRIBE_STEMS = ("bass", "other", "vocals")   # drums are not melodic

# Child processes print Unicode (basic_pitch's banner has music glyphs); force
# UTF-8 so a cp1255/cp437 console pipe doesn't kill them with UnicodeEncodeError.
CHILD_ENV = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}


def log(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def run_demucs(audio: Path, out_dir: Path) -> dict[str, Path]:
    """Separate one file into stems. Tries CUDA, falls back to CPU."""
    for device in ("cuda", "cpu"):
        cmd = [str(GPU_PY), "-m", "demucs", "-d", device, "-n", "htdemucs",
               "--segment", str(SEGMENT), "-o", str(out_dir), str(audio)]
        log(f"demucs [{device}] {audio.name} ...")
        t0 = time.time()
        p = subprocess.run(cmd, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", env=CHILD_ENV)
        if p.returncode == 0:
            log(f"demucs done in {time.time() - t0:.0f}s")
            stem_dir = out_dir / "htdemucs" / audio.stem
            return {f.stem: f for f in stem_dir.glob("*.wav")}
        log(f"demucs [{device}] failed: {p.stderr.strip().splitlines()[-1] if p.stderr else p.returncode}")
    return {}


def find_basic_pitch() -> list[str] | None:
    """Command prefix for basic_pitch in the CPU audio venv, or None."""
    exe = BP_VENV / "Scripts" / "basic-pitch.exe"
    if exe.is_file():
        return [str(exe)]
    py = BP_VENV / "Scripts" / "python.exe"
    if py.is_file() and (BP_VENV / "Lib" / "site-packages" / "basic_pitch").is_dir():
        return [str(py), "-m", "basic_pitch"]
    return None


def transcribe(stems: dict[str, Path], out_dir: Path) -> dict[str, Path]:
    """Basic Pitch on melodic stems -> {stem_name: midi_path}."""
    bp = find_basic_pitch()
    if not bp:
        log("basic_pitch not found in .venv-audio — skipping transcription")
        return {}
    midis: dict[str, Path] = {}
    for name in TRANSCRIBE_STEMS:
        wav = stems.get(name)
        if not wav:
            continue
        log(f"basic_pitch {name}.wav ...")
        p = subprocess.run(bp + [str(out_dir), str(wav), "--save-midi"],
                           capture_output=True, text=True,
                           encoding="utf-8", errors="replace", env=CHILD_ENV)
        produced = out_dir / f"{wav.stem}_basic_pitch.mid"
        if p.returncode == 0 and produced.is_file():
            target = out_dir / f"{name}.mid"
            shutil.move(str(produced), target)
            midis[name] = target
            log(f"  -> {target.name}")
        else:
            tail = (p.stderr or p.stdout or "").strip().splitlines()
            log(f"  {name} failed: {tail[-1] if tail else p.returncode}")
    return midis


def note_count(midi: Path) -> int:
    """Cheap SMF note-on count (stdlib, close enough for ranking)."""
    try:
        data = midi.read_bytes()
        return sum(1 for i in range(len(data) - 2)
                   if data[i] & 0xF0 == 0x90 and data[i + 2] > 0)
    except OSError:
        return 0


def forge(midi: Path, project: str) -> str | None:
    """POST the transcription to MIDI Forge -> full Cubase package."""
    body = json.dumps({
        "path": str(midi),
        "transforms": ["lead", "pad", "arp", "counter", "bass"],
        "template": "club", "project_name": project,
    }).encode()
    req = urllib.request.Request(f"{FORGE_URL}/api/midi/export", body,
                                 {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            res = json.loads(r.read())
            out = res.get("project_dir") or res.get("out_dir")
            log(f"forge -> {out} ({res.get('file_count', '?')} files, "
                f"{res.get('key', '?')} @ {res.get('bpm', '?')} BPM)")
            return out
    except Exception as e:  # server down is not fatal — stems still delivered
        log(f"forge skipped: {e}")
        return None


def process(audio: Path, transcribe_enabled: bool = True) -> None:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    work = OUT_ROOT / f"{audio.stem}_{stamp}_STEMS"
    work.mkdir(parents=True, exist_ok=True)

    stems = run_demucs(audio, work)
    if not stems:
        log(f"no stems produced for {audio.name}")
        return
    # flatten demucs' nested output into the work folder
    for name, path in list(stems.items()):
        flat = work / f"{name}.wav"
        if path != flat:
            shutil.move(str(path), flat)
            stems[name] = flat
    shutil.rmtree(work / "htdemucs", ignore_errors=True)

    midis = transcribe(stems, work) if transcribe_enabled else {}
    if midis:
        best = max(midis.values(), key=note_count)
        forge(best, f"{audio.stem}_from_audio")

    (work / "DONE.json").write_text(json.dumps({
        "source": str(audio), "stems": {k: str(v) for k, v in stems.items()},
        "midi": {k: str(v) for k, v in midis.items()}, "finished": stamp,
    }, indent=2), encoding="utf-8")
    log(f"complete -> {work}")


def stable(f: Path, wait: float = 2.0) -> bool:
    """True once the file stopped growing (export finished)."""
    try:
        a = f.stat().st_size
        time.sleep(wait)
        return f.stat().st_size == a and a > 0
    except OSError:
        return False


def watch(folder: Path, poll: float, transcribe_enabled: bool) -> None:
    # single-instance guard — two watchers would race on new files
    import socket
    _mutex = socket.socket()
    try:
        _mutex.bind(("127.0.0.1", 8848))
    except OSError:
        log("another audio watcher is already running — exiting")
        return
    log(f"audio worker watching {folder} (poll {poll}s, GPU demucs, segment {SEGMENT})")
    seen: set[str] = set()
    marker = folder / ".audio_processed.json"
    if marker.is_file():
        seen = set(json.loads(marker.read_text(encoding="utf-8")))
    while True:
        for f in sorted(folder.iterdir()):
            if f.suffix.lower() not in AUDIO_EXTS or str(f) in seen:
                continue
            if not stable(f):
                continue
            try:
                process(f, transcribe_enabled)
            except Exception as e:
                log(f"ERROR on {f.name}: {e}")
            seen.add(str(f))
            marker.write_text(json.dumps(sorted(seen)), encoding="utf-8")
        time.sleep(poll)


def main() -> int:
    ap = argparse.ArgumentParser(description="SHIBASS audio worker (Demucs + Basic Pitch + Forge)")
    ap.add_argument("--watch", help="folder to watch")
    ap.add_argument("--once", help="process one file/folder and exit")
    ap.add_argument("--poll", type=float, default=3.0)
    ap.add_argument("--no-transcribe", action="store_true")
    a = ap.parse_args()
    if a.once:
        p = Path(a.once)
        files = [p] if p.is_file() else [f for f in p.iterdir() if f.suffix.lower() in AUDIO_EXTS]
        for f in files:
            process(f, not a.no_transcribe)
        return 0
    if a.watch:
        watch(Path(a.watch), a.poll, not a.no_transcribe)
        return 0
    ap.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
