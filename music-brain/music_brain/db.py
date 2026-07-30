"""SQLite knowledge database — local index of files, analyses, DNA, and brain stats."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS files (
    id            INTEGER PRIMARY KEY,
    path          TEXT NOT NULL UNIQUE,
    root          TEXT NOT NULL,
    kind          TEXT NOT NULL,   -- sample|preset|project|plugin_ref|other
    extension     TEXT,
    size_bytes    INTEGER,
    mtime_ns      INTEGER,
    role_hint     TEXT,            -- bass|kick|lead|pad|fx|vocal|...
    daw           TEXT,
    plugin        TEXT,
    scanned_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS analyses (
    file_id           INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    key               TEXT,
    key_confidence    REAL,
    bpm               REAL,
    tempo_confidence  REAL,
    style             TEXT,
    style_family      TEXT,        -- bass|kick|lead|pad|fx|vocal
    duration_sec      REAL,
    sample_rate       INTEGER,
    channels          INTEGER,
    features_json     TEXT,        -- full feature blob
    analyzed_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_dna (
    file_id       INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    bpm           REAL,
    key           TEXT,
    mood          TEXT,
    genre         TEXT,
    bass_style    TEXT,
    lead_style    TEXT,
    fx_style      TEXT,
    kick_type     TEXT,
    bass_type     TEXT,
    energy        REAL,
    mix_density   REAL,
    stereo_width  REAL,
    compression   REAL,
    preset_list   TEXT,            -- JSON array
    plugin_list   TEXT,
    sample_list   TEXT,
    raw_json      TEXT,
    extracted_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fx_chains (
    id            INTEGER PRIMARY KEY,
    source_path   TEXT,
    synth         TEXT NOT NULL,
    chain_json    TEXT NOT NULL,   -- ordered list of plugins
    count         INTEGER NOT NULL DEFAULT 1,
    last_seen     TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(synth, chain_json)
);

CREATE TABLE IF NOT EXISTS brain_events (
    id            INTEGER PRIMARY KEY,
    event_type    TEXT NOT NULL,   -- project_opened|preset_used|chain_seen|search|match
    payload_json  TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scan_state (
    root          TEXT PRIMARY KEY,
    last_scan_at  TEXT,
    file_count    INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_files_kind ON files(kind);
CREATE INDEX IF NOT EXISTS idx_files_role ON files(role_hint);
CREATE INDEX IF NOT EXISTS idx_files_plugin ON files(plugin);
CREATE INDEX IF NOT EXISTS idx_analyses_style ON analyses(style);
CREATE INDEX IF NOT EXISTS idx_analyses_key ON analyses(key);
CREATE INDEX IF NOT EXISTS idx_analyses_bpm ON analyses(bpm);
"""


