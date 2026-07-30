"""CLI — music-brain command line interface."""

from __future__ import annotations

import json
from pathlib import Path

import click
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from music_brain.brain.learner import Brain
from music_brain.bridge.cubase_bridge import CubaseBridge
from music_brain.config import load_config
from music_brain.database.knowledge_db import KnowledgeDB
from music_brain.matcher.engine import MatcherEngine
from music_brain.scanner.file_scanner import Scanner
from music_brain.search.ai_search import AISearch

console = Console()


def _get_db(config: dict) -> KnowledgeDB:
    db_path = config.get("database_path", "data/music_brain.db")
    if not Path(db_path).is_absolute():
        db_path = Path(__file__).resolve().parents[1] / db_path
    return KnowledgeDB(db_path)


@click.group()
@click.option("--config", "-c", default=None, help="Path to config.yaml")
@click.pass_context
def main(ctx: click.Context, config: str | None) -> None:
    """Music Brain — modular music production AI."""
    ctx.ensure_object(dict)
    ctx.obj["config"] = load_config(config) if config else load_config()


@main.command()
@click.pass_context
def scan(ctx: click.Context) -> None:
    """Step 1 — scan all drives (incremental)."""
    cfg = ctx.obj["config"]
    db = _get_db(cfg)
    scanner = Scanner(
        db=db,
        scan_paths=cfg["scan_paths"],
        audio_extensions=cfg["audio_extensions"],
        project_extensions=cfg["project_extensions"],
        preset_extensions=cfg["preset_extensions"],
        plugins=cfg.get("plugins", {}),
        incremental=cfg.get("incremental", True),
    )
    console.print("[bold cyan]סורק את המחשב...[/] Scanning drives...")
    with console.status("Scanning..."):
        stats = scanner.scan()
    db.close()
    console.print(Panel(
        f"נמצאו: {stats['found']}\nחדשים: {stats['new']}\nעודכנו: {stats['updated']}",
        title="Scan Complete",
    ))


@main.command()
@click.option("--limit", "-n", default=50, help="Max files to analyze per run")
@click.option("--workers", "-w", default=1, help="Parallel workers (CPU cores)")
@click.pass_context
def analyze(ctx: click.Context, limit: int, workers: int) -> None:
    """Step 2+3 — analyze unanalyzed audio files."""
    cfg = ctx.obj["config"]
    db = _get_db(cfg)
    from music_brain.services.pipeline import analyze_batch

    rows = db.get_unanalyzed_files(limit=limit)
    console.print(f"מנתח {len(rows)} קבצים... (workers={workers})")
    stats = analyze_batch(db, limit=limit, workers=workers)
    db.close()
    console.print(Panel(
        f"הצליח: {stats['analyzed']}\nנכשל: {stats['failed']}",
        title="Analyze Complete",
    ))


@main.command()
@click.argument("project_path")
@click.pass_context
def dna(ctx: click.Context, project_path: str) -> None:
    """Step 8 — show Project DNA."""
    cfg = ctx.obj["config"]
    db = _get_db(cfg)
    brain = Brain(db)
    dna_result = brain.learn_from_project(project_path)
    db.close()
    console.print_json(data=dna_result.to_dict())


@main.command()
@click.argument("project_path")
@click.pass_context
def cubase(ctx: click.Context, project_path: str) -> None:
    """Step 7 — Cubase: recommendations on project open."""
    cfg = ctx.obj["config"]
    db = _get_db(cfg)
    matcher = MatcherEngine(db, cfg.get("matcher_weights"))
    brain = Brain(db)
    bridge_cfg = cfg.get("cubase_bridge", {})
    bridge = CubaseBridge(
        db, matcher, brain,
        enabled=bridge_cfg.get("enabled", False),
        osc_host=bridge_cfg.get("osc_host", "127.0.0.1"),
        osc_port=bridge_cfg.get("osc_port", 9000),
    )
    result = bridge.on_project_open(project_path)
    db.close()

    console.print(Panel(result["message_he"], title="Cubase AI"))
    if result["matching_basses"]:
        table = Table(title="Matching Basses")
        table.add_column("Path")
        table.add_column("Score")
        for b in result["matching_basses"][:10]:
            table.add_row(
                str(b.get("path", ""))[:60],
                str(b.get("score", "-")),
            )
        console.print(table)


@main.command()
@click.argument("query")
@click.option("--limit", "-n", default=20)
@click.pass_context
def search(ctx: click.Context, query: str, limit: int) -> None:
    """Step 9 — AI search: 'באס כמו Astrix' / 'kick for 145 full on'."""
    cfg = ctx.obj["config"]
    db = _get_db(cfg)
    matcher = MatcherEngine(db, cfg.get("matcher_weights"))
    ai_search = AISearch(db, matcher)
    results = ai_search.search(query, limit=limit)
    db.close()

    table = Table(title=f"Search: {query}")
    table.add_column("File")
    table.add_column("Style")
    table.add_column("BPM")
    table.add_column("Key")
    table.add_column("Score")
    for r in results:
        table.add_row(
            Path(r["path"]).name[:40],
            str(r.get("sub_style", "-")),
            str(r.get("bpm", "-")),
            str(r.get("key", "-")),
            f"{r['score']:.2f}",
        )
    console.print(table)


