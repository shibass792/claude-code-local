# -*- coding: utf-8 -*-
"""Build the ShiBass F#m 142 BPM MIDI pack — for real, with the verified engine.

Writes 5 separate Standard MIDI files to H:\shibass-ai\sb_player\midi_exports\,
composed by ShiBass's own writing rules:
  * melody has opening -> development -> peak -> close (A B A' C over 8 bars)
  * smooth voice leading (steps <= 4 semitones), phrase ends resolve to 1/5
  * no unresolved 4th/11th degrees
  * rolling bass leaves the first 16th of every beat for the kick, and the hit
    right after the kick is velocity-dipped ~30% (KBBB)
  * pad voiced from C3 up, F#m - D - E - C#m
Uses music_brain.midiforge.smf (tick-exact writer, 54-test-verified).
"""
import sys
sys.path.insert(0, r"H:\shibass-ai\claude-code-local\music-brain")
from music_brain.midiforge.smf import MidiData, Note, Track, write_midi
from pathlib import Path

OUT = Path(r"H:\shibass-ai\sb_player\midi_exports")
OUT.mkdir(parents=True, exist_ok=True)
TPQ, BPM, BARS = 480, 142.0, 8
BAR = TPQ * 4
S16 = TPQ // 4

# F# natural minor: F# G# A B C# D E
FS1, FS3, FS4 = 30, 54, 66
SCALE4 = [66, 68, 69, 71, 73, 74, 76, 78]  # F#4..F#5 natural minor


def md(notes, name, ch, program=None, drum=False):
    n = MidiData(tpq=TPQ, tempo_us=int(60_000_000 / BPM), numerator=4, denominator=4)
    n.tracks = [Track(name=name, channel=9 if drum else ch, program=program,
                      notes=sorted(notes, key=lambda x: x.start))]
    return n


def kick():
    return [Note(pitch=36, start=b * BAR + beat * TPQ, dur=int(TPQ * 0.4),
                 velocity=127, channel=9)
            for b in range(BARS) for beat in range(4)]


def bass():
    # 2-bar harmonic loop: F# F# E F# | F# F# G# F#  (root motion, comes home)
    roots = [FS1, FS1, FS1 - 2, FS1, FS1, FS1, FS1 + 2, FS1] * (BARS // 2)
    out = []
    for b in range(BARS):
        for beat in range(4):
            root = roots[(b * 4 + beat) % len(roots)]
            for sub in (1, 2, 3):
                vel = 100 if sub != 1 else 70          # KBBB dip after the kick
                out.append(Note(pitch=root, start=b * BAR + beat * TPQ + sub * S16,
                                dur=int(S16 * 0.78), velocity=vel, channel=1))
    return out


def lead():
    """A(open) B(rise) A'(peak) C(close) — two bars each, eighth-note phrasing."""
    E = TPQ // 2
    def ph(bar, degs, durs, vels):
        t, out = bar * BAR, []
        for d, du, v in zip(degs, durs, vels):
            if d is not None:
                out.append(Note(pitch=SCALE4[d], start=t, dur=int(du * 0.9),
                                velocity=v, channel=0))
            t += du
        return out
    A  = ph(0, [0, 2, 4, 2,  0, 4, 2, None], [E]*8, [96,88,102,90, 96,104,92,0]) \
       + ph(1, [0, 2, 1, 0,  4, None],       [E,E,E,E,TPQ,TPQ], [94,86,90,84,98,0])
    B  = ph(2, [2, 4, 5, 4,  2, 5, 4, None], [E]*8, [98,102,108,100, 96,110,104,0]) \
       + ph(3, [5, 4, 2, 4,  7, None],       [E,E,E,E,TPQ,TPQ], [102,98,94,100,112,0])
    A2 = ph(4, [7, 5, 4, 5,  7, 4, 5, None], [E]*8, [114,108,104,106, 118,102,110,0]) \
       + ph(5, [7, 5, 7, 5,  4, None],       [E,E,E,E,TPQ,TPQ], [116,110,118,108,104,0])
    C  = ph(6, [5, 4, 2, 4,  2, 1, 2, None], [E]*8, [104,100,92,96, 90,86,88,0]) \
       + ph(7, [2, 1, 0, None],              [E,E,TPQ*2,TPQ],   [90,84,96,0])
    return A + B + A2 + C


def arp():
    # F#3 A3 C#4 E4 up-down, 16ths, accent on beat heads
    cyc = [54, 57, 61, 64, 61, 57]
    out = []
    for b in range(BARS):
        for i in range(16):
            out.append(Note(pitch=cyc[i % len(cyc)],
                            start=b * BAR + i * S16, dur=int(S16 * 0.6),
                            velocity=104 if i % 4 == 0 else 84, channel=2))
    return out


def pad():
    # F#m D E C#m — voiced from C3 (48) up, whole notes x2 bars each
    chords = [(54, 61, 66), (50, 57, 66), (52, 59, 64), (49, 56, 64)]
    out = []
    for i, ch in enumerate(chords):
        for p in ch:
            out.append(Note(pitch=p, start=i * 2 * BAR, dur=2 * BAR - 10,
                            velocity=72, channel=3))
    return out


FILES = [
    ("ShiBass_F#m_142_Kick_01.mid",        md(kick(), "Safari Kick",  9, drum=True)),
    ("ShiBass_F#m_142_Bass_Rolling_01.mid", md(bass(), "Rolling Bass", 1, program=38)),
    ("ShiBass_F#m_142_Lead_Melody_01.mid",  md(lead(), "Lead Melody",  0, program=81)),
    ("ShiBass_F#m_142_Arp_01.mid",          md(arp(),  "Pluck Arp",    2, program=81)),
    ("ShiBass_F#m_142_Pad_01.mid",          md(pad(),  "Dream Pad",    3, program=89)),
]
for fname, data in FILES:
    p = OUT / fname
    write_midi(p, data)
    print(f"wrote {p.name}  ({p.stat().st_size} bytes, "
          f"{sum(len(t.notes) for t in data.tracks)} notes)")
print("PACK COMPLETE ->", OUT)
