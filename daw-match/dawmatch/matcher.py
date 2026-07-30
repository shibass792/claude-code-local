"""Score library entries against an analysed track.

Three things decide a match, in descending weight:

* **Tempo** — with credit for musically valid relationships. A 64 BPM arp over a
  128 BPM track is not a miss, it is half-time, so ratios of 2, 1/2, 3/2 and 2/3
  score well with a small penalty rather than falling off a cliff.
* **Key** — same key wins, then the relative major/minor, then neighbours on the
  circle of fifths. Those are the swaps that actually work in a session.
* **Timbre** — brightness and loudness, a light tiebreaker between two entries
  that already agree on tempo and key.
"""
import math

from .analysis import PITCH_NAMES

WEIGHT_BPM = 0.5
WEIGHT_KEY = 0.36
WEIGHT_TIMBRE = 0.14

# ratio -> penalty applied to a perfect tempo score
TEMPO_RATIOS = {
    1.0: 0.0,
    2.0: 0.10,    # arp is double-time
    0.5: 0.10,    # arp is half-time
    1.5: 0.22,    # 3:2, works but needs intent
    2.0 / 3.0: 0.22,
    4.0: 0.30,
    0.25: 0.30,
}

# Distance around the circle of fifths, indexed by semitone interval.
_FIFTHS_POSITION = {}
for _i in range(12):
    _FIFTHS_POSITION[(_i * 7) % 12] = min(_i, 12 - _i)


def tempo_score(track_bpm, entry_bpm):
    """Return (score 0..1, human label) for a tempo pairing."""
    if not track_bpm or not entry_bpm:
        return 0.35, "tempo unknown"

    best_score, best_label = 0.0, "tempo clash"
    for ratio, penalty in TEMPO_RATIOS.items():
        target = track_bpm * ratio
        # 4% of the target tempo is about the widest gap you can nudge without
        # the groove feeling wrong.
        tolerance = target * 0.04
        delta = abs(entry_bpm - target)
        closeness = math.exp(-((delta / max(tolerance, 1e-6)) ** 2) / 2)
        score = max(0.0, closeness * (1.0 - penalty))
        if score > best_score:
            best_score = score
            if ratio == 1.0:
                best_label = "same tempo" if delta < 0.6 else f"{entry_bpm:g} vs {track_bpm:g} BPM"
            elif ratio == 2.0:
                best_label = "double-time"
            elif ratio == 0.5:
                best_label = "half-time"
            elif ratio == 4.0:
                best_label = "4x tempo"
            elif ratio == 0.25:
                best_label = "quarter-time"
            else:
                best_label = "3:2 tempo"
    return round(best_score, 4), best_label


def key_score(track_tonic, track_mode, entry_tonic, entry_mode):
    """Return (score 0..1, human label) for a key pairing."""
    if track_tonic < 0 or entry_tonic < 0:
        return 0.35, "key unknown"

    interval = (entry_tonic - track_tonic) % 12

    if not entry_mode or not track_mode:
        # Only a tonic to go on: reward the tonic itself and its fifths.
        distance = _FIFTHS_POSITION.get(interval, 6)
        score = max(0.25, 1.0 - distance * 0.13) * 0.85
        label = "same root" if interval == 0 else f"{distance} steps on the circle of fifths"
        return round(score, 4), label

    same_mode = entry_mode == track_mode

    if interval == 0 and same_mode:
        return 1.0, "same key"
    # Relative major/minor share a key signature outright.
    if track_mode == "minor" and entry_mode == "major" and interval == 3:
        return 0.88, "relative major"
    if track_mode == "major" and entry_mode == "minor" and interval == 9:
        return 0.88, "relative minor"

    distance = _FIFTHS_POSITION.get(interval, 6)
    if same_mode and distance == 1:
        return 0.74, "a fifth away"
    if same_mode:
        return round(max(0.15, 1.0 - distance * 0.16), 4), f"{distance} steps on the circle of fifths"
    return round(max(0.1, 0.72 - distance * 0.14), 4), "different mode"


def timbre_score(track, entry):
    """Compare brightness/loudness when both sides know them."""
    pairs = [
        (track.get("brightness"), entry.get("brightness")),
        (track.get("loudness"), entry.get("loudness")),
    ]
    usable = [(a, b) for a, b in pairs if a is not None and b is not None]
    if not usable:
        return 0.5, ""
    diffs = [abs(float(a) - float(b)) for a, b in usable]
    score = max(0.0, 1.0 - sum(diffs) / len(diffs) * 1.6)
    label = "similar tone" if score > 0.72 else ("contrasting tone" if score < 0.4 else "")
    return round(score, 4), label


def score_entry(track, entry, prefer=None):
    """Score one library entry. `prefer` biases toward 'arp', 'loop' or 'project'."""
    t_score, t_label = tempo_score(track.get("bpm"), entry.get("bpm"))
    k_score, k_label = key_score(
        track.get("tonic", -1), track.get("mode", ""),
        entry.get("tonic", -1), entry.get("mode", ""),
    )
    m_score, m_label = timbre_score(track, entry)

    total = WEIGHT_BPM * t_score + WEIGHT_KEY * k_score + WEIGHT_TIMBRE * m_score

    if prefer and entry.get("kind") == prefer:
        total = min(1.0, total + 0.05)
    # Metadata we read out of the file beats metadata guessed from a filename.
    if entry.get("source") in ("midi", "audio", "sidecar", "project"):
        total = min(1.0, total + 0.02)

    reasons = [label for label in (t_label, k_label, m_label) if label]
    return {
        "score": round(min(1.0, total), 4),
        "tempo_score": t_score,
        "key_score": k_score,
        "timbre_score": m_score,
        "reasons": reasons,
    }


def rank(track, entries, prefer=None, limit=25, min_score=0.0):
    """Return entries sorted best-first, each with its scoring detail attached."""
    scored = []
    for entry in entries:
        detail = score_entry(track, entry, prefer=prefer)
        if detail["score"] < min_score:
            continue
        merged = dict(entry)
        merged.update(detail)
        scored.append(merged)
    scored.sort(key=lambda e: (-e["score"], e.get("name") or ""))
    return scored[:limit]


def describe_track(track):
    """One-line summary of an analysed track, for the UI header and logs."""
    bpm = track.get("bpm")
    key = track.get("key") or "unknown key"
    tempo = f"{bpm:g} BPM" if bpm else "tempo unknown"
    return f"{tempo} · {key}"


def key_label(tonic, mode):
    if tonic is None or tonic < 0:
        return "unknown"
    return f"{PITCH_NAMES[tonic % 12]} {mode}".strip()
