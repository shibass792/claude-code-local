"""MIDI Forge HTTP routes — plugged into the existing player handler on 8788.

Returns (status_code, payload) or None when the path isn't ours, so the host
handler can fall through to its own 404. No framework, no extra port.

Routes
------
GET  /api/midi/analyze?path=...        Stage 1+2 — faithful parse + DNA
GET  /api/midi/preview?path=...        Original notes as seconds (A/B reference)
GET  /api/midi/status                  Engine capabilities
POST /api/midi/transform               Stage 3 — generate layers, returns preview
POST /api/midi/export                  Stage 4 — write Cubase folder + guide
"""

from __future__ import annotations

import traceback
from pathlib import Path
from typing import Any

from music_brain.midiforge import analysis as ana
from music_brain.midiforge import arrange as arr
from music_brain.midiforge import export as exp
from music_brain.midiforge import generate as gen
from music_brain.midiforge.smf import MidiData, Track, notes_to_preview, read_midi

_MIDI_EXT = {".mid", ".midi"}
_cache: dict[str, tuple[float, MidiData, ana.Analysis]] = {}


def _resolve(db: Any, raw: str) -> Path | None:
    """Reuse the player's path gate so we never read outside indexed roots."""
    if not raw:
        return None
    try:
        from music_brain.player.media import resolve_media_path

        p = resolve_media_path(db, raw)
        if p and p.suffix.lower() in _MIDI_EXT:
            return p
    except Exception:
        pass
    p = Path(raw)
    try:
        p = p.resolve()
    except OSError:
        return None
    if p.is_file() and p.suffix.lower() in _MIDI_EXT:
        return p
    return None


def _load(db: Any, raw: str) -> tuple[MidiData, ana.Analysis, Path]:
    p = _resolve(db, raw)
    if not p:
        raise FileNotFoundError(f"MIDI not found or not indexed: {raw}")
    mtime = p.stat().st_mtime
    hit = _cache.get(str(p))
    if hit and hit[0] == mtime:
        return hit[1], hit[2], p
    md = read_midi(p)
    an = ana.analyze(md)
    _cache[str(p)] = (mtime, md, an)
    if len(_cache) > 24:
        _cache.pop(next(iter(_cache)))
    return md, an, p


def _pick(md: MidiData, an: ana.Analysis, roles: tuple[str, ...]) -> Track | None:
    """Best source track for a role, by note count."""
    cands = [(p.note_count, p.index) for p in an.tracks if p.role in roles]
    if not cands:
        return None
    cands.sort(reverse=True)
    return md.tracks[cands[0][1]]


def _source_track(md: MidiData, an: ana.Analysis, explicit: Any = None) -> Track | None:
    """The melodic phrase generators feed on.

    An explicit index always wins. Otherwise prefer melodic roles — but a
    6-note stab labelled 'lead' must never beat a 1300-note sequence labelled
    'arp', so within the melodic pool the densest track wins outright.
    """
    if explicit is not None:
        try:
            idx = int(explicit)
            if 0 <= idx < len(md.tracks):
                return md.tracks[idx]
        except (TypeError, ValueError):
            pass
    melodic = [(p.note_count, p.index) for p in an.tracks if p.role in ("lead", "arp", "counter")]
    if melodic:
        melodic.sort(reverse=True)
        return md.tracks[melodic[0][1]]
    return _pick(md, an, ("pad",)) or (md.tracks[0] if md.tracks else None)


# ---------------------------------------------------------------------------
# GET
# ---------------------------------------------------------------------------


def handle_get(db: Any, path: str, qs: dict[str, list[str]]) -> tuple[int, Any] | None:
    route = (path or "").rstrip("/")
    if not route.startswith("/api/midi"):
        return None

    try:
        if route == "/api/midi/status":
            try:
                import mido  # noqa: F401

                backend = "mido (optional) + builtin"
            except Exception:
                backend = "builtin stdlib SMF"
            return 200, {
                "ok": True,
                "engine": "MIDI Forge",
                "version": "1.0.0",
                "backend": backend,
                "export_root": str(exp.default_export_root()),
                "transforms": ["pad", "arp", "counter", "bass", "lead"],
                "templates": list(arr.TEMPLATES.keys()),
                "scales": list(ana.SCALES.keys()),
            }

        if route == "/api/midi/analyze":
            raw = (qs.get("path") or qs.get("id") or [""])[0]
            md, an, p = _load(db, raw)
            return 200, {
                "ok": True,
                "path": str(p),
                "name": p.name,
                "analysis": an.to_dict(),
                "suggested_source_track": (
                    _source_track(md, an).name if _source_track(md, an) else None
                ),
            }

        if route == "/api/midi/preview":
            raw = (qs.get("path") or qs.get("id") or [""])[0]
            track_idx = (qs.get("track") or [None])[0]
            md, an, p = _load(db, raw)
            if track_idx is not None:
                src = _source_track(md, an, track_idx)
                notes = src.notes if src else []
            else:
                notes = md.all_notes()
            return 200, {
                "ok": True,
                "path": str(p),
                "bpm": round(md.bpm, 2),
                "key": f"{an.key_name} {an.scale}",
                "count": len(notes),
                "notes": notes_to_preview(md, notes, max_notes=500),
            }

        return 404, {"error": "unknown midi route", "route": route}

    except FileNotFoundError as e:
        return 404, {"ok": False, "error": str(e)}
    except Exception as e:  # noqa: BLE001
        return 500, {"ok": False, "error": str(e), "trace": traceback.format_exc(limit=4)}


