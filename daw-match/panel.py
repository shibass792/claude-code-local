#!/usr/bin/env python3
"""DAW Match — auto-match panel for Cubase and Ableton.

Paste a YouTube link or an audio file, and the panel analyses its tempo and key,
ranks the arps / loops / projects in your library against it, lets you audition
the winner in the browser, and hands it to Cubase or Ableton with one click —
recording the track-to-arp pairing as it goes.

    python3 panel.py                      # serve the panel on :4020
    python3 panel.py --match <url|file>   # same search, printed in the terminal
    python3 panel.py --scan               # (re)index the library and exit

Everything runs locally. The only network call is yt-dlp fetching a link you
pasted yourself.
"""
import argparse
import json
import os
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dawmatch import analysis, audioio, config, daw, external, library, matcher, preview, starter, ui


class MatchService:
    """Holds the library index and the most recent analysis."""

    def __init__(self, cfg=None):
        self.config = cfg or config.Config()
        self.lock = threading.Lock()
        self.registry = {}      # entry id -> library entry
        self.entries = []
        self.track = None
        self.load_index()

    # ---- library ----------------------------------------------------------
    def load_index(self):
        self.entries = library.load_index()
        self._register(self.entries)
        return self.entries

    def scan(self):
        entries, stats = library.scan(self.config.library_roots)
        self.entries = entries
        self._register(entries)
        return stats

    def ensure_index(self):
        """Scan on first use so a fresh install does not come back empty."""
        if not self.entries:
            self.scan()
        return self.entries

    def _register(self, entries):
        for entry in entries:
            entry_id = library.entry_id(entry["path"])
            entry["id"] = entry_id
            self.registry[entry_id] = entry

    def get(self, entry_id):
        return self.registry.get(entry_id)

    # ---- search -----------------------------------------------------------
    def analyze(self, user_input, prefer=None, limit=25):
        """Analyse the input and rank the library against it."""
        warnings = []
        path, title, kind = audioio.resolve_input(user_input)
        samples = audioio.decode(path)
        track = analysis.analyze(samples)
        track.update({
            "title": title,
            "source": user_input.strip(),
            "local_path": path,
            "input_kind": kind,
            "summary": matcher.describe_track(track),
        })

        candidates = list(self.ensure_index())

        if self.config.external_script:
            found, warning = external.run(self.config.external_script, user_input.strip())
            if warning:
                warnings.append(warning)
            if found:
                self._register(found)
                known = {entry["path"] for entry in candidates}
                candidates.extend(e for e in found if e["path"] not in known)

        if not candidates:
            warnings.append(
                "the library is empty — add .mid arps, loops or projects under "
                + ", ".join(self.config.library_roots)
            )

        matches = matcher.rank(track, candidates, prefer=prefer or None, limit=limit)
        for match in matches:
            match["id"] = library.entry_id(match["path"])
            self.registry.setdefault(match["id"], match)

        with self.lock:
            self.track = track
        return {
            "track": track,
            "matches": [_public_match(m) for m in matches],
            "warnings": warnings,
            "library_size": len(candidates),
        }

    def state(self):
        return {
            "library_size": len(self.entries),
            "library_roots": self.config.library_roots,
            "external_script": self.config.external_script,
            "sessions_dir": self.config.sessions_dir,
            "daw_apps": self.config.daw_apps,
        }


def _public_match(entry):
    """Trim a library entry down to what the UI needs."""
    fields = (
        "id", "name", "kind", "bpm", "key", "duration", "notes", "score",
        "tempo_score", "key_score", "timbre_score", "reasons", "source",
        "daw", "warning", "script_note", "path",
    )
    return {field: entry.get(field) for field in fields}