@main.command()
@click.argument("file_id", type=int)
@click.option("--category", "-c", default=None)
@click.pass_context
def match(ctx: click.Context, file_id: int, category: str | None) -> None:
    """Step 4 — find compatible sounds for a file."""
    cfg = ctx.obj["config"]
    db = _get_db(cfg)
    matcher = MatcherEngine(db, cfg.get("matcher_weights"))
    results = matcher.find_matches_for_file(file_id, target_category=category)

    for r in results[:15]:
        path_row = db._conn.execute(
            "SELECT path FROM files WHERE id=?", (r.target_id,)
        ).fetchone()
        name = Path(path_row["path"]).name if path_row else f"id={r.target_id}"
        console.print(f"  [{r.score:.2f}] {name}")
        for reason in r.reasons[:2]:
            console.print(f"    → {reason}")

    db.close()


@main.command()
@click.pass_context
def stats(ctx: click.Context) -> None:
    """Step 5 — usage stats (plugins, BPM, keys)."""
    cfg = ctx.obj["config"]
    db = _get_db(cfg)
    brain = Brain(db)
    profile = brain.get_workflow_profile()
    db.close()

    console.print(Panel("Plugin Usage", style="bold"))
    for p in profile["plugin_usage"].get("plugins", [])[:10]:
        console.print(f"  {p['percent']:5.1f}%  {p['name']} ({p['count']} projects)")

    console.print(Panel("BPM & Key", style="bold"))
    for b in profile["bpm_and_key"].get("top_bpms", []):
        console.print(f"  {b['bpm']} BPM — {b['percent']}%")
    for k in profile["bpm_and_key"].get("top_keys", []):
        console.print(f"  {k['key']} — {k['percent']}%")


@main.command()
@click.option("--plugin", "-p", default="Serum")
@click.pass_context
def chains(ctx: click.Context, plugin: str) -> None:
    """Step 6 — recommend plugin chains."""
    cfg = ctx.obj["config"]
    db = _get_db(cfg)
    brain = Brain(db)
    recs = brain.recommend_plugin_chain(plugin)
    db.close()

    for i, rec in enumerate(recs, 1):
        chain_str = " → ".join(rec["chain"])
        console.print(f"{i}. {chain_str}  (used {rec['usage_count']}x)")


@main.command()
@click.pass_context
def brain(ctx: click.Context) -> None:
    """Step 10 — Brain Mode workflow profile."""
    cfg = ctx.obj["config"]
    db = _get_db(cfg)
    learner = Brain(db)
    profile = learner.get_workflow_profile()
    db.close()
    console.print_json(data=profile)


@main.command()
@click.pass_context
def status(ctx: click.Context) -> None:
    """Show database status."""
    cfg = ctx.obj["config"]
    db = _get_db(cfg)
    counts = db.count_files()
    unanalyzed = len(db.get_unanalyzed_files(limit=10000))
    projects = db.get_project_stats()
    db.close()

    table = Table(title="Music Brain Status")
    table.add_column("Metric")
    table.add_column("Value")
    for kind, count in counts.items():
        table.add_row(f"Files ({kind})", str(count))
    table.add_row("Unanalyzed audio", str(unanalyzed))
    table.add_row("Projects indexed", str(projects.get("total_projects", 0)))
    console.print(table)


@main.command()
@click.option("--limit", "-n", default=500)
@click.option("--workers", "-w", default=1)
@click.pass_context
def pipeline(ctx: click.Context, limit: int, workers: int) -> None:
    """Run full pipeline: scan → learn projects → analyze audio."""
    cfg = ctx.obj["config"]
    db = _get_db(cfg)
    from music_brain.services.pipeline import run_full_pipeline

    console.print("[bold]Music Brain Pipeline[/]")
    result = run_full_pipeline(db, cfg, analyze_limit=limit, workers=workers)
    db.close()
    console.print_json(data=result)


