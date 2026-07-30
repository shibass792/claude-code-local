"""Brain Mode (Stages 5–6, 10) — learn plugin usage, FX chains, keys/BPMs, style."""

from __future__ import annotations

import json
from collections import Counter
from typing import Any

from music_brain.analyzer.project_dna import extract_project_dna
from music_brain.db import KnowledgeDB


def ingest_project(db: KnowledgeDB, path: str) -> dict[str, Any]:
    """Learn from one project — DNA + FX chains + brain event (Stage 10)."""
    # Ensure file row exists
    from pathlib import Path

    p = Path(path)
    st = p.stat() if p.exists() else None
    mtime_ns = int(getattr(st, "st_mtime_ns", (st.st_mtime * 1e9) if st else 0))
    file_id = db.upsert_file(
        {
            "path": str(p),
            "root": str(p.anchor or p.parent),
            "kind": "project",
            "extension": p.suffix.lower(),
            "size_bytes": st.st_size if st else 0,
            "mtime_ns": mtime_ns,
            "role_hint": None,
            "daw": None,
            "plugin": None,
        }
    )
    dna = extract_project_dna(p)
    db.upsert_project_dna(file_id, dna)
    for chain in dna.get("fx_chains") or []:
        db.record_fx_chain(chain["synth"], chain["chain"], source_path=str(p))
    for plugin in dna.get("plugin_list") or []:
        db.brain_event("preset_used", {"plugin": plugin, "project": str(p)})
    db.brain_event(
        "project_opened",
        {
            "path": str(p),
            "bpm": dna.get("bpm"),
            "key": dna.get("key"),
            "genre": dna.get("genre"),
            "plugins": dna.get("plugin_list"),
        },
    )
    return dna


def learn_summary(db: KnowledgeDB) -> dict[str, Any]:
    """Stage 5 — 'מתוך 2600 פרויקטים אתה משתמש 70% Serum…'."""
    plugin_counts = Counter()
    # From files table
    for plugin, n in db.plugin_usage():
        plugin_counts[plugin] += n
    # From project DNA plugin lists
    for dna in db.project_dnas(limit=10_000):
        for p in dna.get("plugin_list") or []:
            plugin_counts[p] += 1
        if dna.get("bpm"):
            pass

    total_plugins = sum(plugin_counts.values()) or 1
    top_plugins = [
        {"plugin": name, "count": count, "pct": round(100.0 * count / total_plugins, 1)}
        for name, count in plugin_counts.most_common(15)
    ]

    # Key / BPM from analyses + DNA
    key_counter: Counter[str] = Counter()
    bpm_counter: Counter[int] = Counter()
    stats = db.key_bpm_stats()
    for k, n in stats["keys"]:
        key_counter[k] += n
    for b, n in stats["bpms"]:
        bpm_counter[int(b)] += n
    for dna in db.project_dnas(limit=10_000):
        if dna.get("key"):
            key_counter[str(dna["key"])] += 3  # weight projects higher
        if dna.get("bpm"):
            bpm_counter[int(round(float(dna["bpm"])))] += 3

    top_keys = key_counter.most_common(5)
    top_bpms = bpm_counter.most_common(5)

    chains = db.top_fx_chains(limit=10)
    best_chain = chains[0] if chains else None

    project_count = sum(1 for _ in db.project_dnas(limit=100_000))
    kinds = db.count_by_kind()

    narrative = _narrative(project_count, top_plugins, top_keys, top_bpms, best_chain)

    return {
        "project_count": project_count,
        "file_counts": kinds,
        "plugins": top_plugins,
        "keys": [{"key": k, "count": n} for k, n in top_keys],
        "bpms": [{"bpm": b, "count": n} for b, n in top_bpms],
        "top_fx_chains": chains,
        "recommended_chain": best_chain,
        "narrative": narrative,
    }


def recommend_chain(db: KnowledgeDB, synth: str) -> dict[str, Any] | None:
    """Stage 6 — best FX chain for a synth based on your history."""
    chains = db.top_fx_chains(synth=synth, limit=1)
    if chains:
        return chains[0]
    # Fuzzy: synth name contained
    for c in db.top_fx_chains(limit=50):
        if synth.lower() in c["synth"].lower():
            return c
    return None


def _narrative(
    project_count: int,
    plugins: list[dict[str, Any]],
    keys: list[tuple[str, int]],
    bpms: list[tuple[int, int]],
    best_chain: dict[str, Any] | None,
) -> str:
    lines = []
    if project_count:
        lines.append(f"מתוך {project_count} פרויקטים שנסרקו:")
    if plugins:
        bits = [f"{p['pct']}% {p['plugin']}" for p in plugins[:3]]
        lines.append("אתה משתמש בעיקר ב־" + ", ".join(bits) + ".")
    if keys and bpms:
        lines.append(f"רוב הפרויקטים שלך ב־{keys[0][0]} / {bpms[0][0]} BPM.")
    elif keys:
        lines.append(f"ה־Key הכי נפוץ אצלך: {keys[0][0]}.")
    elif bpms:
        lines.append(f"ה־BPM הכי נפוץ אצלך: {bpms[0][0]}.")
    if best_chain:
        chain_str = " → ".join(best_chain["chain"])
        lines.append(
            f"השרשרת הכי חזקה שלך ל־{best_chain['synth']}: {chain_str} "
            f"(נראתה {best_chain['count']} פעמים)."
        )
    return "\n".join(lines) if lines else "עדיין אין מספיק דאטה — הרץ scan + analyze + learn."


def record_search(db: KnowledgeDB, query: str, results_n: int) -> None:
    db.brain_event("search", {"query": query, "results": results_n})
