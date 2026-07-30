"""Open DAW project files in Cubase, Ableton, etc."""

from __future__ import annotations

import os
import platform
import subprocess
from pathlib import Path
from typing import Any

DAW_APPS = {
    ".cpr": ("Cubase", "cubase"),
    ".npr": ("Nuendo", "nuendo"),
    ".als": ("Ableton Live", "ableton live"),
    ".song": ("Studio One", "studio one"),
    ".logicx": ("Logic Pro", "logic pro"),
    ".rpp": ("REAPER", "reaper"),
}


def open_project(project_path: str) -> dict[str, Any]:
    path = Path(project_path).expanduser()
    if not path.is_file():
        return {
            "ok": False,
            "error": f"פרויקט לא נמצא: {path}",
            "project_path": str(path),
        }

    ext = path.suffix.lower()
    daw_label, _ = DAW_APPS.get(ext, ("DAW", ""))
    system = platform.system()

    try:
        if system == "Windows":
            os.startfile(str(path))  # type: ignore[attr-defined]
        elif system == "Darwin":
            subprocess.run(["open", str(path)], check=True, timeout=15)
        else:
            subprocess.run(["xdg-open", str(path)], check=True, timeout=15)
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "error": str(exc),
            "project_path": str(path.resolve()),
            "daw": daw_label,
            "hint": "ודא ש-Cubase / Ableton מותקנים ושיוך קבצים פעיל",
        }

    return {
        "ok": True,
        "project_path": str(path.resolve()),
        "daw": daw_label,
        "message_he": f"נפתח ב-{daw_label}",
    }
