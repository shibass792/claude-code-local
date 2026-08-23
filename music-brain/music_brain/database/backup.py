"""SQLite database backup utilities."""

from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path


def backup_database(db_path: str | Path, backup_dir: str | Path | None = None) -> Path:
    src = Path(db_path)
    if not src.exists():
        raise FileNotFoundError(f"Database not found: {src}")

    dest_dir = Path(backup_dir) if backup_dir else src.parent / "backups"
    dest_dir.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = dest_dir / f"music_brain_{stamp}.db"
    shutil.copy2(src, dest)

    # Keep last 10 backups
    backups = sorted(dest_dir.glob("music_brain_*.db"), reverse=True)
    for old in backups[10:]:
        old.unlink(missing_ok=True)

    return dest
