# 🎹 DAW Match — auto-match panel for Cubase & Ableton

Paste a YouTube link or an audio file. The panel reads its **tempo and key**, ranks
the **arps, loops and DAW projects you already own** against it, plays the best one
in the browser, and hands it to **Cubase** or **Ableton** with one click — recording
the track-to-arp pairing so you can find it again later.

Runs entirely on your machine. The only network call is `yt-dlp` fetching a link
you pasted yourself.

```bash
python3 panel.py                    # panel on http://127.0.0.1:4020
python3 panel.py --starter-pack     # write example arps, then index
python3 panel.py --match <url|file> # same search, printed in the terminal
python3 panel.py --scan             # reindex the library and exit
```

Or double-click **`launchers/DAW Match Panel.command`**.

---

## What it does

| Step | What happens |
|---|---|
| **1. Ingest** | `yt-dlp` pulls a link's audio; `ffmpeg` decodes anything on disk |
| **2. Analyse** | Tempo via onset-envelope autocorrelation, key via chroma matched to the Krumhansl-Schmuckler profiles, plus loudness and brightness |
| **3. Rank** | Every library entry scored on tempo (50%), key (36%) and timbre (14%) |
| **4. Audition** | ▶ synthesises MIDI arps on the fly — optionally **at the track's tempo** — or streams an excerpt of an audio loop |
| **5. Hand off** | Stages the match in a session folder, writes the pairing record, launches the DAW |

### The matching is musical, not just numeric

- **Tempo** — a 64 BPM arp under a 128 BPM track is *half-time*, not a miss. Ratios of 2, ½, 3∶2 and ⅔ all score well with a small penalty. Only genuinely unrelated tempos fall away.
- **Key** — same key first, then the relative major/minor (they share a key signature), then neighbours on the circle of fifths. Those are the swaps that actually work in a session.
- **Timbre** — brightness and loudness break ties between two entries that already agree on tempo and key.

Every result shows *why* it matched: `same tempo · relative major · similar tone`.

---

## The library

Point it at folders and it indexes what it finds:

| Kind | Extensions | Where tempo/key comes from |
|---|---|---|
| **Arps** | `.mid` `.midi` | the file's own tempo and key-signature meta, else the note histogram |
| **Loops** | `.wav` `.aif` `.aiff` `.mp3` `.flac` `.m4a` `.ogg` | full audio analysis |
| **Projects** | `.cpr` (Cubase), `.als` (Ableton) | `.als` tempo and scale are read out of its gzipped XML; `.cpr` is a closed binary format, so it falls back to the filename or a sidecar |

Default roots (missing ones are skipped silently):

```
~/Music/DAW-Match Library
~/Documents/Cubase Projects
~/Music/Ableton/User Library
```

Override with `DAW_MATCH_LIBRARY="/path/one:/path/two"`.

### Metadata precedence

1. **A sidecar** — `My Arp.dawmatch.json` next to the file. You said it, we believe it:
   ```json
   { "bpm": 174, "key": "D minor", "tags": ["dnb", "dark"], "preview": "bounce.wav" }
   ```
2. **The file itself** — MIDI meta, Ableton project XML, or a full audio analysis.
3. **The filename** — `Dark Arp 128bpm Amin.mid`, `Pluck_90_Emaj.mid`, `Riser F#m 140.mid` all parse.

The index is cached in `~/.daw-match/index.json` keyed by path + mtime + size, so
rescanning an unchanged library is nearly free.

---

## Plugging in a matcher script you already have

If you already have a script that takes a track and produces matches, point the
panel at it and its suggestions get ranked alongside the built-in library:

```bash
export DAW_MATCH_SCRIPT=~/bin/my-matcher.sh
```

It is called as `my-matcher.sh "<url or file path>"`. Print whichever shape is
easiest:

```
/Users/me/arps/Dark Arp 128 Amin.mid          # one path per line
```
```json
{ "matches": [ { "path": "…", "bpm": 128, "key": "A minor", "note": "my tagger" } ] }
```
```json
[ { "path": "…", "score": 0.9 } ]
```

Anything you assert (`bpm`, `key`, `name`) overrides what the panel sniffed from the
file. Results are badged **מהסקריפט שלך** in the UI. A script that fails, times out
or prints nonsense produces a warning — the built-in matches still come back.

---

## "Open in Cubase" — what the button actually does

1. **Stages** a session folder at `~/DAW-Match Sessions/<track-slug>/` and copies the
   matched arp into it, so the file sits next to the material it was matched to.
   Project files open *in place* — copying a `.cpr` or `.als` would detach it from
   its audio pool.
2. **Records the pairing** in `~/.daw-match/links.json` and in the folder's
   `session.json`, plus a human-readable `README.txt` with the track's tempo, key
   and the reasons each match scored. That is the "these two belong together"
   record the panel lists on later visits.
3. **Launches the DAW** — `open -a "Cubase 14" <file>` on macOS.

If step 3 fails (no DAW installed, different version name) steps 1 and 2 still
stand: the staged folder and the pairing survive, and the panel says so.

Set the app names to match your install:

```bash
export DAW_MATCH_CUBASE_APP="Cubase 13"
export DAW_MATCH_ABLETON_APP="Ableton Live 11 Suite"
```

On a non-Mac host, or for any custom handoff, `DAW_MATCH_OPEN_CMD` replaces the
launch entirely. It receives the file path as `$1` and the DAW id as `$2`.

---

## Configuration

Every setting is an env var, or a key in `~/.daw-match/config.json`. Env wins.

| Variable | Default | Purpose |
|---|---|---|
| `DAW_MATCH_LIBRARY` | three paths above | colon-separated library roots |
| `DAW_MATCH_SCRIPT` | — | your own matcher script |
| `DAW_MATCH_CUBASE_APP` | `Cubase 14` | app for the Cubase button |
| `DAW_MATCH_ABLETON_APP` | `Ableton Live 12 Suite` | app for the Ableton button |
| `DAW_MATCH_OPEN_CMD` | — | replaces `open -a` entirely |
| `DAW_MATCH_SESSIONS` | `~/DAW-Match Sessions` | where staged folders go |
| `DAW_MATCH_PORT` | `4020` | panel port |
| `DAW_MATCH_HOME` | `~/.daw-match` | index, links and cache location |

---

## Requirements

| Tool | Needed for |
|---|---|
| Python 3.9+ | everything |
| `numpy` | tempo and key detection |
| `ffmpeg` | decoding any audio |
| `yt-dlp` | YouTube links only — local files work without it |

MIDI parsing, synthesis and WAV writing are stdlib-only, so there is nothing else
to install.

```bash
brew install ffmpeg yt-dlp
pip3 install numpy
```

---

## Tests

```bash
cd tests && python3 -m unittest discover
```

154 tests covering tempo/key accuracy against signals with known ground truth, a
MIDI write→parse→render round trip, the scoring rules, library scanning and cache
invalidation, the external-script adapter, and the HTTP API end to end (including a
real "Open in Cubase" click through a stub opener).

---

## Layout

```
daw-match/
├── panel.py              HTTP server + CLI entry point
├── dawmatch/
│   ├── config.py         settings resolution
│   ├── audioio.py        yt-dlp / ffmpeg ingest, WAV helpers
│   ├── analysis.py       tempo, key, energy
│   ├── midilib.py        SMF reader + preview synth
│   ├── smf.py            SMF writer
│   ├── library.py        scanning and the cached index
│   ├── matcher.py        scoring
│   ├── preview.py        the audio ▶ streams
│   ├── daw.py            Cubase/Ableton handoff + pairing records
│   ├── external.py       adapter for your own matcher script
│   ├── starter.py        example arps for a first run
│   └── ui.py             the single-page panel
└── tests/
```