class Handler(BaseHTTPRequestHandler):
    server_version = "DAWMatch/1.0"
    service = None

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))

    # ---- plumbing ---------------------------------------------------------
    def _send(self, status, body, content_type="application/json; charset=utf-8"):
        payload = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _error(self, status, message):
        self._send(status, {"error": message})

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8")) or {}
        except (ValueError, UnicodeDecodeError):
            return {}

    # ---- routes -----------------------------------------------------------
    def do_GET(self):
        route = urlparse(self.path)
        query = parse_qs(route.query)
        try:
            if route.path == "/":
                boot = json.dumps(self.service.state(), ensure_ascii=False)
                return self._send(200, ui.render_page(boot).encode("utf-8"), "text/html; charset=utf-8")
            if route.path == "/api/health":
                return self._send(200, {"status": "ok", **self.service.state()})
            if route.path == "/api/state":
                return self._send(200, self.service.state())
            if route.path == "/api/links":
                return self._send(200, {"links": daw.recent_links()})
            if route.path == "/api/preview":
                return self._preview(query, info_only=False)
            if route.path == "/api/preview-info":
                return self._preview(query, info_only=True)
            return self._error(404, f"no route for {route.path}")
        except Exception as exc:  # keep the panel alive on any unexpected failure
            self.log_message("GET %s failed: %s", route.path, exc)
            return self._error(500, str(exc))

    def do_POST(self):
        route = urlparse(self.path)
        try:
            if route.path == "/api/analyze":
                return self._analyze()
            if route.path == "/api/open":
                return self._open()
            if route.path == "/api/reindex":
                stats = self.service.scan()
                return self._send(200, {"stats": stats, **self.service.state()})
            return self._error(404, f"no route for {route.path}")
        except Exception as exc:
            self.log_message("POST %s failed: %s", route.path, exc)
            return self._error(500, str(exc))

    def _analyze(self):
        body = self._body()
        user_input = (body.get("input") or "").strip()
        if not user_input:
            return self._error(400, "paste a YouTube link or an audio file path")
        try:
            result = self.service.analyze(user_input, prefer=body.get("prefer"))
        except audioio.IngestError as exc:
            return self._error(400, str(exc))
        return self._send(200, result)

    def _preview(self, query, info_only):
        entry_id = (query.get("id") or [""])[0]
        entry = self.service.get(entry_id)
        if not entry:
            return self._error(404, "unknown match — run the search again")
        target_bpm = None
        raw_bpm = (query.get("bpm") or [""])[0]
        if raw_bpm:
            try:
                target_bpm = float(raw_bpm)
            except ValueError:
                target_bpm = None
        try:
            wav, note = preview.build(entry, target_bpm=target_bpm)
        except (preview.PreviewError, audioio.IngestError) as exc:
            if info_only:
                return self._send(200, {"note": "", "error": str(exc)})
            return self._error(400, str(exc))
        if info_only:
            return self._send(200, {"note": note, "bytes": len(wav)})
        return self._send(200, wav, "audio/wav")

    def _open(self):
        body = self._body()
        entry = self.service.get((body.get("id") or "").strip())
        if not entry:
            return self._error(404, "unknown match — run the search again")
        daw_id = (body.get("daw") or "cubase").strip().lower()
        track = body.get("track") or self.service.track
        if not track:
            return self._error(400, "analyze a track first")

        cfg = self.service.config
        record, to_open = daw.link(track, entry, daw_id, cfg, opened=False)
        ok, command, message = daw.open_file(to_open, daw_id, cfg)
        record["opened"] = ok
        record["command"] = command
        record["message"] = message
        return self._send(200, {
            "opened": ok,
            "opened_path": to_open,
            "command": command,
            "message": message,
            "record": record,
        })


def serve(service, port=None, open_browser=True):
    port = port or service.config.port
    Handler.service = service
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}"
    print()
    print("  🎹 DAW Match — auto-match panel")
    print(f"  → {url}")
    print(f"  → library: {len(service.entries)} files across {len(service.config.library_roots)} roots")
    if service.config.external_script:
        print(f"  → external script: {service.config.external_script}")
    print("  → Ctrl-C to stop")
    print()
    if open_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped.")
    finally:
        httpd.server_close()


def cli_match(service, user_input, prefer=None):
    result = service.analyze(user_input, prefer=prefer)
    track = result["track"]
    print(f"\n  🎧 {track['title']}")
    print(f"     {track['summary']}  ({track['duration']}s)")
    for warning in result["warnings"]:
        print(f"     ⚠️  {warning}")
    print(f"\n  🎯 top matches out of {result['library_size']} library files:\n")
    if not result["matches"]:
        print("     (nothing found — add files to the library and rerun with --scan)")
        return 1
    for i, match in enumerate(result["matches"][:10], 1):
        bpm = f"{match['bpm']:g}" if match.get("bpm") else "?"
        print(f"  {i:>2}. {int(match['score'] * 100):>3}%  {match['name']}")
        print(f"       {match['kind']} · {bpm} BPM · {match.get('key') or '?'} · {', '.join(match.get('reasons') or [])}")
        print(f"       {match['path']}")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="DAW Match — auto-match arps and projects to a track")
    parser.add_argument("--port", type=int, default=None, help="panel port (default 4020)")
    parser.add_argument("--scan", action="store_true", help="reindex the library and exit")
    parser.add_argument("--match", metavar="URL_OR_FILE", help="run one search in the terminal")
    parser.add_argument("--prefer", choices=["arp", "loop", "project"], help="bias results toward one kind")
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser window")
    parser.add_argument("--starter-pack", action="store_true",
                        help="write a few example arps into the first library root, then index")
    args = parser.parse_args(argv)

    config.ensure_state_dirs()
    service = MatchService()

    if args.starter_pack:
        target = service.config.library_roots[0]
        created = starter.build(target)
        print(f"  wrote {len(created)} starter arps into {target}")
        for path in created[:6]:
            print(f"    · {os.path.basename(path)}")
        if len(created) > 6:
            print(f"    · … and {len(created) - 6} more")
        stats = service.scan()
        print(f"  indexed {len(service.entries)} files ({stats['scanned']} new)")
        return 0

    if args.scan:
        stats = service.scan()
        print(f"  indexed {len(service.entries)} files "
              f"({stats['scanned']} new, {stats['cached']} cached, {stats['skipped']} skipped)")
        for root in stats["missing_roots"]:
            print(f"  ⚠️  missing library root: {root}")
        return 0

    if args.match:
        try:
            return cli_match(service, args.match, prefer=args.prefer)
        except audioio.IngestError as exc:
            print(f"  ✗ {exc}", file=sys.stderr)
            return 1

    serve(service, port=args.port, open_browser=not args.no_browser)
    return 0


if __name__ == "__main__":
    sys.exit(main())
