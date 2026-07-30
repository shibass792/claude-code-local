"""SQLite knowledge database — fast index of scans and analyses."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

# Bump when schema bootstrap logic changes (shown in errors / debug).
SCHEMA_BOOTSTRAP_VERSION = 2

# Tables + indexes that do NOT require migrated columns.
SCHEMA_TABLES = """
CREATE TABLE IF NOT EXISTS scan_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at REAL NOT NULL,
    finished_at REAL,
    paths TEXT NOT NULL,
    files_found INTEGER DEFAULT 0,
    files_new INTEGER DEFAULT 0,
    files_updated INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audio_analysis (
    file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    features_json TEXT NOT NULL,
    category TEXT,
    sub_style TEXT,
    bpm REAL,
    key TEXT,
    lufs REAL
);

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    daw TEXT,
    dna_json TEXT,
    bpm REAL,
    key TEXT,
    genre TEXT,
    analyzed_at REAL
);

CREATE TABLE IF NOT EXISTS plugin_chains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id),
    chain_json TEXT NOT NULL,
    source_plugin TEXT,
    usage_count INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS usage_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_name TEXT NOT NULL,
    count INTEGER DEFAULT 1,
    UNIQUE(entity_type, entity_name)
);

CREATE TABLE IF NOT EXISTS brain_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    payload_json TEXT,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS reference_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference_id TEXT NOT NULL,
    reference_source TEXT NOT NULL,
    reference_title TEXT,
    project_path TEXT NOT NULL,
    bpm REAL,
    key TEXT,
    created_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ref_links_project ON reference_links(project_path);
CREATE INDEX IF NOT EXISTS idx_ref_links_ref ON reference_links(reference_id);

CREATE TABLE IF NOT EXISTS sonic_embeddings (
    file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    vector_json TEXT NOT NULL,
    indexed_at REAL NOT NULL
);
"""

SCHEMA_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_files_kind ON files(kind);
CREATE INDEX IF NOT EXISTS idx_files_hash ON files(content_hash);
CREATE INDEX IF NOT EXISTS idx_files_library ON files(library);
CREATE INDEX IF NOT EXISTS idx_files_library_sub ON files(library, library_sub);
CREATE INDEX IF NOT EXISTS idx_analysis_category ON audio_analysis(category);
CREATE INDEX IF NOT EXISTS idx_analysis_bpm ON audio_analysis(bpm);
CREATE INDEX IF NOT EXISTS idx_analysis_key ON audio_analysis(key);
CREATE INDEX IF NOT EXISTS idx_projects_bpm ON projects(bpm);
CREATE INDEX IF NOT EXISTS idx_projects_key ON projects(key);
"""

# Backward-compatible alias (tests / external imports).
SCHEMA = SCHEMA_TABLES


