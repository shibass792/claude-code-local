"""``python -m soundbrain`` — the command line for all ten stages.

    soundbrain init                          write a config with detected drives
    soundbrain scan                          stage 1: index H:\\ D:\\ F:\\ C:\\Users\\...
    soundbrain analyze                       stage 3 (+2): analyse new/changed audio
    soundbrain projects                      parse Cubase / Live / Studio One projects
    soundbrain stats --lang he               stages 5 + 6: usage shares and chains
    soundbrain dna "H:\\Proj\\track.cpr"      stage 8: Project DNA
    soundbrain project "...track.cpr"        stage 7: basses that fit, melodies in key
    soundbrain search "bass like Astrix"     stage 9: AI search
    soundbrain match kick.wav --role bass    stage 4: partners for one sound
    soundbrain brain observe|profile|suggest stage 10: Brain Mode
    soundbrain serve / soundbrain watch      the bridge
    soundbrain pipeline                      scan + analyze + projects + learn, in order
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Sequence

from . import analyzer, brain, bridge, dna as dna_mod, learner, matcher, scanner, search as search_mod, server
from .audio import io as audio_io
from .config import Config, load_config
from .db import Database


def _out(payload: Any, as_json: bool, lines: Sequence[str] | None = None) -> None:
    if as_json:
        print(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
        return
    for line in lines or []:
        print(line)


def _open(args: argparse.Namespace) -> tuple[Database, Config]:
    cfg = load_config(getattr(args, "config", None), roots=getattr(args, "roots", None))
    if getattr(args, "db", None):
        cfg.home = str(Path(args.db).expanduser().parent)
        cfg.ensure_dirs()
        return Database(args.db), cfg
    cfg.ensure_dirs()
    return Database(cfg.db_path), cfg


def _resolve_seed(db: Database, target: str) -> dict[str, Any]:
    """Find an analysed sound by path or by substring of its name."""
    row = db.file_by_path(target)
    if row is None:
        candidate = Path(target)
        if candidate.exists():
            row = db.file_by_path(str(candidate.resolve()))
        if row is None:
            row = db.conn.execute(
                "SELECT * FROM files WHERE kind='audio' AND missing=0 AND (path LIKE ? OR name LIKE ?) LIMIT 1",
                (f"%{target}%", f"%{target}%"),
            ).fetchone()
    if row is None:
        raise SystemExit(f"not indexed: {target} (run 'soundbrain scan' first)")
    features = db.analysis(int(row["id"]))
    if not features:
        raise SystemExit(f"indexed but not analysed yet: {row['path']} (run 'soundbrain analyze')")
    features["file_id"] = int(row["id"])
    return features


# ---------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------


def cmd_init(args: argparse.Namespace) -> int:
    cfg = load_config(getattr(args, "config", None), roots=getattr(args, "roots", None))
    cfg.ensure_dirs()
    path = cfg.save()
    decoders = audio_io.decoders_available()
    print(f"config written to {path}")
    print(f"database        {cfg.db_path}")
    print("scan roots:")
    for root in cfg.roots:
        exists = "ok" if Path(root).exists() else "missing"
        print(f"  {root}  [{exists}]")
    print("decoders:      " + ", ".join(f"{name}={'yes' if ok else 'no'}" for name, ok in decoders.items()))
    if not decoders["soundfile"]:
        print("  hint: 'pip install soundfile' adds fast flac/aiff/ogg decoding")
    return 0


def cmd_scan(args: argparse.Namespace) -> int:
    db, cfg = _open(args)
    try:
        def progress(path: str, count: int) -> None:
            if not args.quiet:
                print(f"  {count:>7} files … {path[:90]}", flush=True)

        stats = scanner.scan(db, cfg, roots=args.roots, progress=progress)
        payload = stats.as_dict()
        lines = [
            f"scanned {stats.seen} files in {stats.elapsed:.1f}s across {stats.dirs} folders",
            f"  new {stats.added} · changed {stats.changed} · unchanged {stats.unchanged} · gone {stats.missing} · errors {stats.errors}",
            "  by kind: " + ", ".join(f"{k}={v}" for k, v in sorted(stats.by_kind.items())),
        ]
        _out(payload, args.json, lines)
    finally:
        db.close()
    return 0


def cmd_inventory(args: argparse.Namespace) -> int:
    db, _cfg = _open(args)
    try:
        data = scanner.inventory(db)
        lines = ["counts: " + ", ".join(f"{k}={v}" for k, v in sorted(data["counts"].items()))]
        for drive, info in sorted(data["drives"].items()):
            gigabytes = int(info["bytes"]) / (1024**3)
            lines.append(f"  {drive}  {info['files']} files, {gigabytes:.1f} GB")
        for kind, tools in sorted(data["tools"].items()):
            lines.append(f"  {kind}: " + ", ".join(t["name"] for t in tools[:12]))
        missing = data["coverage_missing"]
        lines.append("coverage: " + ("all requested tools found" if not missing else "not found → " + ", ".join(missing)))
        if data["libraries"]:
            lines.append("top sample libraries: " + ", ".join(f"{l['library']} ({l['files']})" for l in data["libraries"][:8]))
        _out(data, args.json, lines)
    finally:
        db.close()
    return 0


def cmd_analyze(args: argparse.Namespace) -> int:
    db, cfg = _open(args)
    try:
        def progress(path: str, index: int, total: int) -> None:
            if not args.quiet:
                print(f"  [{index}/{total}] {Path(path).name[:80]}", flush=True)

        result = analyzer.analyze_pending(db, cfg, limit=args.limit, progress=progress)
        lines = [
            f"analysed {result['analyzed']}/{result['total']} files in {result['elapsed']}s ({result['failed']} failed)"
        ]
        for failure in result["failures"][:5]:
            lines.append(f"  ! {Path(failure['path']).name}: {failure['error']}")
        _out(result, args.json, lines)
    finally:
        db.close()
    return 0


def cmd_analyze_file(args: argparse.Namespace) -> int:
    cfg = load_config(getattr(args, "config", None))
    features = analyzer.analyze_file(args.path, cfg)
    if args.json:
        print(json.dumps(features, ensure_ascii=False, indent=2))
        return 0
    keys = (
        "duration", "sample_rate", "channels", "role", "subtype", "role_conf", "bpm", "bpm_conf",
        "musical_key", "key_conf", "fundamental_hz", "note_name", "lufs", "rms_db", "peak_db",
        "crest_db", "dynamic_range", "attack_ms", "release_ms", "transient", "centroid_hz",
        "rolloff85_hz", "stereo_width", "correlation", "energy",
    )
    width = max(len(k) for k in keys)
    for key in keys:
        print(f"  {key:<{width}}  {features.get(key)}")
    if features.get("evidence"):
        print("  evidence:")
        for item in features["evidence"]:
            print(f"    - {item}")
    return 0


def cmd_projects(args: argparse.Namespace) -> int:
    db, cfg = _open(args)
    try:
        def progress(path: str, index: int, total: int) -> None:
            if not args.quiet:
                print(f"  [{index}/{total}] {Path(path).name[:80]}", flush=True)

        result = learner.ingest_projects(db, cfg, limit=args.limit, progress=progress, force=args.force)
        lines = [f"parsed {result['parsed']}/{result['total']} projects in {result['elapsed']}s ({result['failed']} failed)"]
        for failure in result["failures"][:5]:
            lines.append(f"  ! {Path(failure['path']).name}: {failure['error']}")
        _out(result, args.json, lines)
    finally:
        db.close()
    return 0


def cmd_stats(args: argparse.Namespace) -> int:
    db, _cfg = _open(args)
    try:
        data = learner.summary(db)
        lines = learner.report_lines(data, lang=args.lang)
        usage = data["usage"]
        if usage["instruments"]:
            lines.append("")
            lines.append("instruments by project share:")
            for entry in usage["instruments"][:10]:
                lines.append(f"  {entry['share']*100:5.1f}%  {entry['name']}  ({entry['projects']} projects)")
        if usage["effects"]:
            lines.append("effects by project share:")
            for entry in usage["effects"][:10]:
                lines.append(f"  {entry['share']*100:5.1f}%  {entry['name']}")
        if data["chains"]["chains"]:
            lines.append("chains you build most:")
            for entry in data["chains"]["chains"][:8]:
                lines.append(f"  {entry['uses']:>4}x  {entry['chain']}")
        _out(data, args.json, lines)
    finally:
        db.close()
    return 0


def cmd_chain(args: argparse.Namespace) -> int:
    db, _cfg = _open(args)
    try:
        result = learner.suggest_chain(db, args.instrument)
        lines = [
            f"{result['instrument']}: " + (" > ".join(result["chain"]) if result["chain"] else "no data yet"),
            f"  source: {result['source']}",
        ]
        _out(result, args.json, lines)
    finally:
        db.close()
    return 0


def cmd_dna(args: argparse.Namespace) -> int:
    db, cfg = _open(args)
    try:
        dna = dna_mod.dna_or_build(db, cfg, args.path, refresh=args.refresh)
        _out(dna, args.json, dna_mod.dna_lines(dna))
    finally:
        db.close()
    return 0


def cmd_project(args: argparse.Namespace) -> int:
    db, cfg = _open(args)
    try:
        report = bridge.build_report(db, cfg, args.path, limit=args.limit, refresh=args.refresh)
        if args.write:
            written = bridge.write_report(cfg, args.path, report, lang=args.lang)
            print("\n".join(f"wrote {p}" for p in written))
        payload = report.as_dict()
        payload["lines"] = report.lines(args.lang)
        _out(payload, args.json, report.lines(args.lang))
    finally:
        db.close()
    return 0


def cmd_search(args: argparse.Namespace) -> int:
    db, cfg = _open(args)
    try:
        result = search_mod.search(db, cfg, args.query, limit=args.limit, use_llm=args.llm)
        plan = result["plan"]
        lines = [
            f"query: {plan['query']}",
            "  understood as: "
            + ", ".join(
                f"{k}={v}" for k, v in plan.items() if v and k not in ("query", "notes", "tags", "has_reference_vector")
            ),
        ]
        for note in plan["notes"]:
            lines.append(f"  note: {note}")
        lines.append(f"  {result['count']} results")
        for entry in result["results"][:args.limit]:
            lines.append(f"  {entry['score']:.3f}  {entry['name']}  [{entry['role']}/{entry['subtype'] or '-'}] {entry['key'] or ''}")
            if args.verbose:
                for reason in entry["reasons"][:3]:
                    lines.append(f"           - {reason}")
        _out(result, args.json, lines)
    finally:
        db.close()
    return 0


def cmd_match(args: argparse.Namespace) -> int:
    db, _cfg = _open(args)
    try:
        seed = _resolve_seed(db, args.path)
        candidates = matcher.find_partners_for_kick(db, seed, role=args.role, limit=args.limit, subtype=args.subtype)
        lines = [f"{len(candidates)} {args.role} matches for {Path(str(seed.get('path'))).name}"]
        for entry in candidates:
            payload = entry.as_dict()
            lines.append(f"  {payload['score']:.3f}  {payload['name']}  [{payload['subtype'] or '-'}] {payload['key'] or ''}")
            if args.verbose:
                for reason in payload["reasons"][:4]:
                    lines.append(f"           - {reason}")
        _out({"seed": seed.get("path"), "results": [c.as_dict() for c in candidates]}, args.json, lines)
    finally:
        db.close()
    return 0


def cmd_similar(args: argparse.Namespace) -> int:
    db, _cfg = _open(args)
    try:
        seed = _resolve_seed(db, args.path)
        candidates = matcher.find_similar(db, seed, role=args.role, limit=args.limit)
        lines = [f"{len(candidates)} sounds similar to {Path(str(seed.get('path'))).name}"]
        for entry in candidates:
            payload = entry.as_dict()
            lines.append(f"  {payload['score']:.3f}  {payload['name']}  [{payload['role']}/{payload['subtype'] or '-'}]")
        _out({"seed": seed.get("path"), "results": [c.as_dict() for c in candidates]}, args.json, lines)
    finally:
        db.close()
    return 0


def cmd_inkey(args: argparse.Namespace) -> int:
    db, _cfg = _open(args)
    try:
        candidates = matcher.find_in_key(db, args.key, role=args.role, bpm=args.bpm, limit=args.limit)
        lines = [f"{len(candidates)} sounds in or around {args.key}"]
        for entry in candidates:
            payload = entry.as_dict()
            lines.append(f"  {payload['score']:.3f}  {payload['name']}  [{payload['key'] or '?'}] {payload['bpm'] or ''}")
        _out({"key": args.key, "results": [c.as_dict() for c in candidates]}, args.json, lines)
    finally:
        db.close()
    return 0


def cmd_brain(args: argparse.Namespace) -> int:
    db, cfg = _open(args)
    try:
        if args.action == "observe":
            if args.path:
                result = brain.observe_project(db, cfg, args.path, refresh=args.refresh)
                _out(result, args.json, [f"learned from {result['project']} — {result['fingerprint']}", f"  observations: {result['observations']}"])
            else:
                result = brain.observe_all(db, cfg, limit=args.limit, refresh=args.refresh)
                _out(result, args.json, [f"learned from {result['observed']} projects ({result['failed']} failed)"])
        elif args.action == "profile":
            prof = brain.profile(db)
            _out(prof.as_dict(), args.json, brain.profile_lines(prof, lang=args.lang))
        elif args.action == "suggest":
            result = brain.suggest(db, cfg, bpm=args.bpm, key=args.key, limit=args.limit)
            lines = [
                f"start at {result['bpm'] or '?'} BPM in {result['key'] or '?'}",
                f"  instrument: {result['instrument'] or 'unknown'}",
                f"  chain: {' > '.join(result['chain']) if result['chain'] else 'no data'} ({result['chain_source']})",
            ]
            for pair in result["kick_bass_pairs"][:args.limit]:
                lines.append(f"  kick {pair['kick']['name']} + bass {pair['bass']['name']} ({pair['bass']['score']:.2f})")
            for lead in result["leads"][:3]:
                lines.append(f"  lead in key: {lead['name']} [{lead['key']}]")
            for why in result["why"]:
                lines.append(f"  why: {why}")
            _out(result, args.json, lines)
        elif args.action == "like":
            if not args.file_id:
                raise SystemExit("--file-id is required for 'brain like'")
            result = brain.like(db, args.file_id)
            _out(result, args.json, [json.dumps(result, ensure_ascii=False)])
        elif args.action == "timeline":
            entries = brain.timeline(db, limit=args.limit)
            _out(entries, args.json, [f"  {e['project']}: {e['fingerprint']}" for e in entries])
    finally:
        db.close()
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    db, cfg = _open(args)
    try:
        server.serve(db, cfg, host=args.host, port=args.port, quiet=args.quiet)
    finally:
        db.close()
    return 0


def cmd_watch(args: argparse.Namespace) -> int:
    db, cfg = _open(args)
    try:
        folders = args.folders or cfg.roots
        print(f"watching {len(folders)} folder(s) for project changes; Ctrl-C to stop")

        def on_report(path: str, report: bridge.ProjectReport) -> None:
            print(f"\n{path}")
            for line in report.lines(args.lang):
                print(f"  {line}")

        bridge.watch(db, cfg, folders, interval=args.interval, cycles=args.cycles, on_report=on_report, lang=args.lang, learn=not args.no_learn)
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        db.close()
    return 0


def cmd_pipeline(args: argparse.Namespace) -> int:
    db, cfg = _open(args)
    try:
        print("stage 1 — scanning")
        stats = scanner.scan(db, cfg, roots=args.roots)
        print(f"  {stats.seen} files ({stats.added} new, {stats.changed} changed) in {stats.elapsed:.1f}s")
        print("stage 2+3 — analysing audio")
        analysis = analyzer.analyze_pending(db, cfg, limit=args.limit)
        print(f"  {analysis['analyzed']}/{analysis['total']} analysed in {analysis['elapsed']}s")
        print("stage 5+6 — parsing projects")
        projects = learner.ingest_projects(db, cfg, limit=args.limit)
        print(f"  {projects['parsed']}/{projects['total']} projects parsed")
        print("stage 10 — learning")
        learned = brain.observe_all(db, cfg, limit=args.limit)
        print(f"  observed {learned['observed']} projects")
        data = learner.summary(db)
        for line in learner.report_lines(data, lang=args.lang):
            print(f"  {line}")
    finally:
        db.close()
    return 0


# ---------------------------------------------------------------------------
# parser
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="soundbrain", description="Local studio knowledge engine for samples, presets and projects")
    parser.add_argument("--config", help="path to a config JSON file")
    parser.add_argument("--db", help="path to the SQLite database (default ~/.soundbrain/soundbrain.db)")
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    parser.add_argument("--quiet", action="store_true", help="suppress per-file progress")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("init", help="write a config file and show what was detected")
    p.add_argument("--roots", nargs="*", help="scan roots, e.g. H:\\ D:\\ F:\\ C:\\Users\\shibass\\")
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("scan", help="stage 1: index every configured drive")
    p.add_argument("--roots", nargs="*", help="override the configured roots")
    p.set_defaults(func=cmd_scan)

    p = sub.add_parser("inventory", help="what the scanner found, per drive and per tool")
    p.set_defaults(func=cmd_inventory)

    p = sub.add_parser("analyze", help="stages 2+3: analyse new or changed audio")
    p.add_argument("--limit", type=int, help="only analyse this many files")
    p.set_defaults(func=cmd_analyze)

    p = sub.add_parser("analyze-file", help="analyse one file and print the features")
    p.add_argument("path")
    p.set_defaults(func=cmd_analyze_file)

    p = sub.add_parser("projects", help="parse Cubase / Live / Studio One / Reaper projects")
    p.add_argument("--limit", type=int)
    p.add_argument("--force", action="store_true", help="re-parse even if unchanged")
    p.set_defaults(func=cmd_projects)

    p = sub.add_parser("stats", help="stages 5+6: usage shares, keys, tempos, chains")
    p.add_argument("--lang", choices=("en", "he"), default="en")
    p.set_defaults(func=cmd_stats)

    p = sub.add_parser("chain", help="stage 6: the chain you would probably use after an instrument")
    p.add_argument("instrument")
    p.set_defaults(func=cmd_chain)

    p = sub.add_parser("dna", help="stage 8: Project DNA")
    p.add_argument("path")
    p.add_argument("--refresh", action="store_true")
    p.set_defaults(func=cmd_dna)

    p = sub.add_parser("project", help="stage 7: what fits this project right now")
    p.add_argument("path")
    p.add_argument("--limit", type=int, default=30)
    p.add_argument("--refresh", action="store_true")
    p.add_argument("--write", action="store_true", help="write the report next to the project")
    p.add_argument("--lang", choices=("en", "he"), default="en")
    p.set_defaults(func=cmd_project)

    p = sub.add_parser("search", help="stage 9: AI search over your own library")
    p.add_argument("query")
    p.add_argument("--limit", type=int, default=15)
    p.add_argument("--llm", action="store_true", help="also ask the local model to interpret the query")
    p.add_argument("--verbose", action="store_true")
    p.set_defaults(func=cmd_search)

    p = sub.add_parser("match", help="stage 4: find partners for a sound (kick -> bass by default)")
    p.add_argument("path")
    p.add_argument("--role", default="bass")
    p.add_argument("--subtype")
    p.add_argument("--limit", type=int, default=15)
    p.add_argument("--verbose", action="store_true")
    p.set_defaults(func=cmd_match)

    p = sub.add_parser("similar", help="nearest neighbours by timbre")
    p.add_argument("path")
    p.add_argument("--role")
    p.add_argument("--limit", type=int, default=15)
    p.set_defaults(func=cmd_similar)

    p = sub.add_parser("inkey", help="find sounds in (or near) a key")
    p.add_argument("key")
    p.add_argument("--role")
    p.add_argument("--bpm", type=float)
    p.add_argument("--limit", type=int, default=15)
    p.set_defaults(func=cmd_inkey)

    p = sub.add_parser("brain", help="stage 10: Brain Mode")
    p.add_argument("action", choices=("observe", "profile", "suggest", "like", "timeline"))
    p.add_argument("path", nargs="?", help="project to observe")
    p.add_argument("--limit", type=int, default=10)
    p.add_argument("--bpm", type=float)
    p.add_argument("--key")
    p.add_argument("--file-id", type=int, dest="file_id")
    p.add_argument("--refresh", action="store_true")
    p.add_argument("--lang", choices=("en", "he"), default="en")
    p.set_defaults(func=cmd_brain)

    p = sub.add_parser("serve", help="run the local bridge HTTP API")
    p.add_argument("--host", default=None)
    p.add_argument("--port", type=int, default=None)
    p.set_defaults(func=cmd_serve)

    p = sub.add_parser("watch", help="watch project folders and report on every save")
    p.add_argument("folders", nargs="*")
    p.add_argument("--interval", type=float, default=5.0)
    p.add_argument("--cycles", type=int, default=None)
    p.add_argument("--lang", choices=("en", "he"), default="en")
    p.add_argument("--no-learn", action="store_true", dest="no_learn")
    p.set_defaults(func=cmd_watch)

    p = sub.add_parser("pipeline", help="scan + analyse + parse projects + learn, in order")
    p.add_argument("--roots", nargs="*")
    p.add_argument("--limit", type=int)
    p.add_argument("--lang", choices=("en", "he"), default="en")
    p.set_defaults(func=cmd_pipeline)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args) or 0)
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)
        return 130
    except SystemExit as exc:
        if isinstance(exc.code, str):
            print(exc.code, file=sys.stderr)
            return 1
        return int(exc.code or 0)


if __name__ == "__main__":
    raise SystemExit(main())
