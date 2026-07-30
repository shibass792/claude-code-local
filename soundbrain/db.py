"""SQLite knowledge database for SoundBrain.

One local file (``~/.soundbrain/soundbrain.db``) holds every fact the engine
learns: which files exist on which drive, their musical analysis, the parsed
projects, the plugin chains, and the brain state. The scanner only touches
files whose size or mtime changed, so re-scans of a 4-drive studio stay cheap.
"""

from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS files (
    id           INTEGER PRIMARY KEY,
    path         TEXT NOT NULL UNIQUE,
    root         TEXT NOT NULL,
    drive        TEXT,
    name         TEXT NOT NULL,
    ext          TEXT,
    kind         TEXT NOT NULL,          -- audio | project | preset | plugin | midi | archive
    size         INTEGER NOT NULL,
    mtime_ns     INTEGER NOT NULL,
    tool         TEXT,                   -- Serum, Kontakt, Cubase, ...
    daw          TEXT,
    library      TEXT,                   -- top-level sample library folder
    first_seen   REAL NOT NULL,
    last_seen    REAL NOT NULL,
    missing      INTEGER NOT NULL DEFAULT 0,
    analyzed_at  REAL,
    analysis_sig TEXT                    -- size:mtime at analysis time
);
CREATE INDEX IF NOT EXISTS idx_files_kind ON files(kind);
CREATE INDEX IF NOT EXISTS idx_files_tool ON files(tool);
CREATE INDEX IF NOT EXISTS idx_files_missing ON files(missing);

CREATE TABLE IF NOT EXISTS analyses (
    file_id        INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    created_at     REAL NOT NULL,
    duration       REAL,
    sample_rate    INTEGER,
    channels       INTEGER,
    role           TEXT,
    subtype        TEXT,
    role_conf      REAL,
    subtype_conf   REAL,
    bpm            REAL,
    bpm_conf       REAL,
    musical_key    TEXT,
    key_conf       REAL,
    fundamental_hz REAL,
    midi_note      REAL,
    lufs           REAL,
    rms_db         REAL,
    peak_db        REAL,
    crest_db       REAL,
    dynamic_range  REAL,
    attack_ms      REAL,
    release_ms     REAL,
    transient      REAL,
    centroid_hz    REAL,
    rolloff85_hz   REAL,
    rolloff95_hz   REAL,
    flatness       REAL,
    stereo_width   REAL,
    correlation    REAL,
    energy         REAL,
    features       TEXT NOT NULL          -- full JSON payload (mfcc, chroma, tonnetz, ...)
);
CREATE INDEX IF NOT EXISTS idx_analyses_role ON analyses(role);
CREATE INDEX IF NOT EXISTS idx_analyses_key ON analyses(musical_key);
CREATE INDEX IF NOT EXISTS idx_analyses_bpm ON analyses(bpm);

CREATE TABLE IF NOT EXISTS projects (
    id           INTEGER PRIMARY KEY,
    file_id      INTEGER NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    daw          TEXT,
    bpm          REAL,
    musical_key  TEXT,
    modified_at  REAL,
    parsed_at    REAL NOT NULL,
    dna          TEXT
);

