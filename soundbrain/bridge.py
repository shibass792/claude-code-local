"""Stage 7 — the Cubase bridge.

There is no supported way to inject a panel into Cubase from Python, so the
bridge does the honest version of the same idea:

* ``soundbrain watch`` polls your project folders. When a ``.cpr`` (or ``.als`` /
  ``.song``) is created or saved, it computes the project's DNA and writes a
  report next to it — ``<project>.soundbrain.txt`` and ``.json`` — that reads
  "found 26 basses that fit this kick, 9 melodies in the same key".
* ``soundbrain serve`` exposes the same answers over a local HTTP API on
  127.0.0.1, which is what a Lemur/TouchOSC panel, a Stream Deck button or any
  script you bind inside your DAW can call while you work.

Both paths use the identical report builder below, so the numbers never diverge.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence

from . import brain, dna as dna_mod, learner, matcher
from .config import Config
from .db import Database

PROJECT_SUFFIXES = (".cpr", ".npr", ".als", ".song", ".rpp")


@dataclass
class ProjectReport:
    dna: dict[str, Any] = field(default_factory=dict)
    kick: dict[str, Any] | None = None
    basses: list[dict[str, Any]] = field(default_factory=list)
    melodies: list[dict[str, Any]] = field(default_factory=list)
    kicks: list[dict[str, Any]] = field(default_factory=list)
    chain: dict[str, Any] = field(default_factory=dict)
    generated_at: float = 0.0

    def as_dict(self) -> dict[str, Any]:
        return {
            "generated_at": self.generated_at,
            "dna": self.dna,
            "kick_reference": self.kick,
            "basses": self.basses,
            "melodies": self.melodies,
            "kicks": self.kicks,
            "chain": self.chain,
            "counts": {"basses": len(self.basses), "melodies": len(self.melodies), "kicks": len(self.kicks)},
        }

    def lines(self, lang: str = "en") -> list[str]:
        dna = self.dna
        if lang == "he":
            out = [f"{dna.get('project')} — {dna.get('fingerprint')}"]
            if self.kick:
                out.append(f"קיק ייחוס: {Path(str(self.kick.get('path') or '')).name}")
            out.append(f"מצאתי {len(self.basses)} באסים שמתאימים")
            out.append(f"מצאתי {len(self.melodies)} מלודיות מאותו Key")
            if self.chain.get("chain"):
                out.append("שרשרת מומלצת: " + " → ".join(self.chain["chain"]))
            return out

        out = [f"{dna.get('project')} — {dna.get('fingerprint')}"]
        if self.kick:
            out.append(f"kick reference: {Path(str(self.kick.get('path') or '')).name}")
        out.append(f"found {len(self.basses)} basses that fit")
        if self.basses:
            best = self.basses[0]
            out.append(f"  best: {best['name']} ({best['score']:.2f}) — {best.get('verdict') or ''}".rstrip(" —"))
        out.append(f"found {len(self.melodies)} melodies in the same key ({dna.get('key') or 'unknown key'})")
        if self.kicks:
            out.append(f"{len(self.kicks)} alternative kicks match this tempo and style")
        if self.chain.get("chain"):
            out.append("suggested chain: " + " > ".join(self.chain["chain"]))
        return out

    def text(self, lang: str = "en") -> str:
        header = "SoundBrain report"
        body = "\n".join(self.lines(lang))
        detail = ["", "Top bass candidates:"]
        for entry in self.basses[:10]:
            detail.append(f"  {entry['score']:.2f}  {entry['name']}")
            for reason in entry.get("reasons", [])[:3]:
                detail.append(f"        - {reason}")
        if self.melodies:
            detail.append("")
            detail.append("Melodies in key:")
            for entry in self.melodies[:10]:
                detail.append(f"  {entry['score']:.2f}  {entry['name']} [{entry.get('key') or '?'}]")
        return "\n".join([header, "=" * len(header), body, *detail, ""])


def pick_kick_reference(db: Database, dna: dict[str, Any]) -> dict[str, Any] | None:
    """The kick this project is built on, or the closest match from the library."""
    for entry in learner.find_project_samples(db, dna.get("sample_list", [])):
        if not entry["file_id"]:
            continue
        features = db.analysis(int(entry["file_id"]))
        if features and str(features.get("role")) == "kick":
            features["file_id"] = int(entry["file_id"])
            return features

    profile: dict[str, Any] = {"role": "kick"}
    if dna.get("kick_type"):
        profile["subtype"] = dna["kick_type"]
    if dna.get("bpm"):
        profile["bpm"] = float(dna["bpm"])
    reference = brain.role_reference(db, "kick")
    if reference:
        profile["vector"] = reference["vector"]
    candidates = matcher.match_profile(db, profile, limit=1)
    if not candidates:
        return None
    features = db.analysis(candidates[0].file_id) or {}
    features["file_id"] = candidates[0].file_id
    return features or None


def build_report(
    db: Database,
    cfg: Config,
    project_path: str | Path,
    limit: int = 30,
    refresh: bool = False,
) -> ProjectReport:
    """The stage 7 answer for one project."""
    dna = dna_mod.dna_or_build(db, cfg, project_path, refresh=refresh)
    report = ProjectReport(dna=dna, generated_at=time.time())

    kick = pick_kick_reference(db, dna)
    if kick:
        report.kick = {"path": kick.get("path"), "name": kick.get("name"), "subtype": kick.get("subtype"), "file_id": kick.get("file_id")}
        partners = matcher.find_partners_for_kick(db, kick, role="bass", limit=limit)
        report.basses = []
        for candidate in partners:
            entry = candidate.as_dict()
            entry["verdict"] = matcher.match_kick_bass(kick, db.analysis(candidate.file_id) or {}).verdict
            report.basses.append(entry)

    if dna.get("key"):
        melodies = matcher.find_in_key(db, str(dna["key"]), role="lead", bpm=dna.get("bpm"), limit=limit)
        report.melodies = [c.as_dict() for c in melodies]

    kick_profile: dict[str, Any] = {"role": "kick"}
    if dna.get("bpm"):
        kick_profile["bpm"] = float(dna["bpm"])
    if dna.get("kick_type"):
        kick_profile["subtype"] = dna["kick_type"]
    report.kicks = [c.as_dict() for c in matcher.match_profile(db, kick_profile, limit=min(limit, 10))]

    instruments = dna.get("instrument_list") or []
    if instruments:
        report.chain = learner.suggest_chain(db, str(instruments[0]))
    else:
        prof = brain.profile(db)
        if prof.instruments:
            report.chain = learner.suggest_chain(db, prof.instruments[0]["name"])
    return report


def write_report(cfg: Config, project_path: str | Path, report: ProjectReport, lang: str = "en", beside_project: bool = True) -> list[Path]:
    """Write the report as JSON + text, next to the project and in the reports dir."""
    cfg.ensure_dirs()
    target = Path(project_path)
    written: list[Path] = []
    payload = json.dumps(report.as_dict(), indent=2, ensure_ascii=False)
    text = report.text(lang)

    destinations: list[Path] = [cfg.reports_path / f"{target.stem}.soundbrain"]
    if beside_project and target.parent.exists():
        destinations.insert(0, target.with_suffix(".soundbrain"))
    for base in destinations:
        try:
            base.with_suffix(".soundbrain.json").write_text(payload, encoding="utf-8")
            base.with_suffix(".soundbrain.txt").write_text(text, encoding="utf-8")
            written.extend([base.with_suffix(".soundbrain.json"), base.with_suffix(".soundbrain.txt")])
        except OSError:
            continue
    return written


# ---------------------------------------------------------------------------
# watcher
# ---------------------------------------------------------------------------


def project_snapshot(folders: Sequence[str | Path], suffixes: Iterable[str] = PROJECT_SUFFIXES) -> dict[str, int]:
    """Map of project path -> mtime_ns for the given folders (recursive)."""
    wanted = tuple(s.lower() for s in suffixes)
    snapshot: dict[str, int] = {}
    for folder in folders:
        root = Path(folder).expanduser()
        if not root.exists():
            continue
        for path in root.rglob("*"):
            try:
                if path.is_file() and path.suffix.lower() in wanted:
                    snapshot[str(path)] = path.stat().st_mtime_ns
            except OSError:
                continue
    return snapshot


def watch_once(
    db: Database,
    cfg: Config,
    folders: Sequence[str | Path],
    previous: dict[str, int],
    on_report: Callable[[str, ProjectReport], None] | None = None,
    lang: str = "en",
    learn: bool = True,
) -> tuple[dict[str, int], list[str]]:
    """One polling cycle: report on every project that appeared or changed."""
    current = project_snapshot(folders)
    changed = [path for path, mtime in current.items() if previous.get(path) != mtime]
    handled: list[str] = []
    for path in sorted(changed):
        try:
            report = build_report(db, cfg, path, refresh=True)
        except Exception as exc:  # noqa: BLE001 - keep watching whatever happens
            db.log_event("watch_error", path, {"error": f"{type(exc).__name__}: {exc}"})
            continue
        write_report(cfg, path, report, lang=lang)
        if learn:
            try:
                brain.observe_project(db, cfg, path)
            except Exception:  # noqa: BLE001
                pass
        db.log_event("watch_report", path, {"counts": report.as_dict()["counts"]})
        if on_report:
            on_report(path, report)
        handled.append(path)
    return current, handled


def watch(
    db: Database,
    cfg: Config,
    folders: Sequence[str | Path],
    interval: float = 5.0,
    cycles: int | None = None,
    on_report: Callable[[str, ProjectReport], None] | None = None,
    lang: str = "en",
    learn: bool = True,
) -> None:
    """Poll project folders forever (or ``cycles`` times, for tests)."""
    snapshot = project_snapshot(folders)
    count = 0
    while cycles is None or count < cycles:
        time.sleep(interval if count else 0.0)
        snapshot, _handled = watch_once(db, cfg, folders, snapshot, on_report=on_report, lang=lang, learn=learn)
        count += 1
