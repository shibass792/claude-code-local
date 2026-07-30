#!/usr/bin/env python3
"""Unified scan + readiness control plane for claude-code-local.

Scans the repo for .html / .ps1 / .py, syntax-checks Python, reports memory,
starts local services (H-drive API + this dashboard), and exposes JSON health
for the control-panel buttons.

Usage:
  python3 scripts/system_ready.py scan
  python3 scripts/system_ready.py start
  python3 scripts/system_ready.py serve          # dashboard on :8787
  python3 scripts/system_ready.py all            # scan + start + serve
"""

from __future__ import annotations

import ast
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
DASHBOARD = REPO / "dashboard" / "control-panel.html"
H_CTL = REPO / "scripts" / "h-drive" / "h_drive_ctl.py"
PROXY = REPO / "proxy" / "server.py"
H_ROOT = Path(os.environ.get("H_DRIVE_ROOT", str(REPO / ".h-drive-root")))
H_PORT = int(os.environ.get("H_DRIVE_PORT", "18765"))
DASH_PORT = int(os.environ.get("READY_PORT", "8787"))
MLX_PORT = int(os.environ.get("MLX_PORT", "4000"))
MLX_PYTHON = Path(os.environ.get("MLX_PYTHON", str(Path.home() / ".local/mlx-server/bin/python")))
MLX_MODEL = os.environ.get("MLX_MODEL", "mlx-community/Qwen2.5-0.5B-Instruct-4bit")

SKIP_DIRS = {".git", "__pycache__", ".venv", "node_modules", ".h-drive-root"}


