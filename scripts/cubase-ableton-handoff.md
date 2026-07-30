# Cubase ↔ Ableton — Handoff Guide (best practical method)
# No perfect 1:1 project convert. This package keeps the MUSIC intact.

## Golden rule
Export: MIDI + stems (WAV) + reference mix + NOTES.md
Do NOT expect mixer, buses, sidechains, or plugin chains to transfer.

## Folder layout
```
H:\daw-handoff\<SongName>\
  01-midi\
  02-stems\
  03-reference\
  04-notes\
     NOTES.md
  05-original\          (optional copies of .cpr / .als — for archive only)
```

## Cubase → Ableton
1. Open project in Cubase. Set sample rate (e.g. 48 kHz). Note BPM.
2. File → Export → MIDI File (or export selected MIDI tracks). Save into `01-midi\`.
3. Export tempo/markers if available (Tempo Track / Markers).
4. For each track/group: File → Export → Audio Mixdown
   - Channel batch / multiple channels if available
   - WAV, 24-bit, same sample rate, from project start
   - Name: `01_kick.wav`, `02_bass.wav`, ...
   - Save into `02-stems\`
5. Export full stereo mix → `03-reference\SongName_ref.wav`
6. Fill `04-notes\NOTES.md` (plugin list, key, BPM, quirks).
7. In Ableton: new set → set BPM → drag MIDI + stems → verify vs reference.

## Ableton → Cubase
1. Open set in Ableton. Note BPM + sample rate.
2. Select MIDI clips/tracks → Export MIDI → `01-midi\`
3. Export → Audio
   - All tracks / selected tracks as individual files (WAV 24-bit)
   - Include return/group prints if needed as stems
   - Save into `02-stems\`
4. Export master → `03-reference\`
5. Fill NOTES.md
6. In Cubase: new project → same sample rate/BPM → import MIDI + audio → align to bar 1.

## What transfers well
- Audio stems, MIDI notes, tempo, song structure (via markers/names)

## What does NOT transfer
- Cubase/Ableton mixer, stock instruments, expression maps, complex automation, sidechains

## AI memory
After building a handoff folder, run:
```
powershell -ExecutionPolicy Bypass -File H:\models\daw-handoff.ps1 -Remember -Song "MySong"
```
This indexes the handoff + project paths into myllama (no file copy — path index + live pull).
