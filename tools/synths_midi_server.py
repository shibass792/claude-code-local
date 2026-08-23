#!/usr/bin/env python3
"""Minimal ShiBass MIDI bridge stub.

Replace or extend with your real synth/MIDI routing logic.
Run: python tools/synths_midi_server.py
Default port: 8877 — 8765 is ShiBass Master Server on your machine.
Override with SHIBASS_MIDI_PORT.
"""
from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


HOST = os.environ.get("SHIBASS_MIDI_HOST", "127.0.0.1")
PORT = int(os.environ.get("SHIBASS_MIDI_PORT", "8877"))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        print(f"[midi] {self.address_string()} {fmt % args}")

    def _send_json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path in ("/", "/health"):
            self._send_json(
                200,
                {
                    "ok": True,
                    "service": "synths_midi_server",
                    "note": "stub — wire to your MIDI/Cubase bridge",
                },
            )
            return
        self._send_json(404, {"ok": False, "error": "not_found"})

    def do_POST(self) -> None:
        if self.path != "/note":
            self._send_json(404, {"ok": False, "error": "not_found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self._send_json(400, {"ok": False, "error": "invalid_json"})
            return
        # Hook: send MIDI to DAW here
        print(f"[midi] note request: {data}")
        self._send_json(200, {"ok": True, "received": data})


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"synths_midi_server listening on http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[midi] shutdown")


if __name__ == "__main__":
    main()
