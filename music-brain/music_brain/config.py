"""Load config.yaml and resolve project paths."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml


def get_project_root() -> Path:
    """music-brain/ directory (parent of music_brain package)."""
    return Path(__file__).resolve().parent.parent


def load_config(config_path: str | Path | None = None) -> dict[str, Any]:
    if config_path is not None:
        path = Path(config_path)
    else:
        env_path = os.environ.get("MUSIC_BRAIN_CONFIG")
        if env_path:
            path = Path(env_path)
        else:
            candidates = [
                get_project_root() / "config.yaml",
                Path.cwd() / "config.yaml",
            ]
            path = next((p for p in candidates if p.exists()), candidates[0])

    if not path.exists():
        raise FileNotFoundError(
            f"Config not found: {path}\n"
            f"Expected at: {get_project_root() / 'config.yaml'}\n"
            f"Or pass: music-brain --config path\\to\\config.yaml <command>"
        )
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def resolve_data_path(relative: str) -> Path:
    """Resolve paths from config relative to project root."""
    p = Path(relative)
    if p.is_absolute():
        return p
    return get_project_root() / p