# ---------------------------------------------------------------------------
# POST
# ---------------------------------------------------------------------------


def _build_layers(md: MidiData, an: ana.Analysis, body: dict[str, Any]) -> dict[str, Track]:
    """Run the requested generators and return layer_key -> Track."""
    want = body.get("transforms") or ["lead", "pad", "arp", "counter", "bass"]
    if isinstance(want, str):
        want = [want]
    want = [str(w).strip().lower() for w in want]

    complexity = float(body.get("complexity", 0.5))
    mutation = float(body.get("mutation_rate", 0.35))
    seed = int(body.get("seed", 0))
    scale_lock = bool(body.get("scale_lock", True))
    bars = int(body.get("bars") or an.bars)
    bars = max(1, min(256, bars))

    src = _source_track(md, an, body.get("source_track"))
    bass_src = _pick(md, an, ("bass",))
    out: dict[str, Track] = {}

    if "lead" in want and src:
        out["lead"] = gen.enhance_lead(
            md, an, src,
            octave_layer=bool(body.get("octave_double", True)),
            harmony_interval=int(body.get("harmony_interval", 0)),
            seed=seed,
        )
    if "pad" in want:
        out["pad"] = gen.generate_pad(
            md, an,
            bars=bars,
            complexity=complexity,
            octave=int(body.get("pad_octave", 4)),
            rhythmic=bool(body.get("pad_rhythmic", False)),
            seed=seed,
        )
    if "arp" in want and src:
        out["arp"] = gen.mutate_arp(
            md, an, src,
            mutation_rate=mutation,
            rhythmic_shift=bool(body.get("rhythmic_shift", True)),
            octave_double=bool(body.get("octave_double", False)),
            invert=bool(body.get("invert", False)),
            scale_lock=scale_lock,
            seed=seed,
        )
    if "counter" in want and src:
        out["counter"] = gen.generate_counter_melody(
            md, an, src, complexity=complexity, seed=seed
        )
    if "bass" in want:
        out["bass"] = gen.generate_bass_root_sync(
            md, an,
            bars=bars,
            style=str(body.get("bass_style", "rolling")),
            octave=int(body.get("bass_octave", 1)),
            seed=seed,
        )
    # If the source already has a real bassline and the user didn't ask to
    # replace it, keep theirs as the reference instead of overwriting.
    if bass_src and body.get("keep_original_bass"):
        out["bass"] = Track(
            name="Bassline (original)",
            notes=[n.copy(channel=4) for n in bass_src.sorted_notes()],
            channel=4,
            role="bass",
        )
    return out


def handle_post(db: Any, path: str, body: dict[str, Any]) -> tuple[int, Any] | None:
    route = (path or "").rstrip("/")
    if not route.startswith("/api/midi"):
        return None

    try:
        raw = str(body.get("path") or body.get("id") or "")

        if route == "/api/midi/transform":
            md, an, p = _load(db, raw)
            layers = _build_layers(md, an, body)
            preview_layer = str(body.get("preview") or "").lower()
            previews: dict[str, Any] = {}
            for key, tr in layers.items():
                if preview_layer and key != preview_layer:
                    continue
                previews[key] = {
                    "track_name": tr.name,
                    "note_count": len(tr.notes),
                    "notes": notes_to_preview(md, tr.notes, max_notes=300),
                }
            return 200, {
                "ok": True,
                "path": str(p),
                "bpm": round(md.bpm, 2),
                "key": f"{an.key_name} {an.scale}",
                "bars": an.bars,
                "layers": {k: len(v.notes) for k, v in layers.items()},
                "previews": previews,
            }

        if route == "/api/midi/export":
            md, an, p = _load(db, raw)
            layers = _build_layers(md, an, body)
            if not any(t.notes for t in layers.values()):
                return 400, {"ok": False, "error": "no layers generated — check transforms/source track"}
            arrangement = arr.build_arrangement(an, str(body.get("template", "club")))
            result = exp.export_project(
                md, an, layers, arrangement,
                project_name=str(body.get("project_name") or p.stem),
                out_root=body.get("out_root"),
                source_path=str(p),
            )
            try:
                db.brain_event(
                    "midiforge_export",
                    {"source": str(p), "project_dir": result["project_dir"],
                     "layers": list(layers.keys()), "key": f"{an.key_name} {an.scale}"},
                )
            except Exception:
                pass
            result["arrangement"] = arrangement
            result["key"] = f"{an.key_name} {an.scale}"
            result["bpm"] = round(md.bpm, 2)
            return 200, result

        return 404, {"error": "unknown midi route", "route": route}

    except FileNotFoundError as e:
        return 404, {"ok": False, "error": str(e)}
    except Exception as e:  # noqa: BLE001
        return 500, {"ok": False, "error": str(e), "trace": traceback.format_exc(limit=4)}
