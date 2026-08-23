"""Natural-language AI search (Stage 9) — 'באס כמו Astrix', 'Kick ל־145 Full On'."""

from __future__ import annotations

import re
from typing import Any

from music_brain.config import ARTIST_STYLE_MAP, BASS_STYLES, KICK_STYLES, LEAD_STYLES
from music_brain.db import KnowledgeDB
from music_brain.matcher import match_for


def parse_query(query: str) -> dict[str, Any]:
    q = query.strip()
    lower = q.lower()
    intent: dict[str, Any] = {
        "raw": q,
        "family": None,
        "style": None,
        "key": None,
        "bpm": None,
        "bpm_min": None,
        "bpm_max": None,
        "artist": None,
        "genre": None,
        "text": None,
    }

    # Family
    family_map = {
        "bass": "bass",
        "באס": "bass",
        "kick": "kick",
        "קיק": "kick",
        "lead": "lead",
        "ליד": "lead",
        "מלודי": "lead",
        "melody": "lead",
        "pad": "pad",
        "פאד": "pad",
        "fx": "fx",
        "vocal": "vocal",
        "ווקל": "vocal",
    }
    for needle, fam in family_map.items():
        if needle in lower:
            intent["family"] = fam
            break

    # Artist references: "כמו Astrix" / "like Ranji"
    m = re.search(r"(?:כמו|like|similar to)\s+([a-z0-9][a-z0-9 \.]+)", lower)
    if m:
        artist = m.group(1).strip().rstrip(".")
        intent["artist"] = artist
        meta = ARTIST_STYLE_MAP.get(artist)
        if not meta:
            # partial match
            for k, v in ARTIST_STYLE_MAP.items():
                if k in artist or artist in k:
                    meta = v
                    intent["artist"] = k
                    break
        if meta:
            intent["genre"] = meta.get("genre")
            if intent["family"] and meta.get(intent["family"]):
                intent["style"] = meta[intent["family"]]
            elif not intent["family"]:
                # default to bass if artist known for bass
                if "bass" in meta:
                    intent["family"] = "bass"
                    intent["style"] = meta["bass"]
                elif "lead" in meta:
                    intent["family"] = "lead"
                    intent["style"] = meta["lead"]

    # Explicit styles
    for style in list(BASS_STYLES) + list(KICK_STYLES) + list(LEAD_STYLES):
        if style.lower() in lower:
            intent["style"] = style
            if "bass" in style.lower():
                intent["family"] = intent["family"] or "bass"
            if "kick" in style.lower():
                intent["family"] = intent["family"] or "kick"
            if "lead" in style.lower():
                intent["family"] = intent["family"] or "lead"

    # Shorthand Full On / Progressive / Goa / Dark
    if "full on" in lower or "fullon" in lower:
        intent["genre"] = intent["genre"] or "Full On"
        if intent["family"] == "bass":
            intent["style"] = intent["style"] or "FullOn Bass"
        if intent["family"] == "kick":
            intent["style"] = intent["style"] or "FullOn Kick"
    if "progressive" in lower or "prog" in lower:
        intent["genre"] = intent["genre"] or "Progressive Psy"
        if intent["family"] == "bass":
            intent["style"] = intent["style"] or "Progressive Bass"
    if "goa" in lower:
        intent["style"] = intent["style"] or ("Goa Bass" if intent["family"] == "bass" else intent["style"])
    if "dark" in lower:
        if intent["family"] == "bass":
            intent["style"] = intent["style"] or "Dark Bass"
        if intent["family"] == "kick":
            intent["style"] = intent["style"] or "Dark Kick"

    # BPM
    m = re.search(r"(1[0-8][0-9])\s*bpm", lower)
    if not m:
        m = re.search(r"(?:ל|at|@)[\s\u05be\u2013\u2014\-]*(1[0-8][0-9])\b", lower)
    if not m:
        m = re.search(r"\b(1[2-5][0-9])\b", lower)
    if m:
        bpm = int(m.group(1))
        intent["bpm"] = bpm
        intent["bpm_min"] = bpm - 4
        intent["bpm_max"] = bpm + 4

    # Key
    m = re.search(r"\b([a-g])\s?(#|b)?\s?(m|min|minor)?\b", lower)
    if m and "bpm" not in (m.group(0) or ""):
        note = m.group(1).upper()
        acc = m.group(2) or ""
        if acc == "b":
            flat_map = {"D": "C#", "E": "D#", "G": "F#", "A": "G#", "B": "A#"}
            note = flat_map.get(note, note)
            acc = "#" if note in flat_map.values() else ""
        mode = "m" if m.group(3) else ""
        # Avoid treating 'a' article / Hebrew noise — require # or m or explicit key word
        if m.group(2) or m.group(3) or "key" in lower or "סולם" in lower:
            intent["key"] = f"{note}{acc}{mode}"

    # Residual free-text tokens for path search
    stop = {
        "אני", "רוצה", "באס", "ליד", "קיק", "כמו", "שמתאים", "ל", "the", "a", "an",
        "like", "bass", "kick", "lead", "want", "find", "me", "for", "full", "on",
        "bpm", "key", "pad", "fx", "vocal",
    }
    tokens = [t for t in re.split(r"\W+", lower) if t and t not in stop and len(t) > 1]
    intent["text"] = " ".join(tokens[:6]) or None
    return intent


def search(db: KnowledgeDB, query: str, *, limit: int = 25) -> dict[str, Any]:
    intent = parse_query(query)
    results: list[dict[str, Any]] = []

    if intent["family"]:
        results = match_for(
            db,
            target_family=intent["family"],
            key=intent.get("key"),
            bpm=intent.get("bpm"),
            style=intent.get("style"),
            limit=limit,
            prefer_same_key=bool(intent.get("key")),
        )
    elif intent.get("text"):
        results = db.search_paths(intent["text"], limit=limit)
    else:
        results = db.search_paths(query, limit=limit)

    # Fallback path search if structured match empty
    if not results and intent.get("style"):
        results = db.search_paths(intent["style"].split()[0], limit=limit)
    if not results and intent.get("artist"):
        results = db.search_paths(intent["artist"], limit=limit)

    from music_brain.brain import record_search

    record_search(db, query, len(results))

    return {
        "query": query,
        "intent": intent,
        "count": len(results),
        "results": results,
        "message": _message(intent, len(results)),
    }


def _message(intent: dict[str, Any], n: int) -> str:
    bits = []
    if intent.get("family"):
        bits.append(intent["family"])
    if intent.get("style"):
        bits.append(intent["style"])
    if intent.get("artist"):
        bits.append(f"כמו {intent['artist']}")
    if intent.get("bpm"):
        bits.append(f"{intent['bpm']} BPM")
    if intent.get("key"):
        bits.append(f"Key {intent['key']}")
    label = " / ".join(bits) if bits else "השאילתה"
    if n == 0:
        return f"לא מצאתי תוצאות ל־{label}. הרץ scan+analyze על הספריות."
    return f"מצאתי {n} תוצאות ל־{label}."
