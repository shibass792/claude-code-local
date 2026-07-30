"""Hand a match over to Cubase or Ableton and remember the pairing.

"Open in Cubase" does three things, in this order:

  1. stages a session folder for the track and copies the matched arp into it,
     so the file the DAW opens sits next to the material it was matched to
  2. writes the pairing into ~/.daw-match/links.json — that is the "these two
     belong together" record the panel shows on later visits
  3. launches the DAW

If step 3 fails (no DAW on this machine, wrong app name) steps 1 and 2 still
stand, so the staged folder and the link survive and can be opened by hand.
"""
import json
import os
import platform
import re
import shutil
import subprocess
import time

from . import config

_SLUG_RE = re.compile(r"[^A-Za-z0-9\u0590-\u05FF]+")


def slugify(text, fallback="track"):
    slug = _SLUG_RE.sub("-", (text or "").strip()).strip("-")
    return (slug[:60] or fallback)


def session_dir(track, cfg):
    """Folder for one track's matches: <sessions>/<slug>/"""
    name = slugify(track.get("title") or track.get("source") or "track")
    path = os.path.join(cfg.sessions_dir, name)
    os.makedirs(path, exist_ok=True)
    return path


def stage(track, entry, cfg):
    """Copy the matched file into the track's session folder.

    Project files are opened in place — copying a .cpr or .als would detach it
    from its audio pool. Arps and loops are copied, because that is the file you
    are about to drag onto a track.
    """
    folder = session_dir(track, cfg)
    source = entry["path"]
    staged = source

    if entry.get("kind") in ("arp", "loop") and os.path.exists(source):
        target = os.path.join(folder, os.path.basename(source))
        if os.path.abspath(target) != os.path.abspath(source):
            try:
                shutil.copy2(source, target)
                staged = target
            except OSError:
                staged = source

    manifest = os.path.join(folder, "session.json")
    payload = _read_json(manifest, default={"track": {}, "matches": []})
    payload["track"] = {
        "title": track.get("title"),
        "source": track.get("source"),
        "bpm": track.get("bpm"),
        "key": track.get("key"),
        "duration": track.get("duration"),
    }
    payload["matches"] = [m for m in payload.get("matches", []) if m.get("original") != source]
    payload["matches"].append({
        "original": source,
        "staged": staged,
        "kind": entry.get("kind"),
        "bpm": entry.get("bpm"),
        "key": entry.get("key"),
        "score": entry.get("score"),
        "reasons": entry.get("reasons", []),
        "added_at": time.time(),
    })
    _write_json(manifest, payload)
    _write_readme(folder, payload)
    return folder, staged


def _write_readme(folder, payload):
    track = payload.get("track", {})
    lines = [
        "DAW Match session",
        "=================",
        f"Track:  {track.get('title') or 'unknown'}",
        f"Source: {track.get('source') or 'unknown'}",
        f"Tempo:  {track.get('bpm') or '?'} BPM",
        f"Key:    {track.get('key') or '?'}",
        "",
        "Matches staged in this folder:",
    ]
    for match in payload.get("matches", []):
        score = match.get("score")
        score_text = f"{score * 100:.0f}%" if isinstance(score, (int, float)) else "n/a"
        lines.append(
            f"  · {os.path.basename(match.get('staged') or '')} "
            f"[{match.get('kind')}] {match.get('bpm') or '?'} BPM "
            f"{match.get('key') or '?'} — match {score_text}"
        )
        if match.get("reasons"):
            lines.append(f"      why: {', '.join(match['reasons'])}")
    lines.append("")
    lines.append("Set your project tempo to the track tempo above before dragging these in.")
    with open(os.path.join(folder, "README.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def open_file(path, daw, cfg):
    """Launch the DAW. Returns (ok, command_string, message)."""
    if cfg.open_cmd:
        cmd = [cfg.open_cmd, path, daw]
    elif platform.system() == "Darwin":
        app = cfg.daw_apps.get(daw)
        cmd = ["open", "-a", app, path] if app else ["open", path]
    else:
        opener = shutil.which("xdg-open")
        if not opener:
            return False, "", (
                f"no launcher for {daw} on {platform.system()} — "
                "set DAW_MATCH_OPEN_CMD to a script that opens files"
            )
        cmd = [opener, path]

    printable = " ".join(cmd)
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError) as exc:
        return False, printable, str(exc)

    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip().splitlines()
        message = detail[-1] if detail else f"exit code {proc.returncode}"
        return False, printable, message
    return True, printable, "opened"


def prepare(track, entry, cfg):
    """Stage the files and work out what the DAW should actually open.

    Runs before the launch so a failed launch still leaves a usable folder.
    """
    folder, staged = stage(track, entry, cfg)
    # A project opens in place; an arp opens from the session folder.
    to_open = entry["path"] if entry.get("kind") == "project" else staged
    return folder, staged, to_open


def record_link(track, entry, daw, folder, staged, to_open, opened, message=""):
    """Persist the track <-> match pairing.

    Called *after* the launch attempt so `opened` reflects what really happened
    rather than an optimistic guess.
    """
    record = {
        "id": f"{int(time.time() * 1000)}",
        "created_at": time.time(),
        "daw": daw,
        "opened": bool(opened),
        "message": message,
        "session_dir": folder,
        "opened_path": to_open,
        "track": {
            "title": track.get("title"),
            "source": track.get("source"),
            "bpm": track.get("bpm"),
            "key": track.get("key"),
        },
        "match": {
            "name": entry.get("name"),
            "path": entry["path"],
            "staged": staged,
            "kind": entry.get("kind"),
            "bpm": entry.get("bpm"),
            "key": entry.get("key"),
            "score": entry.get("score"),
            "reasons": entry.get("reasons", []),
        },
    }
    _append_link(record)
    return record


def link(track, entry, daw, cfg, opened=True, message=""):
    """Stage, then record, in one call. Convenience for the CLI and tests."""
    folder, staged, to_open = prepare(track, entry, cfg)
    record = record_link(track, entry, daw, folder, staged, to_open, opened, message)
    return record, to_open


def _append_link(record):
    config.ensure_state_dirs()
    payload = _read_json(config.LINKS_PATH, default={"links": []})
    links = payload.get("links", [])
    links.insert(0, record)
    payload["links"] = links[:200]
    _write_json(config.LINKS_PATH, payload)


def recent_links(limit=25):
    payload = _read_json(config.LINKS_PATH, default={"links": []})
    return payload.get("links", [])[:limit]


def _read_json(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            loaded = json.load(fh)
        return loaded if isinstance(loaded, dict) else (default or {})
    except (OSError, ValueError):
        return default if default is not None else {}


def _write_json(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1, ensure_ascii=False)
    os.replace(tmp, path)