class KnowledgeDB:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(SCHEMA)

    def close(self) -> None:
        self._conn.close()

    @contextmanager
    def cursor(self) -> Iterator[sqlite3.Cursor]:
        cur = self._conn.cursor()
        try:
            yield cur
            self._conn.commit()
        except Exception:
            self._conn.rollback()
            raise
        finally:
            cur.close()

    # ---- files / incremental scan ----------------------------------------

    def get_file_mtime(self, path: str) -> int | None:
        row = self._conn.execute(
            "SELECT mtime_ns FROM files WHERE path = ?", (path,)
        ).fetchone()
        return int(row["mtime_ns"]) if row else None

    def upsert_file(self, meta: dict[str, Any]) -> int:
        prev = self.get_file_mtime(meta["path"])
        with self.cursor() as cur:
            cur.execute(
                """
                INSERT INTO files (path, root, kind, extension, size_bytes, mtime_ns,
                                   role_hint, daw, plugin, scanned_at)
                VALUES (:path, :root, :kind, :extension, :size_bytes, :mtime_ns,
                        :role_hint, :daw, :plugin, datetime('now'))
                ON CONFLICT(path) DO UPDATE SET
                    root=excluded.root,
                    kind=excluded.kind,
                    extension=excluded.extension,
                    size_bytes=excluded.size_bytes,
                    mtime_ns=excluded.mtime_ns,
                    role_hint=excluded.role_hint,
                    daw=excluded.daw,
                    plugin=excluded.plugin,
                    scanned_at=datetime('now')
                """,
                meta,
            )
            cur.execute("SELECT id FROM files WHERE path = ?", (meta["path"],))
            file_id = int(cur.fetchone()["id"])
            # Invalidate stale analysis when the file bytes changed.
            if prev is not None and prev != meta["mtime_ns"]:
                cur.execute("DELETE FROM analyses WHERE file_id = ?", (file_id,))
                cur.execute("DELETE FROM project_dna WHERE file_id = ?", (file_id,))
            return file_id

    def mark_scan(self, root: str, file_count: int) -> None:
        with self.cursor() as cur:
            cur.execute(
                """
                INSERT INTO scan_state (root, last_scan_at, file_count)
                VALUES (?, datetime('now'), ?)
                ON CONFLICT(root) DO UPDATE SET
                    last_scan_at=datetime('now'),
                    file_count=excluded.file_count
                """,
                (root, file_count),
            )

    def needs_analysis(self, file_id: int, mtime_ns: int) -> bool:
        # Analyses are deleted in upsert_file when mtime changes.
        row = self._conn.execute(
            "SELECT 1 FROM analyses WHERE file_id = ?", (file_id,)
        ).fetchone()
        return row is None

    def upsert_analysis(self, file_id: int, data: dict[str, Any]) -> None:
        features = data.get("features") or {}
        with self.cursor() as cur:
            cur.execute(
                """
                INSERT INTO analyses (
                    file_id, key, key_confidence, bpm, tempo_confidence,
                    style, style_family, duration_sec, sample_rate, channels,
                    features_json, analyzed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(file_id) DO UPDATE SET
                    key=excluded.key,
                    key_confidence=excluded.key_confidence,
                    bpm=excluded.bpm,
                    tempo_confidence=excluded.tempo_confidence,
                    style=excluded.style,
                    style_family=excluded.style_family,
                    duration_sec=excluded.duration_sec,
                    sample_rate=excluded.sample_rate,
                    channels=excluded.channels,
                    features_json=excluded.features_json,
                    analyzed_at=datetime('now')
                """,
                (
                    file_id,
                    data.get("key"),
                    data.get("key_confidence"),
                    data.get("bpm"),
                    data.get("tempo_confidence"),
                    data.get("style"),
                    data.get("style_family"),
                    data.get("duration_sec"),
                    data.get("sample_rate"),
                    data.get("channels"),
                    json.dumps(features),
                ),
            )

    def upsert_project_dna(self, file_id: int, dna: dict[str, Any]) -> None:
        def j(key: str) -> str:
            val = dna.get(key) or []
            return json.dumps(val if isinstance(val, (list, dict)) else list(val))

        with self.cursor() as cur:
            cur.execute(
                """
                INSERT INTO project_dna (
                    file_id, bpm, key, mood, genre, bass_style, lead_style,
                    fx_style, kick_type, bass_type, energy, mix_density,
                    stereo_width, compression, preset_list, plugin_list,
                    sample_list, raw_json, extracted_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(file_id) DO UPDATE SET
                    bpm=excluded.bpm, key=excluded.key, mood=excluded.mood,
                    genre=excluded.genre, bass_style=excluded.bass_style,
                    lead_style=excluded.lead_style, fx_style=excluded.fx_style,
                    kick_type=excluded.kick_type, bass_type=excluded.bass_type,
                    energy=excluded.energy, mix_density=excluded.mix_density,
                    stereo_width=excluded.stereo_width, compression=excluded.compression,
                    preset_list=excluded.preset_list, plugin_list=excluded.plugin_list,
                    sample_list=excluded.sample_list, raw_json=excluded.raw_json,
                    extracted_at=datetime('now')
                """,
                (
                    file_id,
                    dna.get("bpm"),
                    dna.get("key"),
                    dna.get("mood"),
                    dna.get("genre"),
                    dna.get("bass_style"),
                    dna.get("lead_style"),
                    dna.get("fx_style"),
                    dna.get("kick_type"),
                    dna.get("bass_type"),
                    dna.get("energy"),
                    dna.get("mix_density"),
                    dna.get("stereo_width"),
                    dna.get("compression"),
                    j("preset_list"),
                    j("plugin_list"),
                    j("sample_list"),
                    json.dumps(dna),
                ),
            )

    def record_fx_chain(self, synth: str, chain: list[str], source_path: str | None = None) -> None:
        chain_json = json.dumps(chain)
        with self.cursor() as cur:
            cur.execute(
                """
                INSERT INTO fx_chains (source_path, synth, chain_json, count, last_seen)
                VALUES (?, ?, ?, 1, datetime('now'))
                ON CONFLICT(synth, chain_json) DO UPDATE SET
                    count = count + 1,
                    last_seen = datetime('now'),
                    source_path = COALESCE(excluded.source_path, fx_chains.source_path)
                """,
                (source_path, synth, chain_json),
            )

    def brain_event(self, event_type: str, payload: dict[str, Any]) -> None:
        with self.cursor() as cur:
            cur.execute(
                "INSERT INTO brain_events (event_type, payload_json) VALUES (?, ?)",
                (event_type, json.dumps(payload)),
            )

    # ---- queries ---------------------------------------------------------

    def count_by_kind(self) -> dict[str, int]:
        rows = self._conn.execute(
            "SELECT kind, COUNT(*) AS n FROM files GROUP BY kind"
        ).fetchall()
        return {r["kind"]: int(r["n"]) for r in rows}

    def samples_with_analysis(
        self,
        *,
        style_family: str | None = None,
        style: str | None = None,
        key: str | None = None,
        bpm_min: float | None = None,
        bpm_max: float | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        clauses = ["f.kind = 'sample'"]
        params: list[Any] = []
        if style_family:
            clauses.append("a.style_family = ?")
            params.append(style_family)
        if style:
            clauses.append("a.style = ?")
            params.append(style)
        if key:
            clauses.append("a.key = ?")
            params.append(key)
        if bpm_min is not None:
            clauses.append("a.bpm >= ?")
            params.append(bpm_min)
        if bpm_max is not None:
            clauses.append("a.bpm <= ?")
            params.append(bpm_max)
        where = " AND ".join(clauses)
        params.append(limit)
        rows = self._conn.execute(
            f"""
            SELECT f.path, f.role_hint, f.plugin, a.key, a.key_confidence,
                   a.bpm, a.tempo_confidence, a.style, a.style_family,
                   a.features_json, a.duration_sec
            FROM files f
            JOIN analyses a ON a.file_id = f.id
            WHERE {where}
            ORDER BY a.style, a.bpm
            LIMIT ?
            """,
            params,
        ).fetchall()
        out: list[dict[str, Any]] = []
        for r in rows:
            d = dict(r)
            d["features"] = json.loads(d.pop("features_json") or "{}")
            out.append(d)
        return out

    def all_analyses(self, style_family: str | None = None) -> list[dict[str, Any]]:
        return self.samples_with_analysis(style_family=style_family, limit=100_000)

    def plugin_usage(self) -> list[tuple[str, int]]:
        rows = self._conn.execute(
            """
            SELECT plugin, COUNT(*) AS n FROM files
            WHERE plugin IS NOT NULL AND plugin != ''
            GROUP BY plugin ORDER BY n DESC
            """
        ).fetchall()
        return [(r["plugin"], int(r["n"])) for r in rows]

    def key_bpm_stats(self) -> dict[str, Any]:
        keys = self._conn.execute(
            """
            SELECT key, COUNT(*) AS n FROM analyses
            WHERE key IS NOT NULL GROUP BY key ORDER BY n DESC LIMIT 10
            """
        ).fetchall()
        bpms = self._conn.execute(
            """
            SELECT ROUND(bpm) AS bpm, COUNT(*) AS n FROM analyses
            WHERE bpm IS NOT NULL GROUP BY ROUND(bpm) ORDER BY n DESC LIMIT 10
            """
        ).fetchall()
        return {
            "keys": [(r["key"], int(r["n"])) for r in keys],
            "bpms": [(int(r["bpm"]), int(r["n"])) for r in bpms if r["bpm"] is not None],
        }

    def top_fx_chains(self, synth: str | None = None, limit: int = 10) -> list[dict[str, Any]]:
        if synth:
            rows = self._conn.execute(
                """
                SELECT synth, chain_json, count, last_seen FROM fx_chains
                WHERE synth = ? ORDER BY count DESC LIMIT ?
                """,
                (synth, limit),
            ).fetchall()
        else:
            rows = self._conn.execute(
                """
                SELECT synth, chain_json, count, last_seen FROM fx_chains
                ORDER BY count DESC LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [
            {
                "synth": r["synth"],
                "chain": json.loads(r["chain_json"]),
                "count": int(r["count"]),
                "last_seen": r["last_seen"],
            }
            for r in rows
        ]

    def project_dnas(self, limit: int = 100) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            """
            SELECT f.path, d.* FROM project_dna d
            JOIN files f ON f.id = d.file_id
            ORDER BY d.extracted_at DESC LIMIT ?
            """,
            (limit,),
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            for key in ("preset_list", "plugin_list", "sample_list", "raw_json"):
                if d.get(key):
                    try:
                        d[key] = json.loads(d[key])
                    except json.JSONDecodeError:
                        pass
            result.append(d)
        return result

    def search_paths(self, needle: str, limit: int = 50) -> list[dict[str, Any]]:
        like = f"%{needle}%"
        rows = self._conn.execute(
            """
            SELECT f.path, f.kind, f.role_hint, f.plugin, a.style, a.key, a.bpm
            FROM files f
            LEFT JOIN analyses a ON a.file_id = f.id
            WHERE f.path LIKE ? OR IFNULL(a.style,'') LIKE ? OR IFNULL(f.plugin,'') LIKE ?
            ORDER BY f.path LIMIT ?
            """,
            (like, like, like, limit),
        ).fetchall()
        return [dict(r) for r in rows]
