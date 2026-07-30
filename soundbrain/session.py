"""Download matched assets and open them together in Cubase (or Ableton).

There is no supported in-DAW plugin hook from Python, so this module does the
honest producer workflow:

1. Build a **session folder** under ``~/.soundbrain/sessions/<slug>/``
2. Copy the chosen ARP / MIDI / preset files into ``arps/``
3. Write ``session.json`` that links the reference track + project + ARPs
4. Write a short ``README.txt`` (Hebrew + English) next to the project
5. Launch Cubase with the ``.cpr`` (Windows / macOS / Linux best-effort)

"Download" here means *copy from your own indexed library* into a working pack —
never scraping YouTube audio.
"""

from __future__ import annotations

import json
import os
import platform
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence

from .config import Config
from .db import Database

CUBASE_CANDIDATES_WIN = (
    r"C:\Program Files\Steinberg\Cubase 14\Cubase14.exe",
    r"C:\Program Files\Steinberg\Cubase 13\Cubase13.exe",
    r"C:\Program Files\Steinberg\Cubase 12\Cubase12.exe",
    r"C:\Program Files\Steinberg\Cubase 11\Cubase11.exe",
    r"C:\Program Files\Steinberg\CubasePRO14\Cubase14.exe",
    r"C:\Program Files\Steinberg\CubasePRO13\Cubase13.exe",
    r"C:\Program Files\Steinberg\Nuendo 14\Nuendo14.exe",
    r"C:\Program Files\Steinberg\Nuendo 13\Nuendo13.exe",
)

CUBASE_CANDIDATES_MAC = (
    "/Applications/Cubase 14.app",
    "/Applications/Cubase 13.app",
    "/Applications/Cubase 12.app",
    "/Applications/Cubase.app",
    "/Applications/Nuendo 14.app",
    "/Applications/Nuendo.app",
)

ABLETON_CANDIDATES_WIN = (
    r"C:\ProgramData\Ableton\Live 12 Suite\Program\Ableton Live 12 Suite.exe",
    r"C:\ProgramData\Ableton\Live 11 Suite\Program\Ableton Live 11 Suite.exe",
    r"C:\ProgramData\Ableton\Live 12 Standard\Program\Ableton Live 12 Standard.exe",
)

ABLETON_CANDIDATES_MAC = (
    "/Applications/Ableton Live 12 Suite.app",
    "/Applications/Ableton Live 11 Suite.app",
    "/Applications/Ableton Live 12 Standard.app",
    "/Applications/Ableton Live.app",
)


@dataclass
class SessionResult:
    session_dir: str
    project_path: str | None = None
    copied: list[str] = field(default_factory=list)
    session_json: str = ""
    launched: bool = False
    launch_cmd: list[str] = field(default_factory=list)
    daw: str = ""
    message_he: str = ""
    message_en: str = ""
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "session_dir": self.session_dir,
            "project_path": self.project_path,
            "copied": self.copied,
            "session_json": self.session_json,
            "launched": self.launched,
            "launch_cmd": self.launch_cmd,
            "daw": self.daw,
            "message_he": self.message_he,
            "message_en": self.message_en,
            "notes": self.notes,
        }


def _slug(text: str, limit: int = 48) -> str:
    cleaned = re.sub(r"[^\w\-א-ת]+", "-", text.strip(), flags=re.UNICODE)
    cleaned = re.sub(r"-+", "-", cleaned).strip("-") or "session"
    return cleaned[:limit]


def find_cubase() -> str | None:
    system = platform.system()
    if system == "Windows":
        for path in CUBASE_CANDIDATES_WIN:
            if Path(path).exists():
                return path
        # PATH lookup
        which = shutil.which("Cubase14") or shutil.which("Cubase13") or shutil.which("Cubase")
        return which
    if system == "Darwin":
        for path in CUBASE_CANDIDATES_MAC:
            if Path(path).exists():
                return path
    return None


def find_ableton() -> str | None:
    system = platform.system()
    if system == "Windows":
        for path in ABLETON_CANDIDATES_WIN:
            if Path(path).exists():
                return path
    if system == "Darwin":
        for path in ABLETON_CANDIDATES_MAC:
            if Path(path).exists():
                return path
    return None


