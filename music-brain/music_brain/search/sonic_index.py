"""Index and query sonic fingerprint embeddings."""

from __future__ import annotations

import json
from typing import Any

import numpy as np

from music_brain.database.knowledge_db import KnowledgeDB
from music_brain.search.sonic_embeddings import (
    cosine_similarity,
    features_to_vector,
    style_prototype_vector,
    vector_from_json,
    vector_to_json,
)


class SonicIndex:
    def __init__(self, db: KnowledgeDB) -> None:
        self.db = db

    def index_file(self, file_id: int, features: dict[str, Any]) -> None:
        vec = features_to_vector(features)
        self.db.save_sonic_embedding(file_id, vector_to_json(vec))

    def index_all(self, limit: int = 10000) -> int:
        rows = self.db.get_analyzed_without_embedding(limit=limit)
        count = 0
        for row in rows:
            features = json.loads(row["features_json"])
            self.index_file(int(row["file_id"]), features)
            count += 1
        return count

    def find_similar_to_file(
        self,
        file_id: int,
        category: str | None = None,
        limit: int = 30,
    ) -> list[dict[str, Any]]:
        source = self.db.get_sonic_embedding(file_id)
        if source is None:
            return []
        return self._search_vector(
            vector_from_json(source["vector_json"]),
            category=category,
            exclude_id=file_id,
            limit=limit,
        )

    def find_similar_to_style(
        self,
        style_key: str,
        category: str | None = None,
        limit: int = 30,
    ) -> list[dict[str, Any]]:
        proto = style_prototype_vector(style_key)
        if proto is None:
            return []
        ref = __import__(
            "music_brain.search.ai_search", fromlist=["STYLE_REFERENCES"]
        ).STYLE_REFERENCES.get(style_key.lower(), {})
        if not category:
            category = ref.get("category")
        return self._search_vector(proto, category=category, limit=limit)

    def _search_vector(
        self,
        query_vec: np.ndarray,
        category: str | None = None,
        exclude_id: int | None = None,
        limit: int = 30,
    ) -> list[dict[str, Any]]:
        rows = self.db.get_all_sonic_embeddings(category=category)
        scored: list[dict[str, Any]] = []
        for row in rows:
            if exclude_id and row["file_id"] == exclude_id:
                continue
            vec = vector_from_json(row["vector_json"])
            sim = cosine_similarity(query_vec, vec)
            scored.append({
                "file_id": row["file_id"],
                "path": row["path"],
                "category": row["category"],
                "sub_style": row["sub_style"],
                "bpm": row["bpm"],
                "key": row["key"],
                "score": sim,
                "reasons": [f"Sonic similarity: {sim:.0%}"],
            })
        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:limit]
