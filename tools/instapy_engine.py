#!/usr/bin/env python3
"""ShiBass Instagram engine — Graph API first, optional InstaPy status only."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def graph_status() -> dict:
    token = os.environ.get("META_ACCESS_TOKEN", "").strip()
    ig_user = os.environ.get("META_IG_USER_ID", "").strip()
    if not token or not ig_user:
        return {
            "ok": False,
            "engine": "meta-graph",
            "error": "META_ACCESS_TOKEN and META_IG_USER_ID are required",
        }

    query = urllib.parse.urlencode({"fields": "id,username,name", "access_token": token})
    url = f"https://graph.facebook.com/v21.0/{ig_user}?{query}"
    try:
        with urllib.request.urlopen(url, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return {"ok": True, "engine": "meta-graph", "user": payload}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return {"ok": False, "engine": "meta-graph", "error": body}
    except Exception as exc:  # noqa: BLE001 — surface any transport failure honestly
        return {"ok": False, "engine": "meta-graph", "error": str(exc)}


def instapy_status() -> dict:
    try:
        import instapy  # type: ignore
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "engine": "instapy", "installed": False, "error": str(exc)}

    version = getattr(instapy, "__version__", "installed")
    return {"ok": True, "engine": "instapy", "installed": True, "version": version}


def main() -> int:
    parser = argparse.ArgumentParser(description="ShiBass Instagram engine")
    parser.add_argument("--status", action="store_true", help="Print engine status JSON")
    args = parser.parse_args()

    report = {
        "graph": graph_status(),
        "instapy": instapy_status(),
        "enabled": os.environ.get("INSTAPY_ENABLED") == "1",
        "mock": False,
    }
    print(json.dumps(report, ensure_ascii=False))
    if args.status:
        return 0 if report["graph"]["ok"] or report["instapy"]["ok"] else 2
    return 0 if report["graph"]["ok"] or report["instapy"]["ok"] else 2


if __name__ == "__main__":
    sys.exit(main())
