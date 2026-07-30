"""DAW Match — match a track to the arps, loops and DAW projects you already own.

Modules:
    config     resolved settings (env vars > ~/.daw-match/config.json > defaults)
    audioio    yt-dlp / ffmpeg ingest, WAV helpers
    analysis   tempo, key and energy detection with numpy
    midilib    Standard MIDI File reader plus a small synth for previews
    library    library scanning and the cached index
    matcher    scoring a library entry against an analysed track
    preview    the audio the panel's play button streams
    daw        Cubase / Ableton handoff and the pairing records
    external   adapter for a matcher script you already have
    ui         the single-page panel
"""

__version__ = "1.0.0"
