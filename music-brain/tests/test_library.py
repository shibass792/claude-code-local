"""Tests for library classification."""

from music_brain.library.classifier import (
    LIBRARY_LOOPS,
    LIBRARY_MUSIC,
    LIBRARY_SAMPLES,
    classify_path,
    detect_sample_sub,
)


def test_classify_music_path():
    kind, library, sub = classify_path(
        r"C:\Users\shibass\Music\Artist\Album\song.mp3"
    )
    assert kind == "music"
    assert library == LIBRARY_MUSIC


def test_classify_sample_pack():
    kind, library, sub = classify_path(
        r"H:\Samples\Fullon\Kicks\kick_01.wav",
        category_hint="kick",
    )
    assert kind == "sample"
    assert library == LIBRARY_SAMPLES
    assert sub == "kick"


def test_classify_loop_folder():
    kind, library, sub = classify_path(
        r"D:\Samples\Drum Loops\psy_loop.wav",
    )
    assert library == LIBRARY_LOOPS


def test_duration_makes_music():
    kind, library, _ = classify_path(
        r"D:\Downloads\track.flac",
        duration_sec=240.0,
    )
    assert library == LIBRARY_MUSIC
    assert kind == "music"


def test_detect_sample_sub_from_path():
    assert detect_sample_sub(r"H:\pack\bass\sub.wav", None) == "bass"
