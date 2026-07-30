"""Stage 10 — Brain Mode.

Every project you finish is an observation. Brain Mode keeps a decaying
preference model of the instruments, effects, chains, keys, tempos and — most
usefully — the *sound* of the material you actually reach for, stored as a
running mean feature vector per role. Old habits fade slowly (each new
observation multiplies existing weights by ``DECAY``), so after a year the model
describes how you work now, not how you worked when you installed it.

Nothing here trains a neural network: the model is a small, inspectable JSON
document you can read, edit or delete. That matters for a tool that claims to
know your taste.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np

from . import dna as dna_mod
from . import learner, matcher
from .config import Config
from .db import Database

BRAIN_KEY = "profile"
DECAY = 0.98
BRAIN_VERSION = 1


def empty_state() -> dict[str, Any]:
    return {
        "version": BRAIN_VERSION,
        "observations": 0,
        "updated_at": 0.0,
        "instruments": {},
        "effects": {},
        "chains": {},
        "keys": {},
        "bpms": {},
        "genres": {},
        "moods": {},
        "subtypes": {},
        "role_vectors": {},
        "timeline": [],
        "liked": {},
    }


def load_state(db: Database) -> dict[str, Any]:
    state = db.get_brain(BRAIN_KEY, None)
    if not isinstance(state, dict):
        return empty_state()
    base = empty_state()
    base.update(state)
    return base


def save_state(db: Database, state: dict[str, Any]) -> None:
    state["updated_at"] = time.time()
    db.set_brain(BRAIN_KEY, state)
    db.commit()


def _bump(table: dict[str, Any], key: str, amount: float = 1.0) -> None:
    if not key:
        return
    table[key] = round(float(table.get(key, 0.0)) + amount, 6)


def _decay(table: dict[str, Any], factor: float = DECAY) -> None:
    for key in list(table.keys()):
        value = float(table[key]) * factor
        if value < 0.01:
            del table[key]
        else:
            table[key] = round(value, 6)


def _update_role_vector(state: dict[str, Any], role: str, vector: Sequence[float]) -> None:
    if not role or not vector:
        return
    store = state["role_vectors"].setdefault(role, {"n": 0, "vector": [0.0] * len(vector)})
    current = np.asarray(store["vector"], dtype=np.float64)
    incoming = np.asarray(list(vector), dtype=np.float64)
    if current.size != incoming.size:
        current = np.zeros_like(incoming)
        store["n"] = 0
    n = int(store["n"])
    updated = (current * n + incoming) / (n + 1)
    store["vector"] = [round(float(v), 6) for v in updated]
    store["n"] = n + 1


# ---------------------------------------------------------------------------
# observation
# ---------------------------------------------------------------------------


def observe_dna(db: Database, state: dict[str, Any], dna: dict[str, Any]) -> dict[str, Any]:
    """Fold one project's DNA into the preference model."""
    for table in ("instruments", "effects", "chains", "keys", "bpms", "genres", "moods"):
        _decay(state[table])

    for name in dna.get("instrument_list", []):
        _bump(state["instruments"], str(name))
    instruments = {str(n).lower() for n in dna.get("instrument_list", [])}
    for name in dna.get("plugin_list", []):
        if str(name).lower() not in instruments:
            _bump(state["effects"], str(name))
    for chain in dna.get("chains", []):
        _bump(state["chains"], str(chain))
    if dna.get("key"):
        _bump(state["keys"], str(dna["key"]))
    if dna.get("bpm"):
        _bump(state["bpms"], f"{float(dna['bpm']):.0f}")
    if dna.get("genre"):
        _bump(state["genres"], str(dna["genre"]))
    if dna.get("mood"):
        _bump(state["moods"], str(dna["mood"]))

    for role in ("kick", "bass", "lead", "pad", "fx", "vocal"):
        subtype = dna.get(f"{role}_type") or dna.get(f"{role}_style")
        if subtype:
            bucket = state["subtypes"].setdefault(role, {})
            _decay(bucket)
            _bump(bucket, str(subtype))

    state["observations"] = int(state.get("observations", 0)) + 1
    return state


def observe_project(db: Database, cfg: Config, project_path: str | Path, refresh: bool = False) -> dict[str, Any]:
    """Learn from one project file."""
    dna = dna_mod.dna_or_build(db, cfg, project_path, refresh=refresh)
    state = load_state(db)
    observe_dna(db, state, dna)

    # ground the role vectors in the actual audio the project used
    for entry in learner.find_project_samples(db, dna.get("sample_list", [])):
        if not entry["file_id"]:
            continue
        features = db.analysis(int(entry["file_id"]))
        if not features:
            continue
        _update_role_vector(state, str(features.get("role") or ""), features.get("vector") or [])

    state["timeline"] = [*state.get("timeline", [])[-999:], {"at": time.time(), "project": dna.get("project"), "fingerprint": dna.get("fingerprint")}]
    save_state(db, state)
    db.log_event("observe", str(project_path), {"fingerprint": dna.get("fingerprint")})
    return {"project": dna.get("project"), "fingerprint": dna.get("fingerprint"), "observations": state["observations"]}


