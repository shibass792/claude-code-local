"""Stage 9 — AI search.

You type what you want in the way you would say it out loud:

* ``I want a bass like Astrix``
* ``lead like Ranji``
* ``kick that fits 145 full on``
* ``באס rolling ב-145``

The query is turned into a target profile in two steps. First a deterministic
parser extracts everything that can be read off the text with certainty: role,
subtype, BPM, key, artist or genre reference, energy words. Then — only if a
local LLM is reachable and enabled — the leftover free text is sent to it for
interpretation, and its answer is merged *under* the deterministic result so it
can add information but never overwrite a number you typed.

When the referenced artist's name appears in your own library, their files are
used as an acoustic reference vector, so "like Astrix" is grounded in sounds you
actually own rather than in a hard-coded description.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

from . import matcher
from .config import Config
from .db import Database
from .taxonomy import HEBREW_ROLE_MAP, ROLE_KEYWORDS, SUBTYPE_KEYWORDS, bpm_from_name, key_from_name, normalize_text

DATA_DIR = Path(__file__).parent / "data"

ENERGY_WORDS = {
    "chill": 0.25,
    "ambient": 0.15,
    "soft": 0.3,
    "warm": 0.4,
    "groovy": 0.55,
    "driving": 0.7,
    "hard": 0.85,
    "peak time": 0.85,
    "peaktime": 0.85,
    "aggressive": 0.9,
    "banging": 0.9,
    "רגוע": 0.25,
    "חזק": 0.85,
    "אגרסיבי": 0.9,
}

LIKE_PATTERNS = (
    re.compile(r"\blike\s+([a-z0-9'&\.\- ]{2,30})", re.IGNORECASE),
    re.compile(r"\bכמו\s+([^\d,\.]{2,30})"),
    re.compile(r"\bsounds?\s+like\s+([a-z0-9'&\.\- ]{2,30})", re.IGNORECASE),
)


@lru_cache(maxsize=1)
def reference_data() -> dict[str, Any]:
    path = DATA_DIR / "artists.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"artists": [], "genres": []}


@dataclass
class QueryPlan:
    query: str = ""
    role: str = ""
    subtype: str = ""
    bpm: float | None = None
    key: str = ""
    energy: float | None = None
    centroid_hz: float | None = None
    reference: str = ""
    reference_kind: str = ""
    tags: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    vector: list[float] = field(default_factory=list)

    def profile(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if self.role:
            out["role"] = self.role
        if self.subtype:
            out["subtype"] = self.subtype
        if self.bpm:
            out["bpm"] = self.bpm
        if self.key:
            out["key"] = self.key
        if self.energy is not None:
            out["energy"] = self.energy
        if self.centroid_hz:
            out["centroid_hz"] = self.centroid_hz
        if self.tags:
            out["tags"] = self.tags
        if self.vector:
            out["vector"] = self.vector
        return out

    def as_dict(self) -> dict[str, Any]:
        return {
            "query": self.query,
            "role": self.role,
            "subtype": self.subtype,
            "bpm": self.bpm,
            "key": self.key,
            "energy": self.energy,
            "centroid_hz": self.centroid_hz,
            "reference": self.reference,
            "reference_kind": self.reference_kind,
            "tags": self.tags,
            "notes": self.notes,
            "has_reference_vector": bool(self.vector),
        }


# ---------------------------------------------------------------------------
# deterministic parsing
# ---------------------------------------------------------------------------


def _match_reference(text: str) -> tuple[dict[str, Any] | None, str]:
    """Find an artist or genre reference in the query."""
    data = reference_data()
    lowered = normalize_text(text)
    explicit = ""
    for pattern in LIKE_PATTERNS:
        found = pattern.search(text)
        if found:
            explicit = found.group(1).strip().lower()
            break

    def lookup(pool: list[dict[str, Any]], kind: str) -> tuple[dict[str, Any] | None, str]:
        best: tuple[dict[str, Any], int] | None = None
        for entry in pool:
            names = [str(entry.get("name", "")).lower(), *[str(a).lower() for a in entry.get("aliases", [])]]
            for name in names:
                if not name:
                    continue
                if explicit and (name in explicit or explicit in name):
                    return entry, kind
                if name in lowered and (best is None or len(name) > best[1]):
                    best = (entry, len(name))
        return (best[0], kind) if best else (None, "")

    entry, kind = lookup(list(data.get("artists", [])), "artist")
    if entry:
        return entry, kind
    return lookup(list(data.get("genres", [])), "genre")


def _role_from_text(text: str) -> str:
    lowered = normalize_text(text)
    for hebrew, role in HEBREW_ROLE_MAP.items():
        if hebrew in text:
            return role
    best = ("", 0)
    for role, tokens in ROLE_KEYWORDS.items():
        for token in tokens:
            if re.search(rf"\b{re.escape(token)}\b", lowered) and len(token) > best[1]:
                best = (role, len(token))
    return best[0]


def _subtype_from_text(role: str, text: str) -> str:
    lowered = normalize_text(text)
    table = SUBTYPE_KEYWORDS.get(role, {})
    best = ("", 0)
    for subtype, tokens in table.items():
        for token in tokens:
            if token in lowered and len(token) > best[1]:
                best = (subtype, len(token))
    return best[0]


def _energy_from_text(text: str) -> float | None:
    lowered = normalize_text(text)
    for word, value in ENERGY_WORDS.items():
        if word in lowered or word in text:
            return value
    return None


def reference_vector(db: Database, name: str, role: str | None = None) -> list[float]:
    """Mean similarity vector of library files whose path mentions ``name``."""
    if not name:
        return []
    like = f"%{name.lower().replace(' ', '%')}%"
    sql = """SELECT a.features FROM analyses a JOIN files f ON f.id = a.file_id
             WHERE f.missing = 0 AND LOWER(f.path) LIKE ?"""
    args: list[Any] = [like]
    if role:
        sql += " AND a.role = ?"
        args.append(role)
    sql += " LIMIT 200"
    vectors: list[list[float]] = []
    for row in db.conn.execute(sql, args):
        try:
            features = json.loads(str(row["features"]))
        except json.JSONDecodeError:
            continue
        vector = features.get("vector")
        if vector:
            vectors.append([float(v) for v in vector])
    if not vectors:
        return []
    return [round(float(v), 6) for v in np.mean(np.asarray(vectors), axis=0)]


def parse_query(query: str, db: Database | None = None) -> QueryPlan:
    """Turn free text into a target profile, deterministically."""
    plan = QueryPlan(query=query)
    plan.role = _role_from_text(query)
    if plan.role:
        plan.subtype = _subtype_from_text(plan.role, query)

    bpm = bpm_from_name(query)
    if bpm:
        plan.bpm = bpm
    key = key_from_name(query)
    if key:
        plan.key = key
    energy = _energy_from_text(query)
    if energy is not None:
        plan.energy = energy

    entry, kind = _match_reference(query)
    if entry:
        plan.reference = str(entry.get("name") or "")
        plan.reference_kind = kind
        plan.notes.append(f"matched {kind} reference '{plan.reference}'")
        if plan.bpm is None and entry.get("bpm"):
            low, high = entry["bpm"]
            plan.bpm = float((low + high) / 2.0)
            plan.notes.append(f"tempo target {plan.bpm:.0f} BPM taken from the reference profile")
        if plan.energy is None and entry.get("energy") is not None:
            plan.energy = float(entry["energy"])
        if not plan.centroid_hz and entry.get("centroid_hz"):
            plan.centroid_hz = float(entry["centroid_hz"])
        if not plan.subtype and plan.role and entry.get(plan.role):
            plan.subtype = str(entry[plan.role])
            plan.notes.append(f"style target '{plan.subtype}' taken from the reference profile")
        plan.tags = [str(t) for t in entry.get("tags", [])]

        if db is not None:
            vector = reference_vector(db, plan.reference, plan.role or None)
            if vector:
                plan.vector = vector
                plan.notes.append(f"reference vector built from files in your library mentioning '{plan.reference}'")
    return plan


# ---------------------------------------------------------------------------
# optional local LLM assist
# ---------------------------------------------------------------------------

LLM_SYSTEM_PROMPT = (
    "You translate a music producer's request into JSON. "
    'Reply with ONLY a JSON object using these optional keys: '
    '{"role": one of kick|bass|lead|pad|fx|vocal|perc|chord, '
    '"subtype": short style word, "bpm": number, "key": like "F# minor", '
    '"energy": 0..1, "tags": [words]}. No prose, no code fences.'
)


def llm_refine(query: str, cfg: Config, timeout: float | None = None) -> dict[str, Any]:
    """Ask the local model (via the repo's router/proxy) to fill in the gaps."""
    payload = {
        "model": cfg.llm_model,
        "max_tokens": 300,
        "temperature": 0.1,
        "messages": [
            {"role": "system", "content": LLM_SYSTEM_PROMPT},
            {"role": "user", "content": query},
        ],
    }
    request = urllib.request.Request(
        cfg.llm_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout or cfg.llm_timeout) as response:
            body = json.loads(response.read().decode("utf-8", "ignore"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return {}

    text = ""
    choices = body.get("choices") or []
    if choices:
        message = choices[0].get("message") or {}
        text = str(message.get("content") or choices[0].get("text") or "")
    elif isinstance(body.get("content"), list):  # Anthropic-style proxy response
        text = "".join(str(part.get("text") or "") for part in body["content"])
    if not text:
        return {}
    found = re.search(r"\{.*\}", text, re.DOTALL)
    if not found:
        return {}
    try:
        parsed = json.loads(found.group())
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def merge_llm(plan: QueryPlan, extra: dict[str, Any]) -> QueryPlan:
    """Fill only the fields the deterministic parser left empty."""
    if not extra:
        return plan
    filled: list[str] = []
    if not plan.role and isinstance(extra.get("role"), str):
        plan.role = extra["role"].strip().lower()
        filled.append("role")
    if not plan.subtype and isinstance(extra.get("subtype"), str):
        plan.subtype = extra["subtype"].strip().lower()
        filled.append("subtype")
    if plan.bpm is None and isinstance(extra.get("bpm"), (int, float)):
        value = float(extra["bpm"])
        if 40 <= value <= 220:
            plan.bpm = value
            filled.append("bpm")
    if not plan.key and isinstance(extra.get("key"), str):
        plan.key = extra["key"].strip()
        filled.append("key")
    if plan.energy is None and isinstance(extra.get("energy"), (int, float)):
        plan.energy = float(min(max(float(extra["energy"]), 0.0), 1.0))
        filled.append("energy")
    if isinstance(extra.get("tags"), list):
        plan.tags = list({*plan.tags, *[str(t).lower() for t in extra["tags"][:8]]})
    if filled:
        plan.notes.append("local model filled in: " + ", ".join(filled))
    return plan


# ---------------------------------------------------------------------------
# search
# ---------------------------------------------------------------------------


def search(
    db: Database,
    cfg: Config,
    query: str,
    limit: int = 25,
    use_llm: bool = False,
) -> dict[str, Any]:
    """Run an AI-search query against the analysed library."""
    plan = parse_query(query, db)
    if use_llm:
        plan = merge_llm(plan, llm_refine(query, cfg))
        if plan.reference and not plan.vector:
            vector = reference_vector(db, plan.reference, plan.role or None)
            if vector:
                plan.vector = vector

    profile = plan.profile()
    candidates = matcher.match_profile(db, profile, limit=limit)
    return {
        "plan": plan.as_dict(),
        "profile": {k: v for k, v in profile.items() if k != "vector"},
        "results": [c.as_dict() for c in candidates],
        "count": len(candidates),
    }
