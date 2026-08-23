# ShiBass Studio — Service Map & MIDI Forge

## The port treaty (final topology, 2026-08-23)

| Port | Service | Runs on | UI |
|---|---|---|---|
| **8788** | Synth Studio (Antigravity's FastAPI — catalog, Sylenth DSP, VST3 scan) | C:\Python314 | `/sb-synths-midi-player.html` |
| **8791** | music_brain — S1 player + **MIDI Forge** + knowledge DB | stack venv (3.12) | `/` |
| **8790** | Control Center (stack bridge) | Python312 | `/` |
| **8792** | SHIBASS_SHARED_MEMORY (pre-existing — do not touch) | Python312 | — |
| **8793** | **VST Host** — pedalboard live engine, RME out, Impulse MIDI in | gpu venv (3.11) | `/` rack, `/shell` sidebar |

**Desktop app:** `services\synths_midi_player\dist\ShiBassControlCenter.exe` (14.5MB)
boots all services and opens the dark sidebar shell (Ctrl+1..4 switches panels).
Rebuild: `BUILD_EXE.cmd`. Agent watchdog log: `07_LOGS\agent_monitor.log`.
Antigravity's export mock was replaced with a real proxy to Forge (8791); its
/api/lib + search SQL fixed to the real DB schema; fallback fake counts removed.

# MIDI Forge — Transformation & Song Expansion Engine

Lives inside `music_brain` and serves on **http://127.0.0.1:8791** (nav button **MIDI FORGE**).
Pure stdlib — no mido / numpy / torch required. 54-test suite: `scripts\midiforge_selftest.py`.

## Layout (everything under H:\shibass-ai)

| What | Where |
|---|---|
| Engine package | `claude-code-local\music-brain\music_brain\midiforge\` |
| UI (panel modal) | `music_brain\player\static\js\midiforge.js` + patched `index.html` / `shibass.css` |
| DAW bridge (watcher) | `claude-code-local\music-brain\scripts\daw_bridge.py` |
| Launcher | `SHIBASS_MUSIC_AI_STACK\launchers\DAW-BRIDGE.cmd` |
| Cubase MIDI inbox | `H:\shibass-ai\10_OUTPUTS\MIDI_EXPORT\` (export .mid here → auto-processed) |
| Generated projects | `H:\shibass-ai\10_OUTPUTS\MIDIFORGE\<name>_<stamp>\` |
| Self-test / installer | `claude-code-local\music-brain\scripts\midiforge_selftest.py`, `install_midiforge.py` |
| Pre-integration backup | `claude-code-local\_backup-music-brain-20260823-142006\` |

## HTTP API (port 8788)

```
GET  /api/midi/status                     engine + capabilities
GET  /api/midi/analyze?path=<file.mid>    key/scale (incl. Phrygian), roles, groove, roots
GET  /api/midi/preview?path=...           original notes as seconds (A/B reference)
POST /api/midi/transform                  generate layers, JSON preview
POST /api/midi/export                     write Cubase folder + ARRANGEMENT_GUIDE.md
```

Transform/export body (all optional except `path`):
`transforms` [lead|pad|arp|counter|bass], `complexity` 0-1, `mutation_rate` 0-1,
`scale_lock`, `octave_double`, `invert`, `pad_rhythmic`, `bass_style` rolling|offbeat,
`template` club|short, `bars`, `seed`, `source_track`, `project_name`.

## Workflow

1. Export MIDI from Cubase into `10_OUTPUTS\MIDI_EXPORT` (or pick any indexed .mid in the panel BROWSER).
2. Bridge/panel analyzes → generates 5 role files + combined + markdown guide.
3. Set Cubase to the BPM in the guide, drag the folder in, assign VSTi per the table.

## Engine facts

- Ingestion is tick-exact: start/dur/velocity round-trip byte-faithful (verified 92/92).
- Key detection excludes percussion tracks and anchors the tonic on the bass register
  (fixes relative-mode confusion, e.g. A# Minor vs D# Dorian).
- Rolling bass = KBBB: 1st 16th of every beat left open for the kick; the bass hit right
  after the kick is velocity-dipped ~30%.
- Pad voiced from C3 up; counter-melody written only into the lead's rests.
- Server venv (`SHIBASS_MUSIC_AI_STACK\runtime\venv`) stays dependency-free — audio-stage
  work (Demucs / Basic Pitch / MusicVAE) belongs in its own venv as a separate worker.

## Known trap

`C:\Users\shibass\music_brain.py` shadows the package — never start the server with
`C:\Users\shibass` as the working directory (the launcher sets cwd correctly).
