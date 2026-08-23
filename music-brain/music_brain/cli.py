"""CLI entrypoint: music-brain scan|analyze|match|search|learn|serve|dna|status."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from music_brain import __version__
from music_brain.config import default_db_path, resolve_roots
from music_brain.db import KnowledgeDB


def _db(args: argparse.Namespace) -> KnowledgeDB:
    path = Path(args.db) if getattr(args, "db", None) else default_db_path()
    return KnowledgeDB(path)


def _print(data: object) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2, default=str))


def cmd_scan(args: argparse.Namespace) -> int:
    from music_brain.scanner import scan

    db = _db(args)
    stats = scan(
        db,
        roots=args.root,
        force=args.force,
        progress=(print if args.verbose else None),
    )
    _print({"ok": True, **stats.__dict__, "db": str(db.path)})
    return 0


def cmd_analyze(args: argparse.Namespace) -> int:
    from music_brain.pipeline import run_analyze

    db = _db(args)
    stats = run_analyze(
        db,
        force=args.force,
        limit=args.limit,
        progress=(print if args.verbose else None),
    )
    _print({"ok": True, **stats, "db": str(db.path)})
    return 0


def cmd_pipeline(args: argparse.Namespace) -> int:
    from music_brain.pipeline import full_pipeline

    db = _db(args)
    result = full_pipeline(
        db,
        roots=args.root,
        force=args.force,
        progress=(print if args.verbose else None),
    )
    _print({"ok": True, **result, "db": str(db.path)})
    return 0


def cmd_match(args: argparse.Namespace) -> int:
    from music_brain.matcher import match_bass_for_kick, match_for, match_melodies_same_key

    db = _db(args)
    if args.melodies:
        if not args.key:
            print("error: --key required with --melodies", file=sys.stderr)
            return 2
        hits = match_melodies_same_key(db, args.key, limit=args.limit)
        msg = f"מצאתי {len(hits)} מלודיות מאותו Key."
    elif args.family == "bass" and (args.kick or args.for_kick):
        hits = match_bass_for_kick(
            db,
            kick_path=args.kick,
            key=args.key,
            bpm=args.bpm,
            limit=args.limit,
        )
        msg = f"מצאתי {len(hits)} באסים שמתאימים."
    else:
        hits = match_for(
            db,
            target_family=args.family,
            key=args.key,
            bpm=args.bpm,
            style=args.style,
            limit=args.limit,
            prefer_same_key=bool(args.key and args.prefer_key),
        )
        msg = f"מצאתי {len(hits)} התאמות."
    _print({"message": msg, "count": len(hits), "results": hits})
    return 0


def cmd_search(args: argparse.Namespace) -> int:
    from music_brain.search import search

    db = _db(args)
    result = search(db, args.query, limit=args.limit)
    _print(result)
    return 0


def cmd_learn(args: argparse.Namespace) -> int:
    from music_brain.brain import ingest_project, learn_summary, recommend_chain

    db = _db(args)
    if args.project:
        dna = ingest_project(db, args.project)
        _print({"ingested": args.project, "dna": dna})
    summary = learn_summary(db)
    if args.synth:
        summary["recommended_chain_for_synth"] = recommend_chain(db, args.synth)
    if args.narrative_only:
        print(summary.get("narrative") or "")
    else:
        _print(summary)
    return 0


def cmd_dna(args: argparse.Namespace) -> int:
    from music_brain.analyzer.project_dna import extract_project_dna

    dna = extract_project_dna(args.path)
    _print(dna)
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    from music_brain.player import serve

    db = _db(args)
    # Optional: light media re-index before serving the player panel
    if getattr(args, "index", False):
        from music_brain.player.media import ensure_media_indexed

        print("Indexing media...")
        print(ensure_media_indexed(db, args.root if getattr(args, "root", None) else None))
    serve(db, host=args.host, port=args.port)
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    db = _db(args)
    roots = resolve_roots(args.root)
    _print(
        {
            "version": __version__,
            "db": str(db.path),
            "roots_resolved": [str(r) for r in roots],
            "counts": db.count_by_kind(),
            "key_bpm": db.key_bpm_stats(),
            "plugins": db.plugin_usage()[:10],
        }
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="music-brain",
        description="Local music intelligence — scan, analyze, match, learn, Cubase bridge",
    )
    p.add_argument("--db", help="SQLite knowledge DB path (default: ~/.music-brain/knowledge.db)")
    p.add_argument("--version", action="version", version=f"music-brain {__version__}")
    sub = p.add_subparsers(dest="cmd", required=True)

    def add_roots(sp: argparse.ArgumentParser) -> None:
        sp.add_argument(
            "--root",
            action="append",
            help="Scan root (repeatable). Default: H:\\ D:\\ F:\\ C:\\Users\\shibass on Windows",
        )

    sp = sub.add_parser("scan", help="Stage 1 — incremental multi-drive scan")
    add_roots(sp)
    sp.add_argument("--force", action="store_true")
    sp.add_argument("-v", "--verbose", action="store_true")
    sp.set_defaults(func=cmd_scan)

    sp = sub.add_parser("analyze", help="Stages 2–3 — styles + audio features + project DNA")
    sp.add_argument("--force", action="store_true")
    sp.add_argument("--limit", type=int, default=None)
    sp.add_argument("-v", "--verbose", action="store_true")
    sp.set_defaults(func=cmd_analyze)

    sp = sub.add_parser("pipeline", help="scan + analyze + brain summary")
    add_roots(sp)
    sp.add_argument("--force", action="store_true")
    sp.add_argument("-v", "--verbose", action="store_true")
    sp.set_defaults(func=cmd_pipeline)

    sp = sub.add_parser("match", help="Stages 4 & 7 — kick↔bass / same-key melodies")
    sp.add_argument("--family", default="bass", choices=["bass", "kick", "lead", "pad", "fx", "vocal"])
    sp.add_argument("--key")
    sp.add_argument("--bpm", type=float)
    sp.add_argument("--style")
    sp.add_argument("--kick", help="Reference kick path")
    sp.add_argument("--for-kick", action="store_true")
    sp.add_argument("--melodies", action="store_true", help="Same-key lead/melody search")
    sp.add_argument("--prefer-key", action="store_true")
    sp.add_argument("--limit", type=int, default=26)
    sp.set_defaults(func=cmd_match)

    sp = sub.add_parser("search", help="Stage 9 — NL search (e.g. 'bass like Astrix')")
    sp.add_argument("query")
    sp.add_argument("--limit", type=int, default=25)
    sp.set_defaults(func=cmd_search)

    sp = sub.add_parser("learn", help="Stages 5–6 & 10 — Brain Mode summary / ingest project")
    sp.add_argument("--project", help="Ingest one project into brain")
    sp.add_argument("--synth", help="Recommend best FX chain for synth")
    sp.add_argument("--narrative-only", action="store_true")
    sp.set_defaults(func=cmd_learn)

    sp = sub.add_parser("dna", help="Stage 8 — extract Project DNA from one file")
    sp.add_argument("path")
    sp.set_defaults(func=cmd_dna)

    sp = sub.add_parser("serve", help="SHIBASS S1 player panel + Cubase Bridge HTTP API")
    add_roots(sp)
    sp.add_argument("--host", default="0.0.0.0")
    sp.add_argument("--port", type=int, default=18766)
    sp.add_argument("--index", action="store_true", help="Re-index media before serving")
    sp.set_defaults(func=cmd_serve)

    sp = sub.add_parser("status", help="DB + roots overview")
    add_roots(sp)
    sp.set_defaults(func=cmd_status)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args) or 0)


if __name__ == "__main__":
    raise SystemExit(main())
