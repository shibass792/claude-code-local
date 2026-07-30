#!/usr/bin/env python3
"""H:\\ drive remote control helper for Claude Code.

Gives Claude Code (local or cloud) a small, safe CLI + optional localhost
HTTP API scoped to one drive/root — defaulting to Windows H:\\.

Examples:
  python h_drive_ctl.py list
  python h_drive_ctl.py list Projects
  python h_drive_ctl.py read README.md
  python h_drive_ctl.py write notes.txt "hello"
  python h_drive_ctl.py mkdir work/tmp
  python h_drive_ctl.py rm work/tmp/old.txt
  python h_drive_ctl.py serve --port 18765

Environment:
  H_DRIVE_ROOT   Root directory (default: H:\\ on Windows, else ./h-drive-root)
  H_DRIVE_TOKEN  Optional bearer token required by the HTTP API
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


DEFAULT_WIN_ROOT = "H:\\"
DEFAULT_POSIX_ROOT = "./h-drive-root"
MAX_READ_BYTES = 2 * 1024 * 1024  # 2 MiB soft cap for CLI/API reads
MAX_LIST_ENTRIES = 2000


def default_root() -> Path:
    env = os.environ.get("H_DRIVE_ROOT")
    if env:
        return Path(env).expanduser()
    if os.name == "nt":
        return Path(DEFAULT_WIN_ROOT)
    return Path(DEFAULT_POSIX_ROOT)


def resolve_under_root(root: Path, rel: str | None) -> Path:
    """Resolve rel under root; reject path escape attempts."""
    root = root.resolve()
    if not rel or rel in (".", "/", "\\"):
        target = root
    else:
        # Normalize Windows-style separators from callers.
        cleaned = rel.replace("\\", "/").lstrip("/")
        if cleaned.startswith("H:/") or cleaned.upper().startswith("H:/"):
            cleaned = cleaned[3:]
        if len(cleaned) >= 2 and cleaned[1] == ":":
            # Absolute drive path like H:/foo — keep only the relative part.
            cleaned = cleaned[2:].lstrip("/")
        target = (root / cleaned).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise SystemExit(f"error: path escapes H_DRIVE_ROOT: {rel!r}") from exc
    return target


def cmd_list(root: Path, rel: str | None, recursive: bool) -> int:
    target = resolve_under_root(root, rel)
    if not target.exists():
        print(f"error: not found: {target}", file=sys.stderr)
        return 1
    if not target.is_dir():
        print(json.dumps({"path": str(target), "type": "file", "size": target.stat().st_size}))
        return 0

    entries: list[dict[str, Any]] = []
    if recursive:
        for dirpath, dirnames, filenames in os.walk(target):
            dirnames.sort()
            filenames.sort()
            base = Path(dirpath)
            for name in dirnames:
                p = base / name
                rel_path = p.relative_to(root).as_posix()
                entries.append({"path": rel_path, "type": "dir"})
                if len(entries) >= MAX_LIST_ENTRIES:
                    break
            for name in filenames:
                p = base / name
                rel_path = p.relative_to(root).as_posix()
                try:
                    size = p.stat().st_size
                except OSError:
                    size = None
                entries.append({"path": rel_path, "type": "file", "size": size})
                if len(entries) >= MAX_LIST_ENTRIES:
                    break
            if len(entries) >= MAX_LIST_ENTRIES:
                break
    else:
        for p in sorted(target.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            rel_path = p.relative_to(root).as_posix()
            item: dict[str, Any] = {
                "path": rel_path,
                "type": "dir" if p.is_dir() else "file",
            }
            if p.is_file():
                try:
                    item["size"] = p.stat().st_size
                except OSError:
                    item["size"] = None
            entries.append(item)
            if len(entries) >= MAX_LIST_ENTRIES:
                break

    print(
        json.dumps(
            {
                "root": str(root),
                "path": "." if not rel else rel.replace("\\", "/"),
                "count": len(entries),
                "truncated": len(entries) >= MAX_LIST_ENTRIES,
                "entries": entries,
            },
            indent=2,
        )
    )
    return 0


def cmd_read(root: Path, rel: str, binary: bool) -> int:
    target = resolve_under_root(root, rel)
    if not target.is_file():
        print(f"error: not a file: {target}", file=sys.stderr)
        return 1
    data = target.read_bytes()
    if len(data) > MAX_READ_BYTES:
        print(
            f"error: file larger than {MAX_READ_BYTES} bytes "
            f"({len(data)}). Read a smaller file or raise the limit.",
            file=sys.stderr,
        )
        return 1
    if binary:
        sys.stdout.buffer.write(data)
    else:
        sys.stdout.write(data.decode("utf-8", errors="replace"))
    return 0


def cmd_write(root: Path, rel: str, content: str | None, from_stdin: bool) -> int:
    target = resolve_under_root(root, rel)
    target.parent.mkdir(parents=True, exist_ok=True)
    if from_stdin:
        data = sys.stdin.buffer.read()
        target.write_bytes(data)
    else:
        if content is None:
            print("error: provide content or --stdin", file=sys.stderr)
            return 1
        target.write_text(content, encoding="utf-8")
    print(json.dumps({"ok": True, "path": str(target.relative_to(root.resolve())), "bytes": target.stat().st_size}))
    return 0


def cmd_mkdir(root: Path, rel: str) -> int:
    target = resolve_under_root(root, rel)
    target.mkdir(parents=True, exist_ok=True)
    print(json.dumps({"ok": True, "path": str(target.relative_to(root.resolve())), "type": "dir"}))
    return 0


def cmd_rm(root: Path, rel: str, recursive: bool) -> int:
    target = resolve_under_root(root, rel)
    if target == root.resolve():
        print("error: refusing to remove H_DRIVE_ROOT itself", file=sys.stderr)
        return 1
    if not target.exists():
        print(f"error: not found: {target}", file=sys.stderr)
        return 1
    if target.is_dir():
        if not recursive:
            print("error: directory requires --recursive", file=sys.stderr)
            return 1
        # Manual recursive delete to avoid shutil dependency surprises on locked files.
        for dirpath, dirnames, filenames in os.walk(target, topdown=False):
            for name in filenames:
                (Path(dirpath) / name).unlink(missing_ok=True)
            for name in dirnames:
                (Path(dirpath) / name).rmdir()
        target.rmdir()
    else:
        target.unlink()
    print(json.dumps({"ok": True, "removed": rel.replace("\\", "/")}))
    return 0


def cmd_stat(root: Path, rel: str | None) -> int:
    target = resolve_under_root(root, rel)
    if not target.exists():
        print(f"error: not found: {target}", file=sys.stderr)
        return 1
    st = target.stat()
    print(
        json.dumps(
            {
                "path": str(target.relative_to(root.resolve())) if target != root.resolve() else ".",
                "absolute": str(target),
                "type": "dir" if target.is_dir() else "file",
                "size": st.st_size,
                "mtime": int(st.st_mtime),
            },
            indent=2,
        )
    )
    return 0


def make_handler(root: Path, token: str | None):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args: Any) -> None:
            sys.stderr.write("[h-drive] " + (fmt % args) + "\n")

        def _auth_ok(self) -> bool:
            if not token:
                return True
            auth = self.headers.get("Authorization", "")
            return auth == f"Bearer {token}"

        def _json(self, code: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802
            if not self._auth_ok():
                self._json(401, {"error": "unauthorized"})
                return
            parsed = urlparse(self.path)
            qs = parse_qs(parsed.query)
            path = (qs.get("path") or ["."])[0]
            if parsed.path in ("/", "/health"):
                self._json(200, {"ok": True, "root": str(root.resolve())})
                return
            if parsed.path == "/list":
                recursive = (qs.get("recursive") or ["0"])[0] in ("1", "true", "yes")
                # Reuse CLI logic by capturing stdout.
                from io import StringIO

                buf = StringIO()
                old = sys.stdout
                sys.stdout = buf
                try:
                    code = cmd_list(root, path, recursive)
                finally:
                    sys.stdout = old
                if code != 0:
                    self._json(404, {"error": "not found", "path": path})
                    return
                self._json(200, json.loads(buf.getvalue()))
                return
            if parsed.path == "/read":
                target = resolve_under_root(root, path)
                if not target.is_file():
                    self._json(404, {"error": "not a file", "path": path})
                    return
                data = target.read_bytes()
                if len(data) > MAX_READ_BYTES:
                    self._json(413, {"error": "too large", "size": len(data)})
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            if parsed.path == "/stat":
                target = resolve_under_root(root, path)
                if not target.exists():
                    self._json(404, {"error": "not found", "path": path})
                    return
                st = target.stat()
                self._json(
                    200,
                    {
                        "path": path,
                        "type": "dir" if target.is_dir() else "file",
                        "size": st.st_size,
                        "mtime": int(st.st_mtime),
                    },
                )
                return
            self._json(404, {"error": "unknown endpoint"})

        def do_POST(self) -> None:  # noqa: N802
            if not self._auth_ok():
                self._json(401, {"error": "unauthorized"})
                return
            parsed = urlparse(self.path)
            length = int(self.headers.get("Content-Length", "0") or "0")
            raw = self.rfile.read(length) if length else b""
            try:
                payload = json.loads(raw.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                self._json(400, {"error": "invalid json"})
                return
            path = payload.get("path")
            if not path:
                self._json(400, {"error": "path required"})
                return
            if parsed.path == "/write":
                content = payload.get("content", "")
                target = resolve_under_root(root, path)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(str(content), encoding="utf-8")
                self._json(200, {"ok": True, "path": path, "bytes": target.stat().st_size})
                return
            if parsed.path == "/mkdir":
                target = resolve_under_root(root, path)
                target.mkdir(parents=True, exist_ok=True)
                self._json(200, {"ok": True, "path": path, "type": "dir"})
                return
            if parsed.path == "/rm":
                recursive = bool(payload.get("recursive", False))
                from io import StringIO

                buf = StringIO()
                old = sys.stdout
                sys.stdout = buf
                try:
                    code = cmd_rm(root, path, recursive)
                finally:
                    sys.stdout = old
                if code != 0:
                    self._json(400, {"error": buf.getvalue() or "rm failed"})
                    return
                self._json(200, json.loads(buf.getvalue()))
                return
            self._json(404, {"error": "unknown endpoint"})

    return Handler


def cmd_serve(root: Path, host: str, port: int, token: str | None) -> int:
    if host not in ("127.0.0.1", "localhost", "::1"):
        print("error: refuse to bind non-localhost (remote control is local-only)", file=sys.stderr)
        return 1
    root = root.resolve()
    if not root.exists():
        root.mkdir(parents=True, exist_ok=True)
        print(f"created missing root: {root}", file=sys.stderr)
    handler = make_handler(root, token)
    server = ThreadingHTTPServer((host, port), handler)
    print(
        json.dumps(
            {
                "ok": True,
                "listening": f"http://{host}:{port}",
                "root": str(root),
                "auth": bool(token),
                "endpoints": ["/health", "/list", "/read", "/stat", "/write", "/mkdir", "/rm"],
            },
            indent=2,
        )
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped", file=sys.stderr)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Remote-control helper scoped to H:\\ (or H_DRIVE_ROOT)")
    p.add_argument("--root", default=None, help="Override H_DRIVE_ROOT")
    sub = p.add_subparsers(dest="cmd", required=True)

    list_p = sub.add_parser("list", help="List files under a path")
    list_p.add_argument("path", nargs="?", default=".")
    list_p.add_argument("-r", "--recursive", action="store_true")

    read_p = sub.add_parser("read", help="Read a UTF-8 (or binary) file")
    read_p.add_argument("path")
    read_p.add_argument("--binary", action="store_true")

    write_p = sub.add_parser("write", help="Write text content to a file")
    write_p.add_argument("path")
    write_p.add_argument("content", nargs="?")
    write_p.add_argument("--stdin", action="store_true")

    mkdir_p = sub.add_parser("mkdir", help="Create a directory")
    mkdir_p.add_argument("path")

    rm_p = sub.add_parser("rm", help="Remove a file or directory")
    rm_p.add_argument("path")
    rm_p.add_argument("-r", "--recursive", action="store_true")

    stat_p = sub.add_parser("stat", help="Stat a path")
    stat_p.add_argument("path", nargs="?", default=".")

    serve_p = sub.add_parser("serve", help="Localhost HTTP API for remote control")
    serve_p.add_argument("--host", default="127.0.0.1")
    serve_p.add_argument("--port", type=int, default=18765)
    serve_p.add_argument("--token", default=os.environ.get("H_DRIVE_TOKEN"))

    sub.add_parser("root", help="Print the resolved root path")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    root = Path(args.root).expanduser() if args.root else default_root()

    if args.cmd == "root":
        print(str(root.resolve() if root.exists() else root))
        return 0
    if args.cmd == "list":
        return cmd_list(root, args.path, args.recursive)
    if args.cmd == "read":
        return cmd_read(root, args.path, args.binary)
    if args.cmd == "write":
        return cmd_write(root, args.path, args.content, args.stdin)
    if args.cmd == "mkdir":
        return cmd_mkdir(root, args.path)
    if args.cmd == "rm":
        return cmd_rm(root, args.path, args.recursive)
    if args.cmd == "stat":
        return cmd_stat(root, args.path)
    if args.cmd == "serve":
        return cmd_serve(root, args.host, args.port, args.token)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
