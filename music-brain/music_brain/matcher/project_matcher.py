"""Match DAW projects (.cpr, .als, …) to a reference track profile."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from music_brain.database.knowledge_db import KnowledgeDB
from music_brain.matcher.engine import _bpm_score, _key_distance

DAW_LABELS = {
    ".cpr": "Cubase",
    ".npr": "Nuendo",
    ".als": "Ableton",
    ".song": "Studio One",
    ".logicx": "Logic",
    ".rpp": "Reaper",
}


def _normalize_title(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9\u0590-\u05ff]+", " ", text)
    return " ".join(text.split())


def _title_similarity(reference_title: str, project_path: str) -> float:
    ref_tokens = set(_normalize_title(reference_title).split())
    proj_tokens = set(_normalize_title(Path(project_path).stem).split())
    if not ref_tokens or not proj_tokens:
        return 0.0
    overlap = len(ref_tokens & proj_tokens)
    return overlap / max(len(ref_tokens), len(proj_tokens))


class ProjectMatcher:
    def __init__(self, db: KnowledgeDB, bpm_tolerance: float = 4.0) -> None:
        self.db = db
        self.bpm_tolerance = bpm_tolerance

    def find_matches(
        self,
        bpm: float | None = None,
        key: str | None = None,
        title: str | None = None,
        daw: str | None = None,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        rows = self.db.list_projects(daw=daw, limit=500)
        if not rows and bpm is None and not title:
            rows = self._projects_from_files_table(daw=daw)

        scored: list[dict[str, Any]] = []
        for row in rows:
            project_path = row["path"]
            proj_bpm = row["bpm"]
            proj_key = row["key"]
            ext = Path(project_path).suffix.lower()
            daw_name = row.get("daw") or DAW_LABELS.get(ext, ext.lstrip(".").upper())

            reasons: list[str] = []
            score = 0.0

            if bpm is not None and proj_bpm is not None:
                bpm_s = _bpm_score(bpm, float(proj_bpm), tolerance=self.bpm_tolerance)
                score += 0.45 * bpm_s
                reasons.append(f"BPM: {proj_bpm} ({bpm_s:.0%})")
            elif bpm is not None:
                score += 0.1
                reasons.append("BPM לא ידוע בפרויקט")

            if key and proj_key:
                key_s = _key_distance(key, proj_key)
                score += 0.35 * key_s
                reasons.append(f"Key: {proj_key} ({key_s:.0%})")
            elif key:
                score += 0.05

            if title:
                title_s = _title_similarity(title, project_path)
                if title_s > 0:
                    score += 0.20 * title_s
                    reasons.append(f"שם דומה ({title_s:.0%})")

            if score <= 0 and not title:
                score = 0.15
                reasons.append("פרויקט בספרייה")

            scored.append(
                {
                    "project_path": project_path,
                    "project_name": Path(project_path).name,
                    "daw": daw_name,
                    "extension": ext,
                    "bpm": proj_bpm,
                    "key": proj_key,
                    "genre": row.get("genre"),
                    "score": round(min(score, 1.0), 3),
                    "reasons": reasons,
                    "open_url": f"/api/match/open?project={self._enc(project_path)}",
                }
            )

        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:limit]

    def _projects_from_files_table(self, daw: str | None = None) -> list[dict[str, Any]]:
        rows = self.db.list_project_files(limit=300)
        out: list[dict[str, Any]] = []
        for row in rows:
            ext = Path(row["path"]).suffix.lower()
            daw_name = DAW_LABELS.get(ext, "DAW")
            if daw and daw.lower() not in daw_name.lower():
                continue
            out.append(
                {
                    "path": row["path"],
                    "daw": daw_name,
                    "bpm": None,
                    "key": None,
                    "genre": None,
                }
            )
        return out

    @staticmethod
    def _enc(path: str) -> str:
        from urllib.parse import quote

        return quote(path, safe="")
