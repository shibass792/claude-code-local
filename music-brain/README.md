# Music Brain

Local production intelligence for **Cubase / Ableton / Studio One**.

Scans your drives once, analyzes samples & projects, learns your style, and
recommends basses / leads / FX chains that fit — even when the key differs.

## Stages

| Stage | Module | What it does |
|------:|--------|----------------|
| 1 | `scanner` | Incremental scan of `H:\` `D:\` `F:\` `C:\Users\shibass\` — Cubase, Ableton, Studio One, Serum, Sylenth, Vital, Kontakt, Omnisphere, Kick 3, Battery, Groove Agent, sample libs |
| 2 | `analyzer.styles` | Classifies Rolling / Offbeat / FullOn / Progressive / Dark / Goa bass, kick, lead, pad, FX, vocal |
| 3 | `analyzer.audio` | Transient, Attack, Release, Envelope, Stereo Width, Dynamics, RMS, LUFS≈, MFCC, Spectral Roll-off, Tonnetz, Chroma, Contrast, Tempo/Key confidence |
| 4 | `matcher` | Kick↔Bass fit by pitch **+** envelope **+** transient (key optional) |
| 5–6 | `brain` | Learns plugin % (Serum/Sylenth/Vital), favorite Key/BPM, best FX chains |
| 7 | `cubase` | Localhost bridge: "מצאתי 26 באסים שמתאימים" |
| 8 | `analyzer.project_dna` | Project DNA: BPM, Key, Mood, Genre, styles, plugins, presets, samples |
| 9 | `search` | NL: "באס כמו Astrix", "Lead כמו Ranji", "Kick ל־145 Full On" |
| 10 | Brain Mode | Every new project teaches the engine your workflow |

## Permanent install (Windows)

```bat
launchers\MusicBrain-Install.cmd
```

This plants SHIBASS on the PC:

- Desktop shortcuts: **SHIBASS Player**, **SHIBASS Scan**, **SHIBASS Remote**
- Persistent scan memory: `%LOCALAPPDATA%\MusicBrain\knowledge.db`
- User env: `MUSIC_BRAIN_DB`, `MUSIC_BRAIN_ROOTS`
- Starts with Windows
- Firewall rule for Rokid (`TCP 18766`) when possible

Then:

1. Double-click **SHIBASS Player** (full panel)
2. Double-click **SHIBASS Scan** (second window — fills memory)
3. Reload `http://127.0.0.1:18766/`

Uninstall shortcuts (keeps DB): `launchers\MusicBrain-Uninstall.cmd`

## Quick start (Windows)

**לחיצה כפולה — פותח את פאנל הנגן SHIBASS S1:**

```bat
launchers\MusicBrain-Start.cmd
```

או העתק לשולחן העבודה:

```bat
launchers\MusicBrain-Desktop.cmd
```

נפתח בדפדפן: `http://127.0.0.1:18766/`

הפאנל סורק וקורא **MIDI / WAV / MP3 / FLAC / Samples** מ־`H:\` `D:\` `F:\` + הפרופיל,
עם Waveform, Spectrum, EQ, Playlist, Browser ופסנתר MIDI.

פקודות נוספות:

```bat
launchers\Music-Brain.cmd setup
launchers\Music-Brain.cmd pipeline
launchers\Music-Brain.cmd serve
launchers\Music-Brain.cmd search "באס כמו Astrix"
```

Or from this folder:

```bat
cd music-brain
python -m music_brain scan --root H:\ --root D:\ --root F:\ --root C:\Users\shibass
python -m music_brain analyze -v
python -m music_brain learn
python -m music_brain search "באס כמו Astrix"
python -m music_brain match --family bass --bpm 142 --limit 26
python -m music_brain serve --port 18766
```

Optional full audio stack (librosa):

```bat
pip install -e ".[audio]"
```

## Cubase Bridge API

`GET http://127.0.0.1:18766/match/bass?bpm=142&key=F#`  
`GET http://127.0.0.1:18766/match/melodies?key=F#`  
`GET http://127.0.0.1:18766/search?q=bass+like+Astrix`  
`POST http://127.0.0.1:18766/project/open` `{"path":"H:\\Projects\\track.cpr"}`  
`GET http://127.0.0.1:18766/stats`

## Architecture

```
Scanner  →  Analyzer  →  Knowledge DB (SQLite)
                              ↓
                     Matcher Engine
                              ↓
              Cubase Bridge  +  NL Search  +  Brain Mode
```

- **Scanner** only re-indexes new / mtime-changed files.
- **Knowledge DB** default: `%LOCALAPPDATA%\MusicBrain\knowledge.db` (Windows) or `~/.music-brain/knowledge.db`.
- Override roots: `MUSIC_BRAIN_ROOTS=H:\;D:\;F:\` or `--root` flags.
- Override DB: `MUSIC_BRAIN_DB=...` or `--db`.

## Tests

```bat
cd music-brain
python -m pytest -q
```
