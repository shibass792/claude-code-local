"""Database lock resilience — serve must wait, not crash, when DB is busy."""

from __future__ import annotations

import sqlite3
import threading
import time
from pathlib import Path

from soundbrain.db import Database


def test_open_waits_while_another_connection_holds_write_lock(tmp_path: Path):
    db_path = tmp_path / "soundbrain.db"
    # Create a clean DB first.
    Database(db_path).close()

    blocker = sqlite3.connect(str(db_path), timeout=1.0)
    blocker.execute("BEGIN EXCLUSIVE")
    blocker.execute("UPDATE meta SET value=value")  # ensure write lock

    opened: list[Database] = []
    errors: list[BaseException] = []

    def open_db() -> None:
        try:
            opened.append(Database(db_path))
        except BaseException as exc:  # noqa: BLE001 — capture for assertion
            errors.append(exc)

    t = threading.Thread(target=open_db)
    t.start()
    time.sleep(0.4)  # let Database.__init__ hit the lock + start retrying
    blocker.commit()
    blocker.close()
    t.join(timeout=30)

    assert not errors, f"unexpected error: {errors}"
    assert opened, "Database should open after lock released"
    opened[0].close()


def test_connect_sets_busy_timeout(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    row = db.conn.execute("PRAGMA busy_timeout").fetchone()
    assert int(row[0]) >= 30_000
    db.close()