def mem_info() -> dict[str, Any]:
    info: dict[str, Any] = {"platform": sys.platform}
    try:
        with open("/proc/meminfo", encoding="utf-8") as f:
            raw = f.read()
        kb = {}
        for line in raw.splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                kb[k] = int(v.strip().split()[0])
        info.update(
            {
                "total_mb": kb.get("MemTotal", 0) // 1024,
                "available_mb": kb.get("MemAvailable", 0) // 1024,
                "free_mb": kb.get("MemFree", 0) // 1024,
                "ok": (kb.get("MemAvailable", 0) // 1024) > 1024,
            }
        )
    except OSError:
        info["ok"] = True
        info["note"] = "meminfo unavailable"
    return info


def disk_info() -> dict[str, Any]:
    usage = shutil.disk_usage(REPO)
    return {
        "total_gb": round(usage.total / (1024**3), 1),
        "used_gb": round(usage.used / (1024**3), 1),
        "free_gb": round(usage.free / (1024**3), 1),
        "ok": usage.free > 2 * 1024**3,
    }


def iter_code_files() -> list[Path]:
    out: list[Path] = []
    for ext in (".html", ".htm", ".ps1", ".py", ".cmd", ".sh"):
        for p in REPO.rglob(f"*{ext}"):
            if any(part in SKIP_DIRS for part in p.parts):
                continue
            out.append(p)
    return sorted(out)


def scan_code() -> dict[str, Any]:
    files = iter_code_files()
    by_ext: dict[str, list[str]] = {"html": [], "ps1": [], "py": [], "cmd": [], "sh": [], "other": []}
    py_errors: list[dict[str, str]] = []
    for p in files:
        rel = str(p.relative_to(REPO))
        suf = p.suffix.lower()
        if suf in (".html", ".htm"):
            by_ext["html"].append(rel)
        elif suf == ".ps1":
            by_ext["ps1"].append(rel)
        elif suf == ".py":
            by_ext["py"].append(rel)
            try:
                ast.parse(p.read_text(encoding="utf-8", errors="replace"))
            except SyntaxError as e:
                py_errors.append({"file": rel, "error": f"{e.msg} line {e.lineno}"})
        elif suf == ".cmd":
            by_ext["cmd"].append(rel)
        elif suf == ".sh":
            by_ext["sh"].append(rel)
        else:
            by_ext["other"].append(rel)

    return {
        "root": str(REPO),
        "counts": {k: len(v) for k, v in by_ext.items()},
        "files": by_ext,
        "py_syntax_errors": py_errors,
        "ok": len(py_errors) == 0,
    }


def probe(url: str, timeout: float = 1.5) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            try:
                payload = json.loads(body)
            except json.JSONDecodeError:
                payload = {"raw": body[:200]}
            return {"up": True, "status": resp.status, "body": payload}
    except Exception as e:
        return {"up": False, "error": str(e)}


def services_status() -> dict[str, Any]:
    return {
        "h_drive": probe(f"http://127.0.0.1:{H_PORT}/health"),
        "mlx": probe(f"http://127.0.0.1:{MLX_PORT}/health"),
        "dashboard": probe(f"http://127.0.0.1:{DASH_PORT}/api/health"),
        "one_ai_router": probe("http://127.0.0.1:4010/health"),
    }


def ensure_h_root() -> None:
    H_ROOT.mkdir(parents=True, exist_ok=True)
    projects = H_ROOT / "Projects"
    projects.mkdir(exist_ok=True)
    readme = projects / "README.txt"
    if not readme.exists():
        readme.write_text(
            "H-drive remote-control root (cloud mock or Windows H:\\).\n"
            "Claude Code can list/read/write here via h-drive CLI / MCP.\n",
            encoding="utf-8",
        )


def start_h_drive() -> dict[str, Any]:
    ensure_h_root()
    st = probe(f"http://127.0.0.1:{H_PORT}/health")
    if st["up"]:
        return {"started": False, "already_up": True, "port": H_PORT, "root": str(H_ROOT)}
    env = os.environ.copy()
    env["H_DRIVE_ROOT"] = str(H_ROOT)
    log_path = Path("/tmp/h-drive-serve.log")
    logf = open(log_path, "a", encoding="utf-8")
    proc = subprocess.Popen(
        [sys.executable, str(H_CTL), "serve", "--host", "127.0.0.1", "--port", str(H_PORT)],
        env=env,
        stdout=logf,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    for _ in range(40):
        time.sleep(0.1)
        if probe(f"http://127.0.0.1:{H_PORT}/health")["up"]:
            return {
                "started": True,
                "pid": proc.pid,
                "port": H_PORT,
                "root": str(H_ROOT),
                "log": str(log_path),
            }
    return {"started": False, "error": "timeout waiting for h-drive", "pid": proc.pid, "log": str(log_path)}


def start_mlx_if_possible() -> dict[str, Any]:
    st = probe(f"http://127.0.0.1:{MLX_PORT}/health")
    if st["up"]:
        return {"started": False, "already_up": True, "port": MLX_PORT}
    if not MLX_PYTHON.exists():
        return {"started": False, "skipped": True, "reason": "mlx python missing"}
    # mlx Anthropic server imports mlx — may be CPU-only / slow here.
    env = os.environ.copy()
    env["MLX_MODEL"] = MLX_MODEL
    env["MLX_PORT"] = str(MLX_PORT)
    env["MLX_MAX_TOKENS"] = "64"
    log_path = Path("/tmp/mlx-server.log")
    logf = open(log_path, "a", encoding="utf-8")
    proc = subprocess.Popen(
        [str(MLX_PYTHON), str(PROXY)],
        env=env,
        stdout=logf,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    # Model load can take a bit; wait up to ~90s
    for _ in range(180):
        time.sleep(0.5)
        if probe(f"http://127.0.0.1:{MLX_PORT}/health", timeout=2.0)["up"]:
            return {
                "started": True,
                "pid": proc.pid,
                "port": MLX_PORT,
                "model": MLX_MODEL,
                "log": str(log_path),
            }
        if proc.poll() is not None:
            return {
                "started": False,
                "error": "mlx process exited",
                "pid": proc.pid,
                "log": str(log_path),
                "tail": log_path.read_text(encoding="utf-8", errors="replace")[-1500:],
            }
    return {
        "started": False,
        "error": "timeout waiting for mlx /health (still loading?)",
        "pid": proc.pid,
        "log": str(log_path),
    }


def full_report() -> dict[str, Any]:
    scan = scan_code()
    return {
        "ok": scan["ok"] and mem_info().get("ok", True) and disk_info().get("ok", True),
        "memory": mem_info(),
        "disk": disk_info(),
        "scan": scan,
        "services": services_status(),
        "note": (
            "This cloud VM cannot see your Windows H:\\/F:\\ drives. "
            "Run launchers/H-Drive Remote.cmd setup on Windows for real drive MCP."
        ),
    }


def make_dashboard_handler():
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args: Any) -> None:
            sys.stderr.write("[ready] " + (fmt % args) + "\n")

        def _json(self, code: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload, indent=2).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _html(self) -> None:
            if not DASHBOARD.exists():
                self._json(500, {"error": "dashboard missing", "path": str(DASHBOARD)})
                return
            data = DASHBOARD.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:  # noqa: N802
            path = self.path.split("?", 1)[0]
            if path in ("/", "/index.html", "/dashboard"):
                self._html()
                return
            if path == "/api/health":
                self._json(200, {"ok": True, "service": "system-ready", "port": DASH_PORT})
                return
            if path == "/api/status":
                self._json(200, full_report())
                return
            if path == "/api/scan":
                self._json(200, scan_code())
                return
            if path == "/api/memory":
                self._json(200, {"memory": mem_info(), "disk": disk_info()})
                return
            if path == "/api/services":
                self._json(200, services_status())
                return
            self._json(404, {"error": "not found", "path": path})

        def do_POST(self) -> None:  # noqa: N802
            path = self.path.split("?", 1)[0]
            length = int(self.headers.get("Content-Length", "0") or "0")
            if length:
                self.rfile.read(length)
            if path == "/api/start/h-drive":
                self._json(200, start_h_drive())
                return
            if path == "/api/start/mlx":
                # Run in thread so UI isn't blocked forever if load is slow
                result: dict[str, Any] = {"accepted": True}
                def _run():
                    start_mlx_if_possible()
                threading.Thread(target=_run, daemon=True).start()
                self._json(202, result)
                return
            if path == "/api/start/all":
                h = start_h_drive()
                self._json(200, {"h_drive": h, "mlx": "starting_in_background"})
                threading.Thread(target=start_mlx_if_possible, daemon=True).start()
                return
            self._json(404, {"error": "not found"})

    return Handler


def serve_dashboard() -> int:
    handler = make_dashboard_handler()
    server = ThreadingHTTPServer(("127.0.0.1", DASH_PORT), handler)
    print(
        json.dumps(
            {
                "ok": True,
                "dashboard": f"http://127.0.0.1:{DASH_PORT}/",
                "api": f"http://127.0.0.1:{DASH_PORT}/api/status",
            },
            indent=2,
        )
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped", file=sys.stderr)
    return 0


def main(argv: list[str] | None = None) -> int:
    args = list(argv or sys.argv[1:])
    cmd = args[0] if args else "all"

    if cmd == "scan":
        print(json.dumps(full_report(), indent=2))
        return 0 if full_report()["ok"] else 1
    if cmd == "start":
        print(json.dumps({"h_drive": start_h_drive(), "mlx": start_mlx_if_possible()}, indent=2))
        return 0
    if cmd == "serve":
        return serve_dashboard()
    if cmd == "all":
        report = full_report()
        h = start_h_drive()
        # Don't block forever on MLX in "all" — kick it off then serve UI
        threading.Thread(target=start_mlx_if_possible, daemon=True).start()
        report["started"] = {"h_drive": h, "mlx": "starting_in_background"}
        print(json.dumps(report, indent=2))
        return serve_dashboard()
    print("usage: system_ready.py [scan|start|serve|all]", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