CREATE TABLE IF NOT EXISTS project_items (
    id          INTEGER PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,          -- plugin | instrument | preset | sample | track
    name        TEXT NOT NULL,
    detail      TEXT,
    position    INTEGER DEFAULT 0,
    count       INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_items_project ON project_items(project_id);
CREATE INDEX IF NOT EXISTS idx_items_kind_name ON project_items(kind, name);

CREATE TABLE IF NOT EXISTS chains (
    id          INTEGER PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    track       TEXT,
    signature   TEXT NOT NULL,          -- "Serum > Pro-Q 3 > Saturn"
    length      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chains_signature ON chains(signature);

CREATE TABLE IF NOT EXISTS tools_seen (
    name        TEXT PRIMARY KEY,
    kind        TEXT,
    hits        INTEGER NOT NULL DEFAULT 0,
    example     TEXT,
    last_seen   REAL
);

CREATE TABLE IF NOT EXISTS scan_runs (
    id          INTEGER PRIMARY KEY,
    started_at  REAL NOT NULL,
    finished_at REAL,
    roots       TEXT,
    seen        INTEGER DEFAULT 0,
    added       INTEGER DEFAULT 0,
    changed     INTEGER DEFAULT 0,
    skipped     INTEGER DEFAULT 0,
    errors      INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS brain (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS brain_events (
    id          INTEGER PRIMARY KEY,
    created_at  REAL NOT NULL,
    kind        TEXT NOT NULL,
    subject     TEXT,
    payload     TEXT
);
"""


@dataclass
class FileRecord:
    """A file on disk as the scanner sees it."""

    path: str
    root: str
    drive: str
    name: str
    ext: str
    kind: str
    size: int
    mtime_ns: int
    tool: str | None = None
    daw: str | None = None
    library: str | None = None

    @property
    def signature(self) -> str:
        return f"{self.size}:{self.mtime_ns}"


class Database:
    """Thin, dependency-free wrapper around the SQLite knowledge base."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.path))
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.migrate()

    # -- lifecycle -------------------------------------------------------
    def migrate(self) -> None:
        self.conn.executescript(SCHEMA)
        self.set_meta("schema_version", str(SCHEMA_VERSION))
        self.conn.commit()

    def close(self) -> None:
        try:
            self.conn.commit()
        finally:
            self.conn.close()

    def __enter__(self) -> "Database":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # -- meta ------------------------------------------------------------
    def set_meta(self, key: str, value: str) -> None:
        self.conn.execute(
            "INSERT INTO meta(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )

    def get_meta(self, key: str, default: str | None = None) -> str | None:
        row = self.conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return row["value"] if row else default

    # -- files -----------------------------------------------------------
    def upsert_file(self, rec: FileRecord) -> tuple[int, str]:
        """Insert or refresh a file row.

        Returns ``(file_id, status)`` where status is ``new``, ``changed`` or
        ``unchanged`` so the caller can decide whether to re-analyse.
        """
        now = time.time()
        row = self.conn.execute(
            "SELECT id, size, mtime_ns FROM files WHERE path=?", (rec.path,)
        ).fetchone()
        if row is None:
            cur = self.conn.execute(
                """INSERT INTO files(path, root, drive, name, ext, kind, size, mtime_ns,
                                     tool, daw, library, first_seen, last_seen, missing)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0)""",
                (
                    rec.path,
                    rec.root,
                    rec.drive,
                    rec.name,
                    rec.ext,
                    rec.kind,
                    rec.size,
                    rec.mtime_ns,
                    rec.tool,
                    rec.daw,
                    rec.library,
                    now,
                    now,
                ),
            )
            return int(cur.lastrowid or 0), "new"

        changed = int(row["size"]) != rec.size or int(row["mtime_ns"]) != rec.mtime_ns
        self.conn.execute(
            """UPDATE files SET root=?, drive=?, name=?, ext=?, kind=?, size=?, mtime_ns=?,
                               tool=?, daw=?, library=?, last_seen=?, missing=0 WHERE id=?""",
            (
                rec.root,
                rec.drive,
                rec.name,
                rec.ext,
                rec.kind,
                rec.size,
                rec.mtime_ns,
                rec.tool,
                rec.daw,
                rec.library,
                now,
                row["id"],
            ),
        )
        return int(row["id"]), "changed" if changed else "unchanged"

    def mark_missing(self, roots: Sequence[str], before: float) -> int:
        """Flag files under ``roots`` that were not touched by the last scan."""
        total = 0
        for root in roots:
            cur = self.conn.execute(
                "UPDATE files SET missing=1 WHERE root=? AND last_seen < ? AND missing=0",
                (root, before),
            )
            total += cur.rowcount or 0
        return total

    def file_by_path(self, path: str) -> sqlite3.Row | None:
        return self.conn.execute("SELECT * FROM files WHERE path=?", (path,)).fetchone()

    def file_by_id(self, file_id: int) -> sqlite3.Row | None:
        return self.conn.execute("SELECT * FROM files WHERE id=?", (file_id,)).fetchone()

    def files(self, kind: str | None = None, include_missing: bool = False) -> list[sqlite3.Row]:
        sql = "SELECT * FROM files WHERE 1=1"
        args: list[Any] = []
        if kind:
            sql += " AND kind=?"
            args.append(kind)
        if not include_missing:
            sql += " AND missing=0"
        return list(self.conn.execute(sql, args))

    def pending_analysis(self, kind: str = "audio", limit: int | None = None) -> list[sqlite3.Row]:
        """Files whose analysis is absent or stale."""
        sql = """
            SELECT f.* FROM files f
            LEFT JOIN analyses a ON a.file_id = f.id
            WHERE f.kind = ? AND f.missing = 0
              AND (a.file_id IS NULL OR f.analysis_sig IS NULL
                   OR f.analysis_sig != (CAST(f.size AS TEXT) || ':' || CAST(f.mtime_ns AS TEXT)))
            ORDER BY f.size ASC
        """
        if limit:
            sql += f" LIMIT {int(limit)}"
        return list(self.conn.execute(sql, (kind,)))

    # -- analyses --------------------------------------------------------
    ANALYSIS_COLUMNS = (
        "duration",
        "sample_rate",
        "channels",
        "role",
        "subtype",
        "role_conf",
        "subtype_conf",
        "bpm",
        "bpm_conf",
        "musical_key",
        "key_conf",
        "fundamental_hz",
        "midi_note",
        "lufs",
        "rms_db",
        "peak_db",
        "crest_db",
        "dynamic_range",
        "attack_ms",
        "release_ms",
        "transient",
        "centroid_hz",
        "rolloff85_hz",
        "rolloff95_hz",
        "flatness",
        "stereo_width",
        "correlation",
        "energy",
    )

    def save_analysis(self, file_id: int, features: dict[str, Any]) -> None:
        cols = ", ".join(self.ANALYSIS_COLUMNS)
        placeholders = ", ".join("?" for _ in self.ANALYSIS_COLUMNS)
        values = [features.get(col) for col in self.ANALYSIS_COLUMNS]
        self.conn.execute(
            f"""INSERT INTO analyses(file_id, created_at, {cols}, features)
                VALUES(?,?,{placeholders},?)
                ON CONFLICT(file_id) DO UPDATE SET
                  created_at=excluded.created_at,
                  {", ".join(f"{c}=excluded.{c}" for c in self.ANALYSIS_COLUMNS)},
                  features=excluded.features""",
            [file_id, time.time(), *values, json.dumps(features, allow_nan=False)],
        )
        self.conn.execute(
            "UPDATE files SET analyzed_at=?, analysis_sig=CAST(size AS TEXT) || ':' || CAST(mtime_ns AS TEXT) WHERE id=?",
            (time.time(), file_id),
        )

    def analysis(self, file_id: int) -> dict[str, Any] | None:
        row = self.conn.execute("SELECT features FROM analyses WHERE file_id=?", (file_id,)).fetchone()
        if not row:
            return None
        return json.loads(row["features"])

    def iter_analyzed(
        self,
        role: str | None = None,
        subtype: str | None = None,
        include_missing: bool = False,
    ) -> Iterator[dict[str, Any]]:
        sql = """SELECT f.id AS file_id, f.path, f.name, f.tool, f.library, a.features
                 FROM analyses a JOIN files f ON f.id = a.file_id WHERE 1=1"""
        args: list[Any] = []
        if role:
            sql += " AND a.role=?"
            args.append(role)
        if subtype:
            sql += " AND a.subtype=?"
            args.append(subtype)
        if not include_missing:
            sql += " AND f.missing=0"
        for row in self.conn.execute(sql, args):
            features = json.loads(row["features"])
            features.setdefault("path", row["path"])
            features.setdefault("name", row["name"])
            features["file_id"] = row["file_id"]
            features["tool"] = row["tool"]
            features["library"] = row["library"]
            yield features

    # -- projects --------------------------------------------------------
    def save_project(
        self,
        file_id: int,
        name: str,
        daw: str | None,
        bpm: float | None,
        key: str | None,
        modified_at: float | None,
        items: Iterable[tuple[str, str, str | None, int]],
        chains: Iterable[tuple[str | None, list[str]]] = (),
        dna: dict[str, Any] | None = None,
    ) -> int:
        row = self.conn.execute("SELECT id FROM projects WHERE file_id=?", (file_id,)).fetchone()
        payload = json.dumps(dna) if dna is not None else None
        if row:
            project_id = int(row["id"])
            self.conn.execute(
                """UPDATE projects SET name=?, daw=?, bpm=?, musical_key=?, modified_at=?, parsed_at=?, dna=?
                   WHERE id=?""",
                (name, daw, bpm, key, modified_at, time.time(), payload, project_id),
            )
            self.conn.execute("DELETE FROM project_items WHERE project_id=?", (project_id,))
            self.conn.execute("DELETE FROM chains WHERE project_id=?", (project_id,))
        else:
            cur = self.conn.execute(
                """INSERT INTO projects(file_id, name, daw, bpm, musical_key, modified_at, parsed_at, dna)
                   VALUES(?,?,?,?,?,?,?,?)""",
                (file_id, name, daw, bpm, key, modified_at, time.time(), payload),
            )
            project_id = int(cur.lastrowid or 0)

        self.conn.executemany(
            "INSERT INTO project_items(project_id, kind, name, detail, position) VALUES(?,?,?,?,?)",
            [(project_id, kind, item, detail, pos) for kind, item, detail, pos in items],
        )
        chain_rows = []
        for track, plugins in chains:
            if len(plugins) >= 2:
                chain_rows.append((project_id, track, " > ".join(plugins), len(plugins)))
        if chain_rows:
            self.conn.executemany(
                "INSERT INTO chains(project_id, track, signature, length) VALUES(?,?,?,?)",
                chain_rows,
            )
        return project_id

    def projects(self) -> list[sqlite3.Row]:
        return list(
            self.conn.execute(
                """SELECT p.*, f.path FROM projects p JOIN files f ON f.id = p.file_id
                   WHERE f.missing = 0 ORDER BY COALESCE(p.modified_at, 0) DESC"""
            )
        )

    def project_by_path(self, path: str) -> sqlite3.Row | None:
        return self.conn.execute(
            """SELECT p.*, f.path FROM projects p JOIN files f ON f.id = p.file_id WHERE f.path=?""",
            (path,),
        ).fetchone()

    def project_items(self, project_id: int, kind: str | None = None) -> list[sqlite3.Row]:
        sql = "SELECT * FROM project_items WHERE project_id=?"
        args: list[Any] = [project_id]
        if kind:
            sql += " AND kind=?"
            args.append(kind)
        sql += " ORDER BY position ASC, id ASC"
        return list(self.conn.execute(sql, args))

    # -- tools -----------------------------------------------------------
    def bump_tool(self, name: str, kind: str, example: str) -> None:
        self.conn.execute(
            """INSERT INTO tools_seen(name, kind, hits, example, last_seen) VALUES(?,?,1,?,?)
               ON CONFLICT(name) DO UPDATE SET hits = hits + 1, last_seen = excluded.last_seen,
                                              example = COALESCE(tools_seen.example, excluded.example)""",
            (name, kind, example, time.time()),
        )

    def tools(self) -> list[sqlite3.Row]:
        return list(self.conn.execute("SELECT * FROM tools_seen ORDER BY hits DESC"))

    # -- scan runs -------------------------------------------------------
    def start_scan(self, roots: Sequence[str]) -> int:
        cur = self.conn.execute(
            "INSERT INTO scan_runs(started_at, roots) VALUES(?,?)",
            (time.time(), json.dumps(list(roots))),
        )
        self.conn.commit()
        return int(cur.lastrowid or 0)

    def finish_scan(self, run_id: int, stats: dict[str, int]) -> None:
        self.conn.execute(
            """UPDATE scan_runs SET finished_at=?, seen=?, added=?, changed=?, skipped=?, errors=? WHERE id=?""",
            (
                time.time(),
                stats.get("seen", 0),
                stats.get("added", 0),
                stats.get("changed", 0),
                stats.get("skipped", 0),
                stats.get("errors", 0),
                run_id,
            ),
        )
        self.conn.commit()

    # -- brain -----------------------------------------------------------
    def set_brain(self, key: str, value: Any) -> None:
        self.conn.execute(
            """INSERT INTO brain(key, value, updated_at) VALUES(?,?,?)
               ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at""",
            (key, json.dumps(value), time.time()),
        )

    def get_brain(self, key: str, default: Any = None) -> Any:
        row = self.conn.execute("SELECT value FROM brain WHERE key=?", (key,)).fetchone()
        if not row:
            return default
        try:
            return json.loads(row["value"])
        except json.JSONDecodeError:
            return default

    def log_event(self, kind: str, subject: str | None = None, payload: Any = None) -> None:
        self.conn.execute(
            "INSERT INTO brain_events(created_at, kind, subject, payload) VALUES(?,?,?,?)",
            (time.time(), kind, subject, json.dumps(payload) if payload is not None else None),
        )

    def events(self, kind: str | None = None, limit: int = 200) -> list[sqlite3.Row]:
        sql = "SELECT * FROM brain_events WHERE 1=1"
        args: list[Any] = []
        if kind:
            sql += " AND kind=?"
            args.append(kind)
        sql += " ORDER BY id DESC LIMIT ?"
        args.append(limit)
        return list(self.conn.execute(sql, args))

    # -- misc ------------------------------------------------------------
    def counts(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for row in self.conn.execute(
            "SELECT kind, COUNT(*) AS n FROM files WHERE missing=0 GROUP BY kind"
        ):
            out[str(row["kind"])] = int(row["n"])
        out["analyses"] = int(
            self.conn.execute("SELECT COUNT(*) AS n FROM analyses").fetchone()["n"]
        )
        out["projects"] = int(
            self.conn.execute("SELECT COUNT(*) AS n FROM projects").fetchone()["n"]
        )
        return out

    def commit(self) -> None:
        self.conn.commit()


def open_db(path: str | Path) -> Database:
    return Database(path)
