"""DAW Watcher Agent — Cubase -> MIDI Forge bridge (pure stdlib).

Watches folders Cubase exports into. When a new/updated .mid appears it waits
for the file to finish writing, then calls the Music Brain server on port 8788:

    analyze          -> prints key / BPM / roles to the console
    analyze+export   -> also generates the full layer set into
                        H:\\shibass-ai\\10_OUTPUTS\\MIDIFORGE\\<name>_<stamp>\\

Design notes
------------
* Polling, not filesystem events: zero dependencies (no `watchdog`), and
  polling is immune to the missed-event races Windows FS notification has
  with DAWs that write via temp-file-then-rename.
* Write-settle check: a file is only processed once its size is stable for
  two consecutive polls AND it parses as SMF (MThd magic) — Cubase writes
  the header first, so a half-written file fails fast and is retried.
* .wav files are logged and skipped for now: the audio pipeline
  (Demucs separation / transcription) lives in a different venv
  (H:\\shibass-ai\\.venv-demucs) and is a separate stage.

Usage
-----
    python daw_bridge.py --watch "D:\\all projects\\MIDI Export" --mode export
    python daw_bridge.py --watch <dir1> --watch <dir2> --mode analyze
    python daw_bridge.py --once <file.mid> --mode export      # single shot

Run it from any directory EXCEPT C:\\Users\\shibass (a stray music_brain.py
there shadows the package).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "http://127.0.0.1:8791"
POLL_SEC = 2.0
SETTLE_POLLS = 2  # size must be unchanged this many polls before processing


def _get(path: str, timeout: float = 120.0) -> dict:
    with urllib.request.urlopen(API + path, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _post(path: str, body: dict, timeout: float = 300.0) -> dict:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        API + path, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def is_valid_smf(p: Path) -> bool:
    try:
        with p.open("rb") as f:
            return f.read(4) == b"MThd"
    except OSError:
        return False


def process(p: Path, mode: str, export_opts: dict) -> None:
    print(f"[*] {p.name}: analyzing...")
    try:
        q = urllib.parse.quote(str(p))
        a = _get(f"/api/midi/analyze?path={q}")
        an = a.get("analysis", {})
        print(
            f"[+] {p.name}: {an.get('key')} @ {an.get('bpm')} BPM · "
            f"{an.get('bars')} bars · source={a.get('suggested_source_track')}"
        )
        for t in an.get("tracks", []):
            print(f"      {t['name'][:24]:<24} {t['role']:<8} {t['note_count']} notes")
    except Exception as e:  # noqa: BLE001
        print(f"[-] {p.name}: analyze failed: {e}")
        return

    if mode != "export":
        return

    print(f"[*] {p.name}: generating layers + Cubase export...")
    try:
        body = {"path": str(p), **export_opts}
        r = _post("/api/midi/export", body)
        print(f"[+] {p.name}: {r.get('file_count')} files -> {r.get('project_dir')}")
        print(f"      guide: {r.get('guide')}")
    except Exception as e:  # noqa: BLE001
        print(f"[-] {p.name}: export failed: {e}")


def watch(dirs: list[Path], mode: str, export_opts: dict) -> None:
    print(f"[*] DAW Watcher active · server {API} · mode={mode}")
    for d in dirs:
        print(f"    watching {d}")
    # Baseline: whatever already exists is considered handled
    seen: dict[str, tuple[int, int]] = {}  # path -> (size, settle_count)
    done: set[str] = set()
    for d in dirs:
        for p in d.glob("*.mid"):
            done.add(str(p))
        for p in d.glob("*.midi"):
            done.add(str(p))

    try:
        while True:
            for d in dirs:
                if not d.exists():
                    continue
                for p in list(d.glob("*.mid")) + list(d.glob("*.midi")):
                    key = str(p)
                    if key in done:
                        continue
                    try:
                        size = p.stat().st_size
                    except OSError:
                        continue
                    prev = seen.get(key)
                    if prev and prev[0] == size:
                        settles = prev[1] + 1
                    else:
                        settles = 0
                    seen[key] = (size, settles)
                    if settles >= SETTLE_POLLS and size > 14 and is_valid_smf(p):
                        done.add(key)
                        seen.pop(key, None)
                        process(p, mode, export_opts)
                # log-and-skip audio for the (separate) Demucs stage
                for p in d.glob("*.wav"):
                    key = "wav:" + str(p)
                    if key not in done:
                        done.add(key)
                        print(f"[i] {p.name}: WAV detected — audio stage not wired yet (Demucs venv), skipping.")
            time.sleep(POLL_SEC)
    except KeyboardInterrupt:
        print("\n[*] DAW Watcher stopped.")


def main() -> int:
    ap = argparse.ArgumentParser(description="Cubase -> MIDI Forge bridge")
    ap.add_argument("--watch", action="append", default=[], help="Folder to watch (repeatable)")
    ap.add_argument("--once", help="Process a single .mid file and exit")
    ap.add_argument("--mode", choices=["analyze", "export"], default="analyze")
    ap.add_argument("--template", default="club", choices=["club", "short"])
    ap.add_argument("--complexity", type=float, default=0.6)
    ap.add_argument("--mutation", type=float, default=0.35)
    ap.add_argument("--bars", type=int, default=0, help="0 = use source length")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    export_opts = {
        "template": args.template,
        "complexity": args.complexity,
        "mutation_rate": args.mutation,
        "seed": args.seed,
    }
    if args.bars > 0:
        export_opts["bars"] = args.bars

    # Server reachable?
    try:
        s = _get("/api/midi/status", timeout=15)
        print(f"[*] Connected: {s.get('engine')} v{s.get('version')} ({s.get('backend')})")
    except Exception as e:  # noqa: BLE001
        print(f"[-] Music Brain not reachable on {API}: {e}")
        return 2

    if args.once:
        p = Path(args.once)
        if not p.is_file():
            print(f"[-] no such file: {p}")
            return 2
        process(p, args.mode, export_opts)
        return 0

    dirs = [Path(w) for w in args.watch]
    dirs = [d for d in dirs if d.exists()]
    if not dirs:
        print("[-] no existing --watch folders given")
        return 2
    watch(dirs, args.mode, export_opts)
    return 0


if __name__ == "__main__":
    sys.exit(main())
