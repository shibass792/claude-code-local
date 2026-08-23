"""Shared remote-control state for SHIBASS panel <-> Rokid glasses."""

from __future__ import annotations

import itertools
import threading
import time
from typing import Any

_lock = threading.Lock()
_seq = itertools.count(1)
_commands: list[dict[str, Any]] = []
_state: dict[str, Any] = {
    "playing": False,
    "title": None,
    "path": None,
    "position": 0.0,
    "duration": 0.0,
    "volume": 0.85,
    "updated_at": time.time(),
}
MAX_QUEUE = 50


def push_command(action: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    cmd = {
        "id": next(_seq),
        "action": action,
        "payload": payload or {},
        "ts": time.time(),
    }
    with _lock:
        _commands.append(cmd)
        if len(_commands) > MAX_QUEUE:
            del _commands[: len(_commands) - MAX_QUEUE]
    return cmd


def poll_commands(after_id: int = 0) -> list[dict[str, Any]]:
    with _lock:
        return [c for c in _commands if int(c["id"]) > after_id]


def set_state(patch: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        _state.update(patch)
        _state["updated_at"] = time.time()
        return dict(_state)


def get_state() -> dict[str, Any]:
    with _lock:
        return dict(_state)
