"""Match a track reference to ARPs and Cubase / Ableton projects in the library.

Given a ``TrackReference`` (YouTube title, song name, or analysed audio), score:

* **ARPs** — lead/arp audio, MIDI arpeggios, and presets whose names scream arp
* **Projects** — ``.cpr`` / ``.als`` / ``.song`` / ``.rpp`` whose BPM, key and
  name line up with the reference

Scores are explainable so the panel can show *why* each hit was picked.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import matcher, reference as ref_mod, search as search_mod
from .config import Config
from .db import Database
from .taxonomy import bpm_from_name, key_from_name, normalize_text

ARP_NAME_RE = re.compile(
    r"\b(arp|arpeggio|arpeggiated|sequence|seq|pluck.?arp|melodic.?arp)\b",
    re.IGNORECASE,
)
PROJECT_EXTS = {".cpr", ".npr", ".als", ".alp", ".song", ".songprj", ".rpp"}


@dataclass
class Hit:
    kind: str  # arp | project | midi | preset
    file_id: int
    path: str
    name: str
    score: float
    daw: str = ""
    role: str = ""
    subtype: str = ""
    bpm: float | None = None
    key: str = ""
    library: str = ""
    reasons: list[str] = field(default_factory=list)
    downloadable: bool = True

    def as_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "file_id": self.file_id,
            "path": self.path,
            "name": self.name,
            "score": round(self.score, 4),
            "daw": self.daw,
            "role": self.role,
            "subtype": self.subtype,
            "bpm": round(self.bpm, 2) if self.bpm else None,
            "key": self.key,
            "library": self.library,
            "reasons": self.reasons[:6],
            "downloadable": self.downloadable,
            "exists": Path(self.path).exists() if self.path else False,
        }


def _token_overlap(a: str, b: str) -> float:
    ta = {t for t in re.findall(r"[a-zא-ת0-9]+", normalize_text(a)) if len(t) > 2}
    tb = {t for t in re.findall(r"[a-zא-ת0-9]+", normalize_text(b)) if len(t) > 2}
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def _bpm_score(wanted: float | None, actual: float | None) -> tuple[float, str]:
    if not wanted or not actual:
        return 0.55, "BPM unknown on one side"
    delta = abs(float(wanted) - float(actual))
    if delta <= 1.0:
        return 1.0, f"BPM match ({actual:.0f})"
    if delta <= 3.0:
        return 0.85, f"BPM close ({actual:.0f} vs {wanted:.0f})"
    if delta <= 6.0:
        return 0.55, f"BPM nearby ({actual:.0f} vs {wanted:.0f})"
    return max(0.0, 1.0 - delta / 40.0), f"BPM off ({actual:.0f} vs {wanted:.0f})"


def _key_score(wanted: str, actual: str) -> tuple[float, str]:
    if not wanted or not actual:
        return 0.5, "key unknown"
    score, reason = matcher.key_fit(
        {"musical_key": wanted, "key_conf": 1.0},
        {"musical_key": actual, "key_conf": 1.0},
    )
    return score, reason


def match_arps(
    db: Database,
    ref: ref_mod.TrackReference,
    limit: int = 20,
) -> list[Hit]:
    """Find ARP / lead material that fits the reference track."""
    profile = ref_mod.profile_from_reference(ref)
    # Prefer explicit arp subtype, but also accept leads / MIDI / named arps
    scored: dict[int, Hit] = {}

    for candidate in matcher.match_profile(db, profile, limit=limit * 3):
        hit = Hit(
            kind="arp",
            file_id=candidate.file_id,
            path=candidate.path,
            name=candidate.name,
            score=candidate.score,
            role=candidate.role,
            subtype=candidate.subtype,
            bpm=candidate.bpm or None,
            key=candidate.musical_key,
            library=candidate.library,
            reasons=list(candidate.reasons),
        )
        if candidate.subtype == "arp" or ARP_NAME_RE.search(candidate.name):
            hit.score = min(1.0, hit.score + 0.12)
            hit.reasons.insert(0, "ARP / arpeggio signal in name or subtype")
        scored[candidate.file_id] = hit

    # Broader lead search without forcing subtype
    lead_profile = {k: v for k, v in profile.items() if k != "subtype"}
    lead_profile["role"] = "lead"
    for candidate in matcher.match_profile(db, lead_profile, limit=limit * 2):
        if candidate.file_id in scored:
            continue
        if candidate.subtype == "arp" or ARP_NAME_RE.search(candidate.name + " " + candidate.path):
            scored[candidate.file_id] = Hit(
                kind="arp",
                file_id=candidate.file_id,
                path=candidate.path,
                name=candidate.name,
                score=min(1.0, candidate.score + 0.05),
                role=candidate.role,
                subtype=candidate.subtype or "arp",
                bpm=candidate.bpm or None,
                key=candidate.musical_key,
                library=candidate.library,
                reasons=["lead classified as ARP"] + list(candidate.reasons),
            )

    # MIDI files with arp in the name
    for row in db.conn.execute(
        """SELECT id, path, name, library FROM files
           WHERE missing=0 AND kind='midi'
             AND (LOWER(name) LIKE '%arp%' OR LOWER(path) LIKE '%arp%'
                  OR LOWER(name) LIKE '%sequence%' OR LOWER(name) LIKE '%seq%')
           LIMIT ?""",
        (limit * 2,),
    ):
        fid = int(row["id"])
        if fid in scored:
            continue
        name_score = _token_overlap(ref.search_query(), str(row["name"]))
        bpm = bpm_from_name(str(row["name"]))
        bpm_s, bpm_r = _bpm_score(ref.bpm, bpm)
        score = 0.45 + 0.35 * name_score + 0.2 * bpm_s
        scored[fid] = Hit(
            kind="midi",
            file_id=fid,
            path=str(row["path"]),
            name=str(row["name"]),
            score=score,
            bpm=bpm,
            library=str(row["library"] or ""),
            reasons=["MIDI ARP / sequence file", bpm_r],
        )

    # Presets named like arps
    for row in db.conn.execute(
        """SELECT id, path, name, library, tool FROM files
           WHERE missing=0 AND kind='preset'
             AND (LOWER(name) LIKE '%arp%' OR LOWER(path) LIKE '%arp%')
           LIMIT ?""",
        (limit,),
    ):
        fid = int(row["id"])
        if fid in scored:
            continue
        name_score = _token_overlap(ref.search_query(), str(row["name"]))
        scored[fid] = Hit(
            kind="preset",
            file_id=fid,
            path=str(row["path"]),
            name=str(row["name"]),
            score=0.4 + 0.4 * name_score,
            library=str(row["library"] or row["tool"] or ""),
            reasons=[f"preset ARP ({row['tool'] or 'unknown tool'})"],
        )

    hits = sorted(scored.values(), key=lambda h: h.score, reverse=True)
    return hits[:limit]


def match_projects(
    db: Database,
    ref: ref_mod.TrackReference,
    limit: int = 15,
    daw: str | None = None,
) -> list[Hit]:
    """Rank Cubase / Ableton / other projects against the reference."""
    hits: list[Hit] = []
    query = ref.search_query()

    rows = db.conn.execute(
        """SELECT f.id AS file_id, f.path, f.name, f.daw, f.ext,
                  p.id AS project_id, p.bpm AS project_bpm, p.musical_key AS project_key,
                  p.dna, p.name AS project_name
           FROM files f
           LEFT JOIN projects p ON p.file_id = f.id
           WHERE f.missing=0 AND f.kind='project'
           ORDER BY COALESCE(p.modified_at, f.mtime_ns) DESC"""
    ).fetchall()

    for row in rows:
        path = str(row["path"])
        ext = str(row["ext"] or Path(path).suffix).lower()
        if ext not in PROJECT_EXTS and not str(row["daw"] or ""):
            continue
        daw_name = str(row["daw"] or "")
        if daw:
            needle = daw.lower()
            if needle not in daw_name.lower() and needle not in path.lower():
                if needle == "cubase" and ext not in {".cpr", ".npr", ".bak"}:
                    continue
                if needle == "ableton" and ext not in {".als", ".alp"}:
                    continue

        name = str(row["project_name"] or row["name"] or Path(path).stem)
        bpm = row["project_bpm"]
        if bpm is None:
            bpm = bpm_from_name(name) or bpm_from_name(path)
        key = str(row["project_key"] or key_from_name(name) or "")

        name_s = _token_overlap(query, name + " " + path)
        bpm_s, bpm_r = _bpm_score(ref.bpm, float(bpm) if bpm else None)
        key_s, key_r = _key_score(ref.key, key)

        # Cubase slightly preferred when the panel's "Open in Cubase" is the goal
        daw_bonus = 0.08 if "cubase" in daw_name.lower() or ext == ".cpr" else 0.0
        if "ableton" in daw_name.lower() or ext == ".als":
            daw_bonus = max(daw_bonus, 0.05)

        score = 0.4 * name_s + 0.3 * bpm_s + 0.22 * key_s + daw_bonus
        # Parsed projects with DNA are more trustworthy
        if row["dna"]:
            score = min(1.0, score + 0.05)

        reasons = []
        if name_s > 0:
            reasons.append(f"name overlap {name_s:.0%}")
        reasons.append(bpm_r)
        reasons.append(key_r)
        if daw_name:
            reasons.append(f"DAW: {daw_name}")

        hits.append(
            Hit(
                kind="project",
                file_id=int(row["file_id"]),
                path=path,
                name=name,
                score=float(score),
                daw=daw_name or ("Cubase" if ext in {".cpr", ".npr"} else "Ableton Live" if ext in {".als", ".alp"} else ""),
                bpm=float(bpm) if bpm else None,
                key=key,
                reasons=reasons,
            )
        )

    hits.sort(key=lambda h: h.score, reverse=True)
    return hits[:limit]


def match_track(
    db: Database,
    cfg: Config,
    raw: str,
    *,
    file_id: int | None = None,
    limit_arps: int = 20,
    limit_projects: int = 12,
    daw: str | None = None,
    use_llm: bool = False,
) -> dict[str, Any]:
    """Full Match Panel pipeline: resolve → ARPs → projects (+ optional AI search)."""
    ref = ref_mod.resolve(db, cfg, raw, file_id=file_id)
    arps = match_arps(db, ref, limit=limit_arps)
    projects = match_projects(db, ref, limit=limit_projects, daw=daw)

    extras: list[dict[str, Any]] = []
    if use_llm or (not arps and ref.search_query()):
        try:
            search_result = search_mod.search(
                db, cfg, f"arp lead {ref.search_query()}", limit=min(limit_arps, 15), use_llm=use_llm
            )
            extras = search_result.get("results") or []
        except Exception as exc:  # noqa: BLE001
            extras = []
            ref.notes.append(f"AI search skipped: {exc}")

    best_project = projects[0].as_dict() if projects else None
    best_arp = arps[0].as_dict() if arps else None

    message_he = _hebrew_summary(ref, arps, projects)
    message_en = _english_summary(ref, arps, projects)

    return {
        "reference": ref.as_dict(),
        "arps": [h.as_dict() for h in arps],
        "projects": [h.as_dict() for h in projects],
        "search_extras": extras[:10],
        "best": {"arp": best_arp, "project": best_project},
        "counts": {"arps": len(arps), "projects": len(projects)},
        "message_he": message_he,
        "message_en": message_en,
    }


def _hebrew_summary(ref: ref_mod.TrackReference, arps: list[Hit], projects: list[Hit]) -> str:
    label = ref.title or ref.query or ref.input
    bits = [f"עבור «{label}» מצאתי {len(arps)} ARP/לידים ו־{len(projects)} פרויקטים."]
    if projects:
        bits.append(f"פרויקט מוביל: {projects[0].name} ({projects[0].daw or 'DAW'}).")
    if arps:
        bits.append(f"ARP מוביל: {arps[0].name}.")
    return " ".join(bits)


def _english_summary(ref: ref_mod.TrackReference, arps: list[Hit], projects: list[Hit]) -> str:
    label = ref.title or ref.query or ref.input
    bits = [f"For “{label}” found {len(arps)} ARPs/leads and {len(projects)} projects."]
    if projects:
        bits.append(f"Top project: {projects[0].name} ({projects[0].daw or 'DAW'}).")
    if arps:
        bits.append(f"Top ARP: {arps[0].name}.")
    return " ".join(bits)