class KnowledgeDB:
    def __init__(self, db_path: str | Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        # Order matters for legacy DBs:
        # 1) ensure files table + library columns
        # 2) create remaining tables
        # 3) create indexes (including library indexes)
        self._ensure_files_migrated()
        self._conn.executescript(SCHEMA_TABLES)
        self._ensure_files_migrated()  # again in case CREATE raced oddly
        self._conn.executescript(SCHEMA_INDEXES)
        self._conn.commit()

    def _table_columns(self, table: str) -> set[str]:
        return {row[1] for row in self._conn.execute(f"PRAGMA table_info({table})")}

    def _add_column_if_missing(self, table: str, column: str, col_type: str) -> None:
        cols = self._table_columns(table)
        if column in cols:
            return
        try:
            self._conn.execute(
                f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"
            )
        except sqlite3.OperationalError as exc:
            # Concurrent / already-added
            if "duplicate column" not in str(exc).lower():
                raise

    def _ensure_files_migrated(self) -> None:
        """Create files table if needed and add library columns for old DBs."""
        self._conn.execute(
            """CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT UNIQUE NOT NULL,
                kind TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                mtime REAL NOT NULL,
                content_hash TEXT NOT NULL,
                plugin_hint TEXT,
                category_hint TEXT,
                scanned_at REAL NOT NULL,
                analyzed_at REAL
            )"""
        )
        self._add_column_if_missing("files", "library", "TEXT")
        self._add_column_if_missing("files", "library_sub", "TEXT")
        # Verify before any index on library is created.
        cols = self._table_columns("files")
        if "library" not in cols or "library_sub" not in cols:
            raise RuntimeError(
                f"DB migration failed (bootstrap v{SCHEMA_BOOTSTRAP_VERSION}): "
                f"files columns={sorted(cols)}. "
                "Delete data/music_brain.db or run: music-brain status"
            )

    # Keep old name for callers / clarity in diffs.
    def _migrate_schema(self) -> None:
        self._ensure_files_migrated()

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> KnowledgeDB:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def start_scan_run(self, paths: list[str]) -> int:
        import time

        cur = self._conn.execute(
            "INSERT INTO scan_runs (started_at, paths) VALUES (?, ?)",
            (time.time(), json.dumps(paths)),
        )
        self._conn.commit()
        return int(cur.lastrowid)

    def finish_scan_run(
        self, run_id: int, found: int, new: int, updated: int
    ) -> None:
        import time

        self._conn.execute(
            """UPDATE scan_runs SET finished_at=?, files_found=?, files_new=?, files_updated=?
               WHERE id=?""",
            (time.time(), found, new, updated, run_id),
        )
        self._conn.commit()

    def get_file_by_path(self, path: str) -> sqlite3.Row | None:
        row = self._conn.execute(
            "SELECT * FROM files WHERE path=?", (path,)
        ).fetchone()
        return row

    def get_file_by_id(self, file_id: int) -> sqlite3.Row | None:
        return self._conn.execute(
            "SELECT * FROM files WHERE id=?", (file_id,)
        ).fetchone()

    def get_file_with_analysis(self, file_id: int) -> sqlite3.Row | None:
        return self._conn.execute(
            """SELECT f.id as file_id, f.path, f.kind, f.plugin_hint,
                      a.category, a.sub_style, a.bpm, a.key, a.lufs
               FROM files f
               LEFT JOIN audio_analysis a ON a.file_id = f.id
               WHERE f.id=?""",
            (file_id,),
        ).fetchone()

    def upsert_file(
        self,
        path: str,
        kind: str,
        size_bytes: int,
        mtime: float,
        content_hash: str,
        plugin_hint: str | None = None,
        category_hint: str | None = None,
        library: str | None = None,
        library_sub: str | None = None,
    ) -> tuple[int, bool]:
        """Returns (file_id, is_new)."""
        import time

        existing = self.get_file_by_path(path)
        now = time.time()
        if existing is None:
            cur = self._conn.execute(
                """INSERT INTO files (path, kind, library, library_sub, size_bytes, mtime,
                   content_hash, plugin_hint, category_hint, scanned_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    path,
                    kind,
                    library,
                    library_sub,
                    size_bytes,
                    mtime,
                    content_hash,
                    plugin_hint,
                    category_hint,
                    now,
                ),
            )
            self._conn.commit()
            return int(cur.lastrowid), True

        changed = (
            existing["mtime"] != mtime
            or existing["size_bytes"] != size_bytes
            or existing["content_hash"] != content_hash
        )
        if changed:
            self._conn.execute(
                """UPDATE files SET kind=?, library=?, library_sub=?, size_bytes=?, mtime=?,
                   content_hash=?, plugin_hint=?, category_hint=?, scanned_at=?, analyzed_at=NULL
                   WHERE id=?""",
                (
                    kind,
                    library,
                    library_sub,
                    size_bytes,
                    mtime,
                    content_hash,
                    plugin_hint,
                    category_hint,
                    now,
                    existing["id"],
                ),
            )
            self._conn.commit()
            return int(existing["id"]), False

        return int(existing["id"]), False

    def save_analysis(
        self,
        file_id: int,
        features: dict[str, Any],
        category: str | None,
        sub_style: str | None,
        bpm: float | None,
        key: str | None,
        lufs: float | None,
    ) -> None:
        import time

        self._conn.execute(
            """INSERT OR REPLACE INTO audio_analysis
               (file_id, features_json, category, sub_style, bpm, key, lufs)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                file_id,
                json.dumps(features),
                category,
                sub_style,
                bpm,
                key,
                lufs,
            ),
        )
        self._conn.execute(
            "UPDATE files SET analyzed_at=? WHERE id=?",
            (time.time(), file_id),
        )
        self._conn.commit()

    def update_file_library(
        self,
        file_id: int,
        kind: str,
        library: str,
        library_sub: str,
    ) -> None:
        self._conn.execute(
            "UPDATE files SET kind=?, library=?, library_sub=? WHERE id=?",
            (kind, library, library_sub, file_id),
        )
        self._conn.commit()

    def get_all_audio_files(self, limit: int = 50000) -> list[sqlite3.Row]:
        return list(
            self._conn.execute(
                """SELECT * FROM files
                   WHERE kind IN ('audio', 'sample', 'music')
                   ORDER BY id LIMIT ?""",
                (limit,),
            ).fetchall()
        )

    def get_library_stats(self) -> dict[str, Any]:
        rows = self._conn.execute(
            """SELECT library, library_sub, COUNT(*) as c
               FROM files
               WHERE kind IN ('audio', 'sample', 'music')
               GROUP BY library, library_sub
               ORDER BY c DESC"""
        ).fetchall()
        libraries: dict[str, dict[str, Any]] = {}
        for row in rows:
            lib = row["library"] or "other"
            sub = row["library_sub"] or "other"
            if lib not in libraries:
                libraries[lib] = {"total": 0, "subs": {}}
            libraries[lib]["total"] += row["c"]
            libraries[lib]["subs"][sub] = row["c"]
        total = sum(v["total"] for v in libraries.values())
        return {"total": total, "libraries": libraries}

    def browse_library(
        self,
        library: str,
        library_sub: str | None = None,
        offset: int = 0,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        query = """
            SELECT f.id as file_id, f.path, f.kind, f.library, f.library_sub,
                   a.category, a.sub_style, a.bpm, a.key, a.lufs
            FROM files f
            LEFT JOIN audio_analysis a ON a.file_id = f.id
            WHERE f.kind IN ('audio', 'sample', 'music')
              AND COALESCE(f.library, 'other') = ?
        """
        params: list[Any] = [library]
        if library_sub:
            query += " AND COALESCE(f.library_sub, 'other') = ?"
            params.append(library_sub)
        query += " ORDER BY f.path LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = self._conn.execute(query, params).fetchall()
        return [dict(row) for row in rows]

    def count_library(
        self,
        library: str,
        library_sub: str | None = None,
    ) -> int:
        query = """
            SELECT COUNT(*) as c FROM files
            WHERE kind IN ('audio', 'sample', 'music')
              AND COALESCE(library, 'other') = ?
        """
        params: list[Any] = [library]
        if library_sub:
            query += " AND COALESCE(library_sub, 'other') = ?"
            params.append(library_sub)
        row = self._conn.execute(query, params).fetchone()
        return int(row["c"]) if row else 0

    def get_unanalyzed_files(self, limit: int = 100) -> list[sqlite3.Row]:
        return list(
            self._conn.execute(
                """SELECT f.* FROM files f
                   LEFT JOIN audio_analysis a ON f.id = a.file_id
                   WHERE f.kind IN ('audio', 'sample', 'music') AND a.file_id IS NULL
                   LIMIT ?""",
                (limit,),
            ).fetchall()
        )

    def save_project_dna(
        self, path: str, daw: str | None, dna: dict[str, Any]
    ) -> int:
        import time

        cur = self._conn.execute(
            """INSERT INTO projects (path, daw, dna_json, bpm, key, genre, analyzed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(path) DO UPDATE SET
                 daw=excluded.daw, dna_json=excluded.dna_json,
                 bpm=excluded.bpm, key=excluded.key, genre=excluded.genre,
                 analyzed_at=excluded.analyzed_at""",
            (
                path,
                daw,
                json.dumps(dna),
                dna.get("bpm"),
                dna.get("key"),
                dna.get("genre"),
                time.time(),
            ),
        )
        self._conn.commit()
        row = self._conn.execute(
            "SELECT id FROM projects WHERE path=?", (path,)
        ).fetchone()
        return int(row["id"])

    def record_plugin_chain(
        self, project_id: int | None, chain: list[str], source_plugin: str
    ) -> None:
        chain_json = json.dumps(chain)
        existing = self._conn.execute(
            """SELECT id, usage_count FROM plugin_chains
               WHERE chain_json=? AND source_plugin=?""",
            (chain_json, source_plugin),
        ).fetchone()
        if existing:
            self._conn.execute(
                "UPDATE plugin_chains SET usage_count=usage_count+1 WHERE id=?",
                (existing["id"],),
            )
        else:
            self._conn.execute(
                """INSERT INTO plugin_chains (project_id, chain_json, source_plugin)
                   VALUES (?, ?, ?)""",
                (project_id, chain_json, source_plugin),
            )
        self._conn.commit()

    def increment_usage(self, entity_type: str, entity_name: str) -> None:
        self._conn.execute(
            """INSERT INTO usage_stats (entity_type, entity_name, count)
               VALUES (?, ?, 1)
               ON CONFLICT(entity_type, entity_name)
               DO UPDATE SET count = count + 1""",
            (entity_type, entity_name),
        )
        self._conn.commit()

    def get_usage_stats(self, entity_type: str) -> list[sqlite3.Row]:
        return list(
            self._conn.execute(
                """SELECT entity_name, count FROM usage_stats
                   WHERE entity_type=? ORDER BY count DESC""",
                (entity_type,),
            ).fetchall()
        )

    def log_brain_event(self, event_type: str, payload: dict[str, Any]) -> None:
        import time

        self._conn.execute(
            "INSERT INTO brain_events (event_type, payload_json, created_at) VALUES (?, ?, ?)",
            (event_type, json.dumps(payload), time.time()),
        )
        self._conn.commit()

    def search_by_features(
        self,
        category: str | None = None,
        bpm_min: float | None = None,
        bpm_max: float | None = None,
        key: str | None = None,
        sub_style: str | None = None,
        limit: int = 50,
    ) -> list[sqlite3.Row]:
        query = """
            SELECT f.path, a.* FROM audio_analysis a
            JOIN files f ON f.id = a.file_id
            WHERE 1=1
        """
        params: list[Any] = []
        if category:
            query += " AND a.category = ?"
            params.append(category)
        if bpm_min is not None:
            query += " AND a.bpm >= ?"
            params.append(bpm_min)
        if bpm_max is not None:
            query += " AND a.bpm <= ?"
            params.append(bpm_max)
        if key:
            query += " AND a.key = ?"
            params.append(key)
        if sub_style:
            query += " AND a.sub_style = ?"
            params.append(sub_style)
        query += " ORDER BY a.file_id DESC LIMIT ?"
        params.append(limit)
        return list(self._conn.execute(query, params).fetchall())

    def get_top_plugin_chains(self, limit: int = 10) -> list[sqlite3.Row]:
        return list(
            self._conn.execute(
                """SELECT chain_json, source_plugin, usage_count
                   FROM plugin_chains ORDER BY usage_count DESC LIMIT ?""",
                (limit,),
            ).fetchall()
        )

    def count_files(self) -> dict[str, int]:
        rows = self._conn.execute(
            "SELECT kind, COUNT(*) as c FROM files GROUP BY kind"
        ).fetchall()
        return {row["kind"]: row["c"] for row in rows}

    def get_project_stats(self) -> dict[str, Any]:
        total = self._conn.execute("SELECT COUNT(*) as c FROM projects").fetchone()
        bpm_rows = self._conn.execute(
            """SELECT bpm, COUNT(*) as c FROM projects
               WHERE bpm IS NOT NULL GROUP BY bpm ORDER BY c DESC LIMIT 5"""
        ).fetchall()
        key_rows = self._conn.execute(
            """SELECT key, COUNT(*) as c FROM projects
               WHERE key IS NOT NULL GROUP BY key ORDER BY c DESC LIMIT 5"""
        ).fetchall()
        return {
            "total_projects": total["c"] if total else 0,
            "top_bpms": [(r["bpm"], r["c"]) for r in bpm_rows],
            "top_keys": [(r["key"], r["c"]) for r in key_rows],
        }

    def save_sonic_embedding(self, file_id: int, vector_json: str) -> None:
        import time

        self._conn.execute(
            """INSERT OR REPLACE INTO sonic_embeddings (file_id, vector_json, indexed_at)
               VALUES (?, ?, ?)""",
            (file_id, vector_json, time.time()),
        )
        self._conn.commit()

    def get_sonic_embedding(self, file_id: int) -> sqlite3.Row | None:
        return self._conn.execute(
            "SELECT * FROM sonic_embeddings WHERE file_id=?", (file_id,)
        ).fetchone()

    def get_analyzed_without_embedding(self, limit: int = 1000) -> list[sqlite3.Row]:
        return list(
            self._conn.execute(
                """SELECT a.file_id, a.features_json FROM audio_analysis a
                   LEFT JOIN sonic_embeddings s ON s.file_id = a.file_id
                   WHERE s.file_id IS NULL LIMIT ?""",
                (limit,),
            ).fetchall()
        )

    def get_all_sonic_embeddings(
        self, category: str | None = None
    ) -> list[sqlite3.Row]:
        query = """
            SELECT s.file_id, s.vector_json, f.path,
                   a.category, a.sub_style, a.bpm, a.key
            FROM sonic_embeddings s
            JOIN files f ON f.id = s.file_id
            JOIN audio_analysis a ON a.file_id = s.file_id
        """
        params: list[Any] = []
        if category:
            query += " WHERE a.category = ?"
            params.append(category)
        return list(self._conn.execute(query, params).fetchall())

    def count_embeddings(self) -> int:
        row = self._conn.execute(
            "SELECT COUNT(*) as c FROM sonic_embeddings"
        ).fetchone()
        return int(row["c"]) if row else 0

    def list_projects(
        self,
        daw: str | None = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        query = "SELECT path, daw, bpm, key, genre FROM projects WHERE 1=1"
        params: list[Any] = []
        if daw:
            query += " AND (daw LIKE ? OR path LIKE ?)"
            params.extend([f"%{daw}%", f"%.{daw.lower()}%"])
        query += " ORDER BY analyzed_at DESC LIMIT ?"
        params.append(limit)
        return [dict(row) for row in self._conn.execute(query, params).fetchall()]

    def list_project_files(self, limit: int = 300) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            """SELECT path FROM files
               WHERE kind='project'
               ORDER BY scanned_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]

    def save_reference_link(
        self,
        reference_id: str,
        reference_source: str,
        reference_title: str,
        project_path: str,
        bpm: float | None = None,
        key: str | None = None,
    ) -> int:
        import time

        cur = self._conn.execute(
            """INSERT INTO reference_links
               (reference_id, reference_source, reference_title, project_path, bpm, key, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                reference_id,
                reference_source,
                reference_title,
                project_path,
                bpm,
                key,
                time.time(),
            ),
        )
        self._conn.commit()
        return int(cur.lastrowid)

    def get_reference_links(
        self,
        project_path: str | None = None,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        if project_path:
            rows = self._conn.execute(
                """SELECT * FROM reference_links
                   WHERE project_path=? ORDER BY created_at DESC LIMIT ?""",
                (project_path, limit),
            ).fetchall()
        else:
            rows = self._conn.execute(
                """SELECT * FROM reference_links
                   ORDER BY created_at DESC LIMIT ?""",
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]