@main.command()
@click.option("--interval", "-i", default=300, help="Poll interval (seconds)")
@click.option("--events", is_flag=True, help="Use watchdog events (needs pip install watchdog)")
@click.pass_context
def watch(ctx: click.Context, interval: int, events: bool) -> None:
    """Brain Mode — auto scan + analyze in background."""
    cfg = ctx.obj["config"]
    db = _get_db(cfg)

    def on_tick(result: dict) -> None:
        console.print(f"[dim]tick[/] scan={result['scan']} analyze={result['analyze']}")

    if events:
        from music_brain.scanner.watcher import run_watchdog
        console.print("[cyan]Watching with watchdog (Ctrl+C to stop)...[/]")
        try:
            run_watchdog(db, cfg)
        except KeyboardInterrupt:
            pass
    else:
        from music_brain.scanner.watcher import MusicBrainWatcher
        w = MusicBrainWatcher(db, cfg, interval_sec=interval, on_tick=on_tick)
        console.print(f"[cyan]Polling every {interval}s (Ctrl+C to stop)...[/]")
        try:
            w.run_forever()
        except KeyboardInterrupt:
            w.stop()
    db.close()


@main.command()
@click.option("--dir", "-d", default=None, help="Backup directory")
@click.pass_context
def backup(ctx: click.Context, dir: str | None) -> None:
    """Backup music_brain.db (keeps last 10)."""
    cfg = ctx.obj["config"]
    db_path = cfg.get("database_path", "data/music_brain.db")
    if not Path(db_path).is_absolute():
        db_path = Path(__file__).resolve().parents[1] / db_path
    from music_brain.database.backup import backup_database

    dest = backup_database(db_path, dir)
    console.print(f"[green]✓[/] Backup saved: {dest}")


@main.command()
@click.option("--host", default="127.0.0.1")
@click.option("--port", "-p", default=8787, type=int)
@click.pass_context
def serve(ctx: click.Context, host: str, port: int) -> None:
    """Local web UI — search, stats, Cubase."""
    cfg = ctx.obj["config"]
    db = _get_db(cfg)
    from music_brain.web.server import serve as run_server

    console.print(Panel(
        f"פתח בדפדפן: http://{host}:{port}",
        title="Music Brain UI",
    ))
    try:
        run_server(db, cfg, host=host, port=port)
    except KeyboardInterrupt:
        pass
    finally:
        db.close()


@main.command("index-embeddings")
@click.option("--limit", "-n", default=10000)
@click.pass_context
def index_embeddings(ctx: click.Context, limit: int) -> None:
    """Build sonic fingerprints for similarity search."""
    cfg = ctx.obj["config"]
    db = _get_db(cfg)
    from music_brain.search.sonic_index import SonicIndex

    idx = SonicIndex(db)
    count = idx.index_all(limit=limit)
    db.close()
    console.print(f"[green]✓[/] Indexed {count} sonic embeddings")


@main.command()
@click.argument("target")
@click.option("--style", "-s", default=None, help="Artist style: astrix, ranji...")
@click.option("--limit", "-n", default=20)
@click.pass_context
def similar(ctx: click.Context, target: str, style: str | None, limit: int) -> None:
    """Find similar sounds — by file path/id or artist style."""
    cfg = ctx.obj["config"]
    db = _get_db(cfg)
    from music_brain.search.sonic_index import SonicIndex

    idx = SonicIndex(db)
    if style:
        results = idx.find_similar_to_style(style, limit=limit)
    else:
        row = db.get_file_by_path(target)
        file_id = int(row["id"]) if row else None
        if file_id is None and target.isdigit():
            file_id = int(target)
        if file_id is None:
            console.print("[red]File not found in database. Run scan + analyze first.[/]")
            db.close()
            return
        results = idx.find_similar_to_file(file_id, limit=limit)
    db.close()

    table = Table(title=f"Similar to: {style or target}")
    table.add_column("File")
    table.add_column("Style")
    table.add_column("Score")
    for r in results:
        table.add_row(
            Path(r["path"]).name[:45],
            str(r.get("sub_style", "-")),
            f"{r['score']:.2f}",
        )
    console.print(table)


@main.command("cubase-companion")
@click.option("--events", is_flag=True, help="Use watchdog for instant .cpr detection")
@click.option("--interval", "-i", default=10)
@click.pass_context
def cubase_companion_cmd(ctx: click.Context, events: bool, interval: int) -> None:
    """Watch Cubase project folders — auto recommendations on save."""
    cfg = ctx.obj["config"]
    db = _get_db(cfg)
    from music_brain.bridge.cubase_companion import CubaseCompanion, run_cubase_watchdog

    def on_rec(result: dict) -> None:
        console.print(Panel(result.get("message_he", ""), title="Cubase AI"))

    if events:
        try:
            run_cubase_watchdog(db, cfg, on_recommendations=on_rec)
        except KeyboardInterrupt:
            pass
    else:
        companion = CubaseCompanion(db, cfg, on_recommendations=on_rec)
        console.print("[cyan]Cubase Companion running (Ctrl+C to stop)...[/]")
        try:
            companion.run_forever(interval_sec=interval)
        except KeyboardInterrupt:
            pass
    db.close()


if __name__ == "__main__":
    main()
