"""Config path resolution tests."""

from pathlib import Path

from music_brain.config import get_project_root, load_config


def test_project_root():
    root = get_project_root()
    assert (root / "config.yaml").exists()
    assert (root / "music_brain" / "cli.py").exists()


def test_load_config_default():
    cfg = load_config()
    assert "scan_paths" in cfg
    assert isinstance(cfg["scan_paths"], list)
