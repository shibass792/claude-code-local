"""Step 5, 6, 10 — learning from projects, stats, plugin chains, brain mode."""

from __future__ import annotations

import json
from typing import Any

from music_brain.analyzer.project_parser import ProjectParser
from music_brain.database.knowledge_db import KnowledgeDB
from music_brain.models.types import ProjectDNA


class Brain:
    """
    Learns from every project and track:
    - Plugin usage % (Serum 70%, Sylenth 25%, ...)
    - Top BPM / Key (F# 142 BPM)
    - Plugin chains (Serum → Pro-Q3 → Saturn → ...)
  """

    def __init__(self, db: KnowledgeDB) -> None:
        self.db = db
        self.project_parser = ProjectParser()

    def learn_from_project(self, project_path: str) -> ProjectDNA:
        dna = self.project_parser.parse(project_path)
        daw = "Cubase" if project_path.lower().endswith(".cpr") else (
            "Ableton" if project_path.lower().endswith(".als") else "Studio One"
        )
        project_id = self.db.save_project_dna(
            project_path, daw, dna.to_dict()
        )

        for plugin in dna.plugin_list:
            self.db.increment_usage("plugin", plugin)
        for preset in dna.preset_list[:50]:
            self.db.increment_usage("preset", preset)
        if dna.bpm:
            self.db.increment_usage("bpm", str(int(round(dna.bpm))))
        if dna.key:
            self.db.increment_usage("key", dna.key)
        if dna.bass_style:
            self.db.increment_usage("bass_style", dna.bass_style)
        if dna.genre:
            self.db.increment_usage("genre", dna.genre)

        for chain in dna.plugin_chains:
            source = chain[0] if chain else "unknown"
            self.db.record_plugin_chain(project_id, chain, source)

        self.db.log_brain_event(
            "project_learned",
            {"path": project_path, "bpm": dna.bpm, "key": dna.key},
        )
        return dna

    def learn_from_track_created(self, metadata: dict[str, Any]) -> None:
        """Step 10 — called when user creates a new track."""
        self.db.log_brain_event("track_created", metadata)
        for plugin in metadata.get("plugins", []):
            self.db.increment_usage("plugin", plugin)
        if metadata.get("bpm"):
            self.db.increment_usage("bpm", str(int(metadata["bpm"])))
        if metadata.get("key"):
            self.db.increment_usage("key", metadata["key"])

    def get_plugin_usage_report(self) -> dict[str, Any]:
        rows = self.db.get_usage_stats("plugin")
        total = sum(r["count"] for r in rows) or 1
        return {
            "plugins": [
                {
                    "name": r["entity_name"],
                    "count": r["count"],
                    "percent": round(100 * r["count"] / total, 1),
                }
                for r in rows
            ],
            "total_projects": total,
        }

    def get_bpm_key_report(self) -> dict[str, Any]:
        stats = self.db.get_project_stats()
        bpm_rows = self.db.get_usage_stats("bpm")
        key_rows = self.db.get_usage_stats("key")
        total_bpm = sum(r["count"] for r in bpm_rows) or 1
        total_key = sum(r["count"] for r in key_rows) or 1
        return {
            "top_bpms": [
                {"bpm": r["entity_name"], "percent": round(100 * r["count"] / total_bpm, 1)}
                for r in bpm_rows[:5]
            ],
            "top_keys": [
                {"key": r["entity_name"], "percent": round(100 * r["count"] / total_key, 1)}
                for r in key_rows[:5]
            ],
            "project_stats": stats,
        }

    def recommend_plugin_chain(self, source_plugin: str = "Serum") -> list[dict[str, Any]]:
        chains = self.db.get_top_plugin_chains(limit=20)
        recommendations: list[dict[str, Any]] = []
        for row in chains:
            chain = json.loads(row["chain_json"])
            if row["source_plugin"].lower() == source_plugin.lower() or source_plugin in chain:
                recommendations.append(
                    {
                        "chain": chain,
                        "source_plugin": row["source_plugin"],
                        "usage_count": row["usage_count"],
                    }
                )
        recommendations.sort(key=lambda x: x["usage_count"], reverse=True)
        return recommendations[:5]

    def get_workflow_profile(self) -> dict[str, Any]:
        """Summary of how the user builds tracks (Step 10)."""
        plugins = self.get_plugin_usage_report()
        bpm_key = self.get_bpm_key_report()
        chains = self.db.get_top_plugin_chains(limit=3)
        return {
            "plugin_usage": plugins,
            "bpm_and_key": bpm_key,
            "favorite_chains": [
                {
                    "chain": " → ".join(json.loads(c["chain_json"])),
                    "count": c["usage_count"],
                }
                for c in chains
            ],
            "brain_events": self._recent_events(10),
        }

    def _recent_events(self, limit: int) -> list[dict[str, Any]]:
        rows = self.db._conn.execute(
            """SELECT event_type, payload_json, created_at
               FROM brain_events ORDER BY created_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()
        return [
            {
                "type": r["event_type"],
                "payload": json.loads(r["payload_json"] or "{}"),
                "at": r["created_at"],
            }
            for r in rows
        ]