def _safe_copy(src: Path, dest_dir: Path) -> Path | None:
    if not src.exists() or not src.is_file():
        return None
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / src.name
    if dest.exists():
        stem, suffix = src.stem, src.suffix
        n = 2
        while dest.exists():
            dest = dest_dir / f"{stem}_{n}{suffix}"
            n += 1
    shutil.copy2(src, dest)
    return dest


def download_hits(
    cfg: Config,
    hits: Sequence[dict[str, Any]],
    *,
    label: str = "pack",
) -> dict[str, Any]:
    """Copy selected library files into ``~/.soundbrain/downloads/<label>/``."""
    cfg.ensure_dirs()
    stamp = time.strftime("%Y%m%d-%H%M%S")
    folder = cfg.downloads_path / f"{_slug(label)}-{stamp}"
    folder.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []
    missing: list[str] = []
    for hit in hits:
        path = Path(str(hit.get("path") or ""))
        if not path:
            continue
        result = _safe_copy(path, folder)
        if result is None:
            missing.append(str(path))
        else:
            copied.append(str(result))
    manifest = {
        "created_at": time.time(),
        "label": label,
        "copied": copied,
        "missing": missing,
        "hits": list(hits),
    }
    (folder / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {
        "folder": str(folder),
        "copied": copied,
        "missing": missing,
        "count": len(copied),
        "message_he": f"הורדו {len(copied)} קבצים אל {folder}",
        "message_en": f"Downloaded {len(copied)} files to {folder}",
    }


def build_session(
    cfg: Config,
    *,
    reference: dict[str, Any],
    project: dict[str, Any] | None,
    arps: Sequence[dict[str, Any]],
    open_daw: bool = True,
    preferred_daw: str = "cubase",
) -> SessionResult:
    """Associate reference + ARPs + project, then optionally launch the DAW."""
    cfg.ensure_dirs()
    label = str(reference.get("title") or reference.get("query") or reference.get("input") or "session")
    stamp = time.strftime("%Y%m%d-%H%M%S")
    session_dir = cfg.sessions_path / f"{_slug(label)}-{stamp}"
    arps_dir = session_dir / "arps"
    session_dir.mkdir(parents=True, exist_ok=True)
    arps_dir.mkdir(parents=True, exist_ok=True)

    copied: list[str] = []
    for hit in arps:
        path = Path(str(hit.get("path") or ""))
        result = _safe_copy(path, arps_dir)
        if result is not None:
            copied.append(str(result))

    project_path = str(project["path"]) if project and project.get("path") else None
    if project_path and not Path(project_path).exists():
        project_path = None

    payload = {
        "created_at": time.time(),
        "reference": reference,
        "project": project,
        "arps": list(arps),
        "copied_arps": copied,
        "project_path": project_path,
        "preferred_daw": preferred_daw,
    }
    session_json = session_dir / "session.json"
    session_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    readme = session_dir / "README.txt"
    readme.write_text(
        "\n".join(
            [
                "SoundBrain Match Session",
                "=" * 28,
                f"Reference: {label}",
                f"Source: {reference.get('source')} {reference.get('url') or reference.get('path') or ''}",
                f"Project: {project_path or '(none selected)'}",
                f"ARPs copied: {len(copied)}",
                "",
                "עברית:",
                f"הטראק «{label}» שויך לפרויקט ולקבצי ה-ARP בתיקייה הזו.",
                "פתח את הפרויקט ב-Cubase וגרור את הקבצים מתיקיית arps/.",
                "",
                "English:",
                "Open the project in Cubase and drag files from arps/ onto tracks.",
                "",
            ]
        ),
        encoding="utf-8",
    )

    # Sidecar next to the project so Cubase users see the link immediately
    if project_path:
        sidecar = Path(project_path).with_suffix(".soundbrain-session.json")
        try:
            sidecar.write_text(
                json.dumps(
                    {
                        "session_dir": str(session_dir),
                        "reference": reference,
                        "arps": [{"name": a.get("name"), "path": a.get("path"), "copied": c} for a, c in zip(arps, copied)],
                        "readme": str(readme),
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
        except OSError as exc:
            payload_notes = [f"could not write project sidecar: {exc}"]
        else:
            payload_notes = [f"wrote {sidecar}"]
    else:
        payload_notes = ["no project path — session folder only"]

    result = SessionResult(
        session_dir=str(session_dir),
        project_path=project_path,
        copied=copied,
        session_json=str(session_json),
        notes=payload_notes,
    )

    daw = (preferred_daw or "cubase").lower()
    if project and project.get("daw"):
        project_daw = str(project["daw"]).lower()
        if "ableton" in project_daw:
            daw = "ableton"
        elif "cubase" in project_daw or "nuendo" in project_daw:
            daw = "cubase"

    if open_daw:
        launch = launch_daw(daw, project_path)
        result.launched = launch["launched"]
        result.launch_cmd = launch["cmd"]
        result.daw = launch["daw"]
        result.notes.extend(launch.get("notes") or [])
    else:
        result.daw = daw

    result.message_he = (
        f"שייכתי {len(copied)} ARP לפרויקט"
        + (f" ופתחתי ב-{result.daw or 'Cubase'}" if result.launched else "")
        + f". תיקייה: {session_dir}"
    )
    result.message_en = (
        f"Associated {len(copied)} ARPs with the project"
        + (f" and launched {result.daw or 'Cubase'}" if result.launched else "")
        + f". Folder: {session_dir}"
    )
    return result


def launch_daw(daw: str, project_path: str | None) -> dict[str, Any]:
    """Best-effort launch of Cubase or Ableton with an optional project file."""
    system = platform.system()
    notes: list[str] = []
    exe: str | None = None
    label = daw

    if daw.startswith("able"):
        exe = find_ableton()
        label = "Ableton Live"
    else:
        exe = find_cubase()
        label = "Cubase"

    if exe is None:
        notes.append(f"{label} executable not found — open the project manually")
        if project_path and system == "Windows":
            # Still try shell association
            try:
                os.startfile(project_path)  # type: ignore[attr-defined]
                return {
                    "launched": True,
                    "cmd": ["startfile", project_path],
                    "daw": label,
                    "notes": notes + ["used Windows file association"],
                }
            except OSError as exc:
                notes.append(str(exc))
        if project_path and system == "Darwin":
            cmd = ["open", project_path]
            try:
                subprocess.Popen(cmd)  # noqa: S603
                return {"launched": True, "cmd": cmd, "daw": label, "notes": notes + ["used macOS open"]}
            except OSError as exc:
                notes.append(str(exc))
        return {"launched": False, "cmd": [], "daw": label, "notes": notes}

    if system == "Darwin" and exe.endswith(".app"):
        cmd = ["open", "-a", exe]
        if project_path:
            cmd.append(project_path)
    elif system == "Windows":
        cmd = [exe]
        if project_path:
            cmd.append(project_path)
    else:
        cmd = [exe]
        if project_path:
            cmd.append(project_path)

    try:
        subprocess.Popen(cmd)  # noqa: S603
        return {"launched": True, "cmd": cmd, "daw": label, "notes": notes}
    except OSError as exc:
        notes.append(f"launch failed: {exc}")
        return {"launched": False, "cmd": cmd, "daw": label, "notes": notes}


def open_in_cubase(
    db: Database,
    cfg: Config,
    *,
    reference: dict[str, Any],
    project_path: str | None = None,
    project_file_id: int | None = None,
    arp_paths: Sequence[str] | None = None,
    arp_file_ids: Sequence[int] | None = None,
    open_daw: bool = True,
) -> dict[str, Any]:
    """API / CLI entry: resolve ids → build session → launch Cubase."""
    project: dict[str, Any] | None = None
    if project_file_id is not None:
        row = db.file_by_id(int(project_file_id))
        if row is None:
            raise FileNotFoundError(f"project file_id {project_file_id} not found")
        project = {
            "file_id": int(row["id"]),
            "path": str(row["path"]),
            "name": str(row["name"]),
            "daw": str(row["daw"] or "Cubase"),
        }
    elif project_path:
        project = {"path": project_path, "name": Path(project_path).name, "daw": "Cubase"}

    arps: list[dict[str, Any]] = []
    for fid in arp_file_ids or ():
        row = db.file_by_id(int(fid))
        if row is None:
            continue
        arps.append({"file_id": int(row["id"]), "path": str(row["path"]), "name": str(row["name"])})
    for path in arp_paths or ():
        arps.append({"path": path, "name": Path(path).name})

    result = build_session(
        cfg,
        reference=reference,
        project=project,
        arps=arps,
        open_daw=open_daw,
        preferred_daw="cubase",
    )
    db.log_event(
        "cubase_open",
        subject=result.project_path or result.session_dir,
        payload=result.as_dict(),
    )
    db.commit()
    return result.as_dict()
