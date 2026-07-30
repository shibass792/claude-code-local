"""Classify videos and guide documents by path keywords."""

from __future__ import annotations

from pathlib import Path

COURSE_KEYWORDS = [
    "course",
    "courses",
    "lesson",
    "lessons",
    "class",
    "training",
    "workshop",
    "masterclass",
    "academy",
    "udemy",
    "skillshare",
    "shibass",
    "קורס",
    "שיעור",
    "שיעורים",
    "הדרכה",
    "לימוד",
]

TUTORIAL_KEYWORDS = [
    "tutorial",
    "tutorials",
    "howto",
    "how-to",
    "walkthrough",
    "tips",
    "tricks",
    "מדריך",
    "מדריכים",
    "הסבר",
]

GUIDE_KEYWORDS = [
    "guide",
    "guides",
    "manual",
    "handbook",
    "readme",
    "documentation",
    "docs",
    "מדריך",
    "חוברת",
]

DAW_KEYWORDS = [
    "cubase",
    "ableton",
    "serum",
    "vital",
    "fl studio",
    "logic",
    "producing",
    "mixing",
    "mastering",
    "psytrance",
    "bass",
]

CATEGORY_LABELS_HE = {
    "course": "קורס",
    "tutorial": "מדריך / טוטוריאל",
    "guide": "מדריך כתוב",
    "video": "וידאו",
    "other": "אחר",
}


def _path_blob(path: str | Path) -> str:
    return str(path).lower().replace("\\", "/")


def classify_video_category(path: str | Path, keywords: list[str] | None = None) -> str:
    """Return course | tutorial | video | other."""
    blob = _path_blob(path)
    extra = [k.lower() for k in (keywords or [])]
    checks = [
        ("course", COURSE_KEYWORDS + extra),
        ("tutorial", TUTORIAL_KEYWORDS + extra),
    ]
    for cat, kws in checks:
        if any(kw in blob for kw in kws):
            return cat
    if any(kw in blob for kw in DAW_KEYWORDS):
        return "tutorial"
    return "video"


def classify_guide_category(path: str | Path) -> str:
    blob = _path_blob(path)
    if any(kw in blob for kw in GUIDE_KEYWORDS + COURSE_KEYWORDS + TUTORIAL_KEYWORDS):
        return "guide"
    return "other"


def detect_daw_topic(path: str | Path) -> str | None:
    blob = _path_blob(path)
    for kw in DAW_KEYWORDS:
        if kw in blob:
            return kw.replace(" ", "_")
    return None
