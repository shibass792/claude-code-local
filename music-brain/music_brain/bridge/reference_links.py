"""Persist links between reference tracks (YouTube/local) and DAW projects."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from music_brain.database.knowledge_db import KnowledgeDB


class ReferenceLinks:
    def __init__(
        self,
        db: KnowledgeDB,
        sidecar_dir: str | Path = "data/project_links",
    ) -> None:
        self.db = db
        self.sidecar_dir = Path(sidecar_dir)

    def link(
        self,
        reference_id: str,
        reference_source: str,
        reference_title: str,
        project_path: str,
        bpm: float | None = None,
        key: str | None = None,
    ) -> dict[str, Any]:
        project = Path(project_path).resolve()
        link_id = self.db.save_reference_link(
            reference_id=reference_id,
            reference_source=reference_source,
            reference_title=reference_title,
            project_path=str(project),
            bpm=bpm,
            key=key,
        )
        sidecar = self._write_sidecar(
            project,
            {
                "reference_id": reference_id,
                "reference_source": reference_source,
                "reference_title": reference_title,
                "bpm": bpm,
                "key": key,
                "linked_at": time.time(),
            },
        )
        self.db.log_brain_event(
            "reference_linked",
            {
                "link_id": link_id,
                "reference_id": reference_id,
                "project_path": str(project),
                "sidecar": str(sidecar),
            },
        )
        return {
            "ok": True,
            "link_id": link_id,
            "reference_id": reference_id,
            "project_path": str(project),
            "sidecar_path": str(sidecar),
            "message_he": "הטראק והפרויקט שויכו בהצלחה",
        }

    def list_for_project(self, project_path: str) -> list[dict[str, Any]]:
        return self.db.get_reference_links(project_path=project_path)

    def list_recent(self, limit: int = 20) -> list[dict[str, Any]]:
        return self.db.get_reference_links(limit=limit)

    def _write_sidecar(self, project_path: Path, payload: dict[str, Any]) -> Path:
        self.sidecar_dir.mkdir(parents=True, exist_ok=True)
        sidecar = self.sidecar_dir / f"{project_path.stem}.musicbrain.json"
        existing: dict[str, Any] = {"links": []}
        if sidecar.is_file():
            try:
                existing = json.loads(sidecar.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                existing = {"links": []}
        links = existing.setdefault("links", [])
        links = [l for l in links if l.get("reference_id") != payload.get("reference_id")]
        links.insert(0, payload)
        existing["links"] = links[:50]
        existing["project_path"] = str(project_path)
        sidecar.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
        return sidecar
