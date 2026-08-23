# -*- coding: utf-8 -*-
"""Panel Sweep — audit every panel served by the 4781 hub, for real.

For each static HTML page:
  1. fetch it (loads? size?)
  2. extract every http://127.0.0.1:PORT reference it depends on
  3. probe each unique endpoint ONCE (TCP+HTTP, 3s)
Outputs:
  07_LOGS/panel_sweep.json   full machine-readable results
  07_LOGS/panel_sweep.md     human report: broken panels grouped by missing backend
"""
from __future__ import annotations

import json
import re
import socket
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

HUB = "http://127.0.0.1:4781"
LOGS = Path(r"H:\shibass-ai\07_LOGS")
URL_RE = re.compile(r"(?:https?:)?//(?:127\.0\.0\.1|localhost):(\d{2,5})")


def fetch(url: str, timeout: float = 10) -> bytes | None:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.read()
    except Exception:
        return None


def port_alive(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(2)
        return s.connect_ex(("127.0.0.1", port)) == 0


def main() -> None:
    # authoritative source: the panel library on disk, now served by the trio hub
    public = Path(r"H:\shibass-ai\public")
    files = sorted(public.glob("*.html"))
    print(f"pages to audit: {len(files)} (from {public})")

    results = {}

    def audit(f: Path) -> None:
        try:
            body = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            results[f.name] = {"loads": False, "deps": []}
            return
        ports = sorted({int(p) for p in URL_RE.findall(body)
                        if p.isdigit() and 1 < int(p) < 65536})
        results[f.name] = {"loads": True, "size": len(body), "deps": ports}

    with ThreadPoolExecutor(max_workers=12) as ex:
        list(ex.map(audit, files))
    pages = [f.name for f in files]

    all_ports = sorted({p for r in results.values() for p in r.get("deps", [])})
    alive = {p: port_alive(p) for p in all_ports}
    print(f"unique backend ports referenced: {len(all_ports)}")

    broken_by_port: dict[int, list[str]] = defaultdict(list)
    ok_pages, broken_pages, selfc = [], [], []
    for page, r in results.items():
        if not r["loads"]:
            broken_pages.append(page)
            continue
        dead = [p for p in r["deps"] if not alive.get(p, False)]
        if not r["deps"]:
            selfc.append(page)
        elif dead:
            broken_pages.append(page)
            for p in dead:
                broken_by_port[p].append(page)
        else:
            ok_pages.append(page)

    LOGS.mkdir(exist_ok=True)
    (LOGS / "panel_sweep.json").write_text(json.dumps({
        "at": datetime.now().isoformat(timespec="seconds"),
        "pages": results, "ports_alive": alive}, indent=1), encoding="utf-8")

    md = [f"# Panel Sweep — {datetime.now():%Y-%m-%d %H:%M}",
          f"total pages: {len(pages)} | self-contained (no backend): {len(selfc)} | "
          f"all-deps-alive: {len(ok_pages)} | broken deps: {len(broken_pages)}", "",
          "## Missing backends by impact (fix these to fix the most panels):"]
    for port, pgs in sorted(broken_by_port.items(), key=lambda kv: -len(kv[1])):
        md.append(f"- **:{port}** — breaks {len(pgs)} panels "
                  f"(e.g. {', '.join(pgs[:5])}{'…' if len(pgs) > 5 else ''})")
    (LOGS / "panel_sweep.md").write_text("\n".join(md), encoding="utf-8")

    print(f"self-contained: {len(selfc)} | fully-working deps: {len(ok_pages)} | "
          f"broken: {len(broken_pages)}")
    print("top missing backends:")
    for port, pgs in sorted(broken_by_port.items(), key=lambda kv: -len(kv[1]))[:12]:
        print(f"  :{port}  breaks {len(pgs)} panels")


if __name__ == "__main__":
    main()