def observe_all(db: Database, cfg: Config, limit: int | None = None, refresh: bool = False) -> dict[str, Any]:
    """Learn from every indexed project, oldest first."""
    rows = list(reversed(db.projects()))
    if limit:
        rows = rows[:limit]
    done, failed = 0, []
    for row in rows:
        try:
            observe_project(db, cfg, str(row["path"]), refresh=refresh)
            done += 1
        except Exception as exc:  # noqa: BLE001
            failed.append({"path": str(row["path"]), "error": f"{type(exc).__name__}: {exc}"})
    return {"observed": done, "failed": len(failed), "failures": failed[:20]}


def like(db: Database, file_id: int, weight: float = 1.0) -> dict[str, Any]:
    """Record that you liked a suggestion, so the taste model moves towards it."""
    features = db.analysis(int(file_id))
    if not features:
        return {"ok": False, "reason": "no analysis for that file"}
    state = load_state(db)
    _bump(state["liked"], str(file_id), weight)
    _update_role_vector(state, str(features.get("role") or ""), features.get("vector") or [])
    if features.get("subtype") and features.get("role"):
        bucket = state["subtypes"].setdefault(str(features["role"]), {})
        _bump(bucket, str(features["subtype"]), weight)
    save_state(db, state)
    db.log_event("like", str(features.get("path") or file_id), {"role": features.get("role")})
    return {"ok": True, "role": features.get("role"), "subtype": features.get("subtype")}


# ---------------------------------------------------------------------------
# reading the model
# ---------------------------------------------------------------------------


def _top(table: dict[str, Any], n: int = 5) -> list[dict[str, Any]]:
    total = sum(float(v) for v in table.values()) or 1.0
    ordered = sorted(table.items(), key=lambda kv: -float(kv[1]))[:n]
    return [{"name": name, "weight": round(float(weight), 3), "share": round(float(weight) / total, 4)} for name, weight in ordered]


@dataclass
class BrainProfile:
    observations: int = 0
    instruments: list[dict[str, Any]] = field(default_factory=list)
    effects: list[dict[str, Any]] = field(default_factory=list)
    chains: list[dict[str, Any]] = field(default_factory=list)
    keys: list[dict[str, Any]] = field(default_factory=list)
    bpms: list[dict[str, Any]] = field(default_factory=list)
    genres: list[dict[str, Any]] = field(default_factory=list)
    subtypes: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    roles_learned: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "observations": self.observations,
            "instruments": self.instruments,
            "effects": self.effects,
            "chains": self.chains,
            "keys": self.keys,
            "bpms": self.bpms,
            "genres": self.genres,
            "subtypes": self.subtypes,
            "roles_learned": self.roles_learned,
        }


def profile(db: Database) -> BrainProfile:
    state = load_state(db)
    return BrainProfile(
        observations=int(state.get("observations", 0)),
        instruments=_top(state["instruments"], 8),
        effects=_top(state["effects"], 10),
        chains=_top(state["chains"], 5),
        keys=_top(state["keys"], 5),
        bpms=_top(state["bpms"], 5),
        genres=_top(state["genres"], 5),
        subtypes={role: _top(table, 4) for role, table in state.get("subtypes", {}).items()},
        roles_learned=sorted(state.get("role_vectors", {}).keys()),
    )


def profile_lines(prof: BrainProfile, lang: str = "en") -> list[str]:
    if lang == "he":
        lines = [f"המנוע למד מ־{prof.observations} פרויקטים"]
        if prof.instruments:
            lines.append("כלים מועדפים: " + ", ".join(f"{i['name']} {i['share']*100:.0f}%" for i in prof.instruments[:4]))
        if prof.keys:
            lines.append("סולמות: " + ", ".join(i["name"] for i in prof.keys[:3]))
        if prof.bpms:
            lines.append("טמפו: " + ", ".join(f"{i['name']} BPM" for i in prof.bpms[:3]))
        if prof.chains:
            lines.append("שרשרת מועדפת: " + prof.chains[0]["name"])
        return lines

    lines = [f"learned from {prof.observations} projects"]
    if prof.instruments:
        lines.append("instruments: " + ", ".join(f"{i['name']} {i['share']*100:.0f}%" for i in prof.instruments[:4]))
    if prof.effects:
        lines.append("effects: " + ", ".join(i["name"] for i in prof.effects[:5]))
    if prof.keys:
        lines.append("keys: " + ", ".join(i["name"] for i in prof.keys[:3]))
    if prof.bpms:
        lines.append("tempos: " + ", ".join(f"{i['name']} BPM" for i in prof.bpms[:3]))
    if prof.chains:
        lines.append("favourite chain: " + prof.chains[0]["name"])
    for role, entries in prof.subtypes.items():
        if entries:
            lines.append(f"{role} style: " + ", ".join(e["name"] for e in entries[:3]))
    return lines


