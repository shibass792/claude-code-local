"""Step 7 — Cubase bridge (OSC stub + project recommendations)."""

from __future__ import annotations

import json
import socket
from pathlib import Path
from typing import Any

from music_brain.brain.learner import Brain
from music_brain.database.knowledge_db import KnowledgeDB
from music_brain.matcher.engine import MatcherEngine


class CubaseBridge:
    """
    Integrates with Cubase workflow:
    - On project open: suggest matching basses/leads from library
    - OSC messages for future VST3 plugin communication
    """

    def __init__(
        self,
        db: KnowledgeDB,
        matcher: MatcherEngine,
        brain: Brain,
        osc_host: str = "127.0.0.1",
        osc_port: int = 9000,
        enabled: bool = False,
    ) -> None:
        self.db = db
        self.matcher = matcher
        self.brain = brain
        self.osc_host = osc_host
        self.osc_port = osc_port
        self.enabled = enabled

    def on_project_open(self, project_path: str) -> dict[str, Any]:
        """Step 7 — analyze open project and return recommendations."""
        dna = self.brain.learn_from_project(project_path)
        recommendations: dict[str, Any] = {
            "project": project_path,
            "dna": dna.to_dict(),
            "matching_basses": [],
            "matching_leads": [],
            "matching_kicks": [],
            "message_he": "",
            "message_en": "",
        }

        bpm = dna.bpm
        key = dna.key

        if bpm and key:
            leads = self.matcher.find_by_bpm_key(bpm, key, category="lead", limit=9)
            recommendations["matching_leads"] = [
                {"path": r["path"], "bpm": r["bpm"], "key": r["key"]}
                for r in leads
            ]

        # Find kicks in library near project BPM
        if bpm:
            kicks = self.db.search_by_features(
                category="kick",
                bpm_min=bpm - 3,
                bpm_max=bpm + 3,
                limit=10,
            )
            recommendations["matching_kicks"] = [
                {"path": r["path"], "sub_style": r["sub_style"]} for r in kicks
            ]

            basses = self.db.search_by_features(
                category="bass",
                bpm_min=bpm - 3,
                bpm_max=bpm + 3,
                limit=50,
            )
            # Score basses against first kick if available
            scored_basses: list[dict[str, Any]] = []
            if kicks:
                kick_id = kicks[0]["file_id"]
                matches = self.matcher.find_matches_for_file(
                    int(kick_id), target_category="bass", limit=26
                )
                for m in matches:
                    path_row = self.db._conn.execute(
                        "SELECT path FROM files WHERE id=?", (m.target_id,)
                    ).fetchone()
                    if path_row:
                        scored_basses.append(
                            {
                                "path": path_row["path"],
                                "score": round(m.score, 3),
                                "reasons": m.reasons[:3],
                            }
                        )
            else:
                scored_basses = [
                    {"path": r["path"], "sub_style": r["sub_style"]}
                    for r in basses[:26]
                ]

            recommendations["matching_basses"] = scored_basses

        n_bass = len(recommendations["matching_basses"])
        n_lead = len(recommendations["matching_leads"])
        recommendations["message_he"] = (
            f"מצאתי {n_bass} באסים שמתאימים. "
            f"מצאתי {n_lead} מלודיות מאותו Key."
        )
        recommendations["message_en"] = (
            f"Found {n_bass} matching basses. "
            f"Found {n_lead} melodies in the same key."
        )

        if self.enabled:
            self._send_osc("/musicbrain/recommendations", recommendations)

        return recommendations

    def _send_osc(self, address: str, data: dict[str, Any]) -> None:
        """Minimal OSC-like UDP message for future Cubase plugin."""
        try:
            payload = json.dumps({"address": address, "data": data}).encode("utf-8")
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.sendto(payload, (self.osc_host, self.osc_port))
            sock.close()
        except OSError:
            pass

    def watch_project_folder(self, folder: str) -> None:
        """Register folder for auto-learning when new .cpr files appear."""
        self.db.log_brain_event(
            "cubase_watch",
            {"folder": str(Path(folder).resolve())},
        )
