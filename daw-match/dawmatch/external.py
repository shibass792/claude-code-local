"""Bridge to a matcher script you already have.

Point DAW_MATCH_SCRIPT at your script and the panel runs it alongside its own
library search, then blends the suggestions into one ranked list. Your script is
called as:

    your-script "<youtube url or file path>"

and anything it prints on stdout is accepted in whichever of these shapes is
easiest for you:

    /path/to/Dark Arp 128 Amin.mid            # one path per line
    {"matches": [{"path": "...", "bpm": 128, "key": "A minor"}]}
    [{"path": "...", "score": 0.9, "note": "from my own tagger"}]

Unparseable output is reported as a warning instead of failing the search — the
built-in library results still come back.
"""
import json
import os
import subprocess

from . import library

TIMEOUT_SECONDS = 120


class ExternalError(RuntimeError):
    pass


def run(script, user_input, timeout=TIMEOUT_SECONDS):
    """Run the script and return (entries, warning)."""
    script = os.path.expanduser(script or "")
    if not script:
        return [], ""
    if not os.path.exists(script):
        return [], f"external script not found: {script}"
    if not os.access(script, os.X_OK):
        return [], f"external script is not executable: chmod +x {script}"

    try:
        proc = subprocess.run(
            [script, user_input],
            capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return [], f"external script timed out after {timeout}s"
    except OSError as exc:
        return [], f"could not run external script: {exc}"

    if proc.returncode != 0:
        detail = (proc.stderr or "").strip().splitlines()
        return [], f"external script failed: {detail[-1] if detail else proc.returncode}"

    entries, warning = parse_output(proc.stdout)
    return entries, warning


def parse_output(text):
    """Turn script stdout into library-shaped entries."""
    text = (text or "").strip()
    if not text:
        return [], "external script printed nothing"

    records, warning = _decode(text)
    entries = []
    missing = []
    for record in records:
        path = os.path.expanduser(str(record.get("path") or "").strip())
        if not path:
            continue
        if not os.path.exists(path):
            missing.append(path)
            continue
        try:
            entry = library.describe(path, deep=True)
        except OSError as exc:
            missing.append(f"{path} ({exc})")
            continue
        # Whatever the script asserts wins over what we sniffed from the file.
        for field in ("bpm", "key", "tonic", "mode", "name"):
            if record.get(field) not in (None, ""):
                entry[field] = record[field]
        if record.get("key") and record.get("tonic") is None:
            label, tonic, mode = library.parse_key_from_name(str(record["key"]))
            if label:
                entry.update(tonic=tonic, mode=mode)
        entry["source"] = "script"
        entry["script_score"] = record.get("score")
        entry["script_note"] = record.get("note") or record.get("reason") or ""
        entries.append(entry)

    if missing:
        listed = ", ".join(os.path.basename(m) for m in missing[:3])
        extra = f" (+{len(missing) - 3} more)" if len(missing) > 3 else ""
        warning = (warning + " · " if warning else "") + f"script pointed at missing files: {listed}{extra}"

    return entries, warning


def _decode(text):
    """Accept JSON object, JSON array, or plain lines. Returns (records, warning)."""
    if text[0] in "[{":
        try:
            data = json.loads(text)
        except ValueError:
            return _decode_lines(text), "external output looked like JSON but did not parse — read it as plain paths"
        if isinstance(data, dict):
            data = data.get("matches") or data.get("results") or data.get("entries") or []
        if isinstance(data, dict):
            data = [data]
        if not isinstance(data, list):
            return [], "external JSON had no matches list"
        records = []
        for item in data:
            if isinstance(item, str):
                records.append({"path": item})
            elif isinstance(item, dict):
                records.append(item)
        return records, ""
    return _decode_lines(text), ""


def _decode_lines(text):
    records = []
    for line in text.splitlines():
        line = line.strip().strip('"').strip("'")
        if not line or line.startswith("#"):
            continue
        records.append({"path": line})
    return records