# ---------------------------------------------------------------------------
# suggestions
# ---------------------------------------------------------------------------


def suggest(
    db: Database,
    cfg: Config,
    bpm: float | None = None,
    key: str | None = None,
    limit: int = 5,
) -> dict[str, Any]:
    """Propose a starting point that matches how you usually work."""
    state = load_state(db)
    prof = profile(db)

    target_bpm = bpm or (float(prof.bpms[0]["name"]) if prof.bpms else None)
    target_key = key or (prof.keys[0]["name"] if prof.keys else "")
    instrument = prof.instruments[0]["name"] if prof.instruments else ""
    chain = learner.suggest_chain(db, instrument) if instrument else {"chain": [], "source": "no data"}

    kick_subtype = (prof.subtypes.get("kick") or [{}])[0].get("name", "") if prof.subtypes.get("kick") else ""
    bass_subtype = (prof.subtypes.get("bass") or [{}])[0].get("name", "") if prof.subtypes.get("bass") else ""

    kick_profile: dict[str, Any] = {"role": "kick"}
    if kick_subtype:
        kick_profile["subtype"] = kick_subtype
    if target_bpm:
        kick_profile["bpm"] = target_bpm
    kick_vector = (state.get("role_vectors", {}).get("kick") or {}).get("vector")
    if kick_vector:
        kick_profile["vector"] = kick_vector

    kicks = matcher.match_profile(db, kick_profile, limit=limit)
    pairs: list[dict[str, Any]] = []
    if kicks:
        best_kick = db.analysis(kicks[0].file_id) or {}
        best_kick.setdefault("file_id", kicks[0].file_id)
        partners = matcher.find_partners_for_kick(db, best_kick, role="bass", limit=limit, subtype=bass_subtype or None)
        if not partners and bass_subtype:
            partners = matcher.find_partners_for_kick(db, best_kick, role="bass", limit=limit)
        pairs = [
            {"kick": kicks[0].as_dict(), "bass": partner.as_dict()}
            for partner in partners
        ]

    leads = (
        matcher.find_in_key(db, target_key, role="lead", bpm=target_bpm, limit=limit) if target_key else []
    )

    reasons = [
        f"{prof.observations} projects observed",
        f"you use {instrument or 'no instrument yet'} most often",
        f"your usual tempo is {target_bpm:.0f} BPM" if target_bpm else "no tempo preference learned yet",
        f"your usual key is {target_key}" if target_key else "no key preference learned yet",
    ]
    return {
        "bpm": target_bpm,
        "key": target_key,
        "instrument": instrument,
        "chain": chain.get("chain", []),
        "chain_source": chain.get("source", ""),
        "kick_style": kick_subtype,
        "bass_style": bass_subtype,
        "kicks": [k.as_dict() for k in kicks],
        "kick_bass_pairs": pairs[:limit],
        "leads": [c.as_dict() for c in leads],
        "why": reasons,
    }


def role_reference(db: Database, role: str) -> dict[str, Any]:
    """The learned "sound" of a role, usable as a search target."""
    state = load_state(db)
    store = state.get("role_vectors", {}).get(role)
    if not store:
        return {}
    return {"role": role, "vector": store["vector"], "observations": store["n"]}


def personalized_search(db: Database, role: str, limit: int = 10, extra: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Find library sounds closest to your learned taste for a role."""
    reference = role_reference(db, role)
    if not reference:
        return []
    target: dict[str, Any] = {"role": role, "vector": reference["vector"]}
    if extra:
        target.update(extra)
    return [c.as_dict() for c in matcher.match_profile(db, target, limit=limit)]


def timeline(db: Database, limit: int = 20) -> list[dict[str, Any]]:
    state = load_state(db)
    entries: Iterable[dict[str, Any]] = state.get("timeline", [])[-limit:]
    return [
        {"at": entry.get("at"), "project": entry.get("project"), "fingerprint": entry.get("fingerprint")}
        for entry in entries
    ]
