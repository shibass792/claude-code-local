"""Stages 5 and 6 — learning your habits from your own projects.

Stage 5 answers questions of the form "out of 2,600 projects, how much do I
actually use Serum?" and "what key and tempo do I default to?". Stage 6 learns
the signal chains: which effect follows which, and which full chain you reach
for most often after a given instrument.
"""

from __future__ import annotations

import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable

from . import projects as project_parsers
from .config import Config
from .db import Database

ProgressFn = Callable[[str, int, int], None]

INSTRUMENT_KINDS = ("instrument", "sampler", "drum")


# ---------------------------------------------------------------------------
# ingestion
# ---------------------------------------------------------------------------


def ingest_projects(
    db: Database,
    cfg: Config,
    limit: int | None = None,
    progress: ProgressFn | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """Parse every project file that is new or changed since the last run."""
    rows = db.files(kind="project")
    if not force:
        rows = [row for row in rows if _needs_parse(db, row)]
    if limit:
        rows = rows[:limit]

    parsed = 0
    failures: list[dict[str, str]] = []
    started = time.time()
    for index, row in enumerate(rows, start=1):
        path = str(row["path"])
        try:
            result = project_parsers.parse(path)
            if result is None:
                continue
            db.save_project(
                file_id=int(row["id"]),
                name=result.name,
                daw=result.daw or str(row["daw"] or ""),
                bpm=result.bpm,
                key=result.musical_key,
                modified_at=int(row["mtime_ns"]) / 1e9,
                items=result.items(),
                chains=result.chains,
            )
            parsed += 1
        except Exception as exc:  # noqa: BLE001 - a corrupt project must not stop the run
            failures.append({"path": path, "error": f"{type(exc).__name__}: {exc}"})
        if progress:
            progress(path, index, len(rows))
        if index % 25 == 0:
            db.commit()
    db.commit()
    return {
        "total": len(rows),
        "parsed": parsed,
        "failed": len(failures),
        "failures": failures[:25],
        "elapsed": round(time.time() - started, 2),
    }


def _needs_parse(db: Database, row: Any) -> bool:
    """Re-parse only when the file's own mtime differs from the stored one.

    Comparing the file's mtime against the time we parsed it would be fragile:
    filesystem timestamps and ``time.time()`` can be milliseconds apart, which
    is enough to miss a save that happened right after a parse.
    """
    existing = db.conn.execute(
        "SELECT modified_at FROM projects WHERE file_id=?", (int(row["id"]),)
    ).fetchone()
    if existing is None or existing["modified_at"] is None:
        return True
    return abs(float(existing["modified_at"]) - int(row["mtime_ns"]) / 1e9) > 1e-6


# ---------------------------------------------------------------------------
# stage 5 — usage statistics
# ---------------------------------------------------------------------------


@dataclass
class UsageStats:
    projects: int = 0
    instruments: list[dict[str, Any]] = field(default_factory=list)
    effects: list[dict[str, Any]] = field(default_factory=list)
    presets: list[dict[str, Any]] = field(default_factory=list)
    keys: list[dict[str, Any]] = field(default_factory=list)
    tempos: list[dict[str, Any]] = field(default_factory=list)
    daws: list[dict[str, Any]] = field(default_factory=list)
    dominant_key: str = ""
    dominant_bpm: float = 0.0
    median_bpm: float = 0.0

    def as_dict(self) -> dict[str, Any]:
        return {
            "projects": self.projects,
            "instruments": self.instruments,
            "effects": self.effects,
            "presets": self.presets,
            "keys": self.keys,
            "tempos": self.tempos,
            "daws": self.daws,
            "dominant_key": self.dominant_key,
            "dominant_bpm": self.dominant_bpm,
            "median_bpm": self.median_bpm,
        }


def _share_table(counter: Counter[str], total: int, top: int = 20) -> list[dict[str, Any]]:
    return [
        {"name": name, "projects": count, "share": round(count / total, 4) if total else 0.0}
        for name, count in counter.most_common(top)
    ]


def usage_stats(db: Database, top: int = 20) -> UsageStats:
    """Stage 5: what you actually use, as a share of your projects."""
    project_rows = db.projects()
    stats = UsageStats(projects=len(project_rows))
    if not project_rows:
        return stats

    instrument_counter: Counter[str] = Counter()
    effect_counter: Counter[str] = Counter()
    preset_counter: Counter[str] = Counter()
    key_counter: Counter[str] = Counter()
    bpm_counter: Counter[float] = Counter()
    daw_counter: Counter[str] = Counter()
    bpms: list[float] = []

    for row in project_rows:
        project_id = int(row["id"])
        if row["daw"]:
            daw_counter[str(row["daw"])] += 1
        if row["musical_key"]:
            key_counter[str(row["musical_key"])] += 1
        if row["bpm"]:
            value = round(float(row["bpm"]), 1)
            bpm_counter[value] += 1
            bpms.append(value)

        seen_instruments: set[str] = set()
        seen_effects: set[str] = set()
        for item in db.project_items(project_id):
            name = str(item["name"])
            kind = str(item["kind"])
            if kind == "instrument":
                seen_instruments.add(name)
            elif kind == "plugin":
                known = project_parsers.canonical_tool(name)
                if known and known[1] in INSTRUMENT_KINDS:
                    seen_instruments.add(known[0])
                else:
                    seen_effects.add(name)
            elif kind == "preset":
                preset_counter[name] += 1
        instrument_counter.update(seen_instruments)
        effect_counter.update(seen_effects)

    total = len(project_rows)
    stats.instruments = _share_table(instrument_counter, total, top)
    stats.effects = _share_table(effect_counter, total, top)
    stats.presets = _share_table(preset_counter, total, top)
    stats.keys = _share_table(key_counter, total, top)
    stats.daws = _share_table(daw_counter, total, top)
    stats.tempos = [
        {"bpm": bpm, "projects": count, "share": round(count / total, 4)}
        for bpm, count in bpm_counter.most_common(top)
    ]
    if key_counter:
        stats.dominant_key = key_counter.most_common(1)[0][0]
    if bpm_counter:
        stats.dominant_bpm = float(bpm_counter.most_common(1)[0][0])
    if bpms:
        ordered = sorted(bpms)
        stats.median_bpm = float(ordered[len(ordered) // 2])
    return stats


def instrument_share(db: Database) -> list[dict[str, Any]]:
    """Instrument usage renormalised so the shares add up to 100 %.

    This is the "70 % Serum, 25 % Sylenth, 5 % Vital" view.
    """
    stats = usage_stats(db, top=100)
    total = sum(entry["projects"] for entry in stats.instruments)
    if not total:
        return []
    return [
        {"name": entry["name"], "projects": entry["projects"], "share": round(entry["projects"] / total, 4)}
        for entry in stats.instruments
    ]


# ---------------------------------------------------------------------------
# stage 6 — chains
# ---------------------------------------------------------------------------


@dataclass
class ChainStats:
    chains: list[dict[str, Any]] = field(default_factory=list)
    transitions: list[dict[str, Any]] = field(default_factory=list)
    per_instrument: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    recommended: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "chains": self.chains,
            "transitions": self.transitions,
            "per_instrument": self.per_instrument,
            "recommended": self.recommended,
        }


def chain_stats(db: Database, top: int = 20, half_life_days: float = 365.0) -> ChainStats:
    """Stage 6: which chains you build, weighted towards recent projects."""
    rows = list(
        db.conn.execute(
            """SELECT c.signature, c.length, c.track, p.modified_at
               FROM chains c JOIN projects p ON p.id = c.project_id
               JOIN files f ON f.id = p.file_id WHERE f.missing = 0"""
        )
    )
    stats = ChainStats()
    if not rows:
        return stats

    now = time.time()
    weights: dict[str, float] = defaultdict(float)
    counts: Counter[str] = Counter()
    transitions: Counter[tuple[str, str]] = Counter()

    for row in rows:
        signature = str(row["signature"])
        counts[signature] += 1
        age_days = max((now - float(row["modified_at"] or now)) / 86400.0, 0.0)
        recency = 0.5 ** (age_days / half_life_days) if half_life_days > 0 else 1.0
        weights[signature] += 1.0 + recency
        steps = [s.strip() for s in signature.split(">")]
        for a, b in zip(steps[:-1], steps[1:]):
            transitions[(a, b)] += 1

    total = sum(counts.values())
    stats.chains = [
        {
            "chain": signature,
            "uses": counts[signature],
            "share": round(counts[signature] / total, 4),
            "weight": round(weights[signature], 3),
            "length": len(signature.split(">")),
        }
        for signature in sorted(counts, key=lambda s: -weights[s])[:top]
    ]
    stats.transitions = [
        {"from": a, "to": b, "count": count, "probability": round(count / max(sum(v for (x, _y), v in transitions.items() if x == a), 1), 4)}
        for (a, b), count in transitions.most_common(top * 2)
    ]

    per_instrument: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entry in stats.chains:
        head = entry["chain"].split(">")[0].strip()
        per_instrument[head].append(entry)
    stats.per_instrument = {k: v[:5] for k, v in per_instrument.items()}
    if stats.chains:
        best = stats.chains[0]
        stats.recommended = {
            "chain": best["chain"],
            "uses": best["uses"],
            "why": f"you built this chain in {best['uses']} tracks and used it recently",
        }
    return stats


def suggest_chain(db: Database, instrument: str, max_length: int = 6) -> dict[str, Any]:
    """Build the chain you would most likely use after ``instrument``.

    If you already have a frequent full chain starting with that instrument, it
    is returned as-is; otherwise the chain is grown one step at a time from the
    transition table.
    """
    stats = chain_stats(db, top=200)
    lowered = instrument.strip().lower()
    for entry in stats.chains:
        if entry["chain"].split(">")[0].strip().lower() == lowered:
            return {
                "instrument": instrument,
                "chain": [step.strip() for step in entry["chain"].split(">")],
                "source": "observed chain",
                "uses": entry["uses"],
            }

    transitions: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for entry in stats.transitions:
        transitions[str(entry["from"]).lower()].append((str(entry["to"]), int(entry["count"])))

    chain = [instrument]
    current = lowered
    while len(chain) < max_length:
        options = sorted(transitions.get(current, []), key=lambda kv: -kv[1])
        nxt = next((name for name, _c in options if name.lower() not in {c.lower() for c in chain}), None)
        if not nxt:
            break
        chain.append(nxt)
        current = nxt.lower()
    return {
        "instrument": instrument,
        "chain": chain,
        "source": "grown from transition probabilities" if len(chain) > 1 else "no data",
        "uses": 0,
    }


# ---------------------------------------------------------------------------
# reporting
# ---------------------------------------------------------------------------


def summary(db: Database) -> dict[str, Any]:
    usage = usage_stats(db)
    chains = chain_stats(db)
    return {
        "usage": usage.as_dict(),
        "instrument_share": instrument_share(db),
        "chains": chains.as_dict(),
        "library": db.counts(),
    }


def report_lines(data: dict[str, Any], lang: str = "en") -> list[str]:
    """Human-readable summary lines, English or Hebrew."""
    usage = data.get("usage", {})
    share = data.get("instrument_share", [])
    chains = data.get("chains", {})
    projects = usage.get("projects", 0)
    lines: list[str] = []

    if lang == "he":
        lines.append(f"נסרקו {projects} פרויקטים")
        if share:
            top = ", ".join(f"{entry['share']*100:.0f}% {entry['name']}" for entry in share[:4])
            lines.append(f"שימוש בכלים: {top}")
        if usage.get("dominant_key") and usage.get("dominant_bpm"):
            lines.append(f"רוב הפרויקטים שלך ב־{usage['dominant_key']} ב־{usage['dominant_bpm']:.0f} BPM")
        if chains.get("recommended"):
            lines.append(f"השרשרת המומלצת בשבילך: {chains['recommended']['chain']}")
        return lines

    lines.append(f"{projects} projects indexed")
    if share:
        top = ", ".join(f"{entry['share']*100:.0f}% {entry['name']}" for entry in share[:4])
        lines.append(f"instrument usage: {top}")
    if usage.get("dominant_key"):
        bpm = usage.get("dominant_bpm") or usage.get("median_bpm") or 0
        lines.append(f"most of your projects are in {usage['dominant_key']} at {bpm:.0f} BPM")
    if chains.get("recommended"):
        lines.append(f"your go-to chain: {chains['recommended']['chain']}")
    return lines


def preset_library_usage(db: Database, top: int = 25) -> list[dict[str, Any]]:
    """Which preset files exist per instrument — the "what do I own" view."""
    rows = db.conn.execute(
        """SELECT tool, COUNT(*) AS n FROM files
           WHERE kind='preset' AND missing=0 AND tool IS NOT NULL
           GROUP BY tool ORDER BY n DESC LIMIT ?""",
        (top,),
    )
    return [{"tool": str(row["tool"]), "presets": int(row["n"])} for row in rows]


def sample_library_usage(db: Database, top: int = 25) -> list[dict[str, Any]]:
    rows = db.conn.execute(
        """SELECT library, COUNT(*) AS n FROM files
           WHERE kind='audio' AND missing=0 AND library IS NOT NULL
           GROUP BY library ORDER BY n DESC LIMIT ?""",
        (top,),
    )
    return [{"library": str(row["library"]), "files": int(row["n"])} for row in rows]


def find_project_samples(db: Database, names: Iterable[str]) -> list[dict[str, Any]]:
    """Resolve sample references from a project against the indexed library."""
    out: list[dict[str, Any]] = []
    for name in names:
        base = Path(str(name).replace("\\", "/")).name
        row = db.conn.execute(
            "SELECT id, path FROM files WHERE name=? AND missing=0 LIMIT 1", (base,)
        ).fetchone()
        out.append({"reference": name, "resolved": str(row["path"]) if row else None, "file_id": int(row["id"]) if row else None})
    return out
