"""MIDI Forge self-test: fidelity, analysis accuracy, generation, export."""

from __future__ import annotations

import random
import sys
import tempfile
from pathlib import Path

from music_brain.midiforge import analysis as ana
from music_brain.midiforge import arrange as arr
from music_brain.midiforge import export as exp
from music_brain.midiforge import generate as gen
from music_brain.midiforge.smf import MidiData, Note, Track, read_midi, write_midi

fails: list[str] = []
oks: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    (oks if cond else fails).append(f"{name} {detail}".strip())
    print(("  PASS  " if cond else "  FAIL  ") + name + (f"  :: {detail}" if detail else ""))


tmp = Path(tempfile.mkdtemp(prefix="midiforge_test_"))
print(f"tmp: {tmp}\n")

# ---------------------------------------------------------------------------
print("[1] Round-trip fidelity — E Phrygian psy lead @ 145 BPM, humanized")
# ---------------------------------------------------------------------------
TPQ = 480
rnd = random.Random(7)
md = MidiData(tpq=TPQ, tempo_us=int(60_000_000 / 145), numerator=4, denominator=4)

# E Phrygian: E F G A B C D  -> pcs 4,5,7,9,11,0,2
lead_notes = []
phryg = [64, 65, 67, 69, 71, 72, 74, 76]
t = 0
for bar in range(4):
    for i in range(16):
        if rnd.random() < 0.25:
            t += TPQ // 4
            continue
        p = rnd.choice(phryg)
        # deliberately un-quantized + humanized velocity
        jitter = rnd.randint(-9, 9)
        lead_notes.append(
            Note(pitch=p, start=max(0, t + jitter), dur=rnd.randint(80, 130),
                 velocity=rnd.randint(72, 120), channel=0)
        )
        t += TPQ // 4

bass_notes = []
for bar in range(4):
    for beat in range(4):
        for sub in (1, 2, 3):
            bass_notes.append(
                Note(pitch=28, start=bar * TPQ * 4 + beat * TPQ + sub * (TPQ // 4),
                     dur=90, velocity=rnd.randint(95, 110), channel=1)
            )

md.tracks = [
    Track(name="Psy Lead", notes=lead_notes, channel=0),
    Track(name="Rolling Bass", notes=bass_notes, channel=1),
]

src_path = tmp / "source.mid"
write_midi(src_path, md, title="ShiBass Test")
check("write source", src_path.exists(), f"{src_path.stat().st_size} bytes")

rt = read_midi(src_path)
check("tpq preserved", rt.tpq == TPQ, f"{rt.tpq}")
check("tempo preserved", abs(rt.bpm - 145.0) < 0.05, f"{rt.bpm:.3f} BPM")
check("time sig preserved", (rt.numerator, rt.denominator) == (4, 4), f"{rt.numerator}/{rt.denominator}")
check("track count (conductor excluded)", len(rt.tracks) == 2, str(len(rt.tracks)))

orig_all = sorted(md.all_notes(), key=lambda n: (n.start, n.pitch, n.channel))
rt_all = sorted(rt.all_notes(), key=lambda n: (n.start, n.pitch, n.channel))
check("note count identical", len(orig_all) == len(rt_all), f"{len(orig_all)} vs {len(rt_all)}")

exact = all(
    a.pitch == b.pitch and a.start == b.start and a.dur == b.dur and a.velocity == b.velocity
    for a, b in zip(orig_all, rt_all)
)
check("TICK+VELOCITY EXACT (faithful clone)", exact and len(orig_all) == len(rt_all))

if not exact:
    for a, b in list(zip(orig_all, rt_all))[:5]:
        print(f"     orig {a.to_dict()}  ->  rt {b.to_dict()}")

# ---------------------------------------------------------------------------
print("\n[2] Analysis")
# ---------------------------------------------------------------------------
an = ana.analyze(rt)
print(f"     detected: {an.key_name} {an.scale} (conf {an.key_confidence:.2f})  "
      f"{an.bpm:.1f} BPM  {an.bars} bars  density={an.density}")
check("root = E", an.key_name == "E", an.key_name)
check("minor-family mode", an.scale in ("Phrygian", "Minor", "Harmonic Minor", "Phrygian Dominant"), an.scale)
check("bars = 4", an.bars == 4, str(an.bars))

roles = {t.name: t.role for t in an.tracks}
print(f"     roles: {roles}")
check("lead detected", any(t.role == "lead" for t in an.tracks))
check("bass detected", any(t.role == "bass" for t in an.tracks))

lead_prof = next(t for t in an.tracks if t.role == "lead")
check("groove: not quantized", not lead_prof.groove["is_quantized"],
      f"dev={lead_prof.groove['timing_deviation_ms']}ms")
check("velocity humanization detected", lead_prof.velocity["humanization"] > 0.2,
      str(lead_prof.velocity["humanization"]))

# ---------------------------------------------------------------------------
print("\n[3] Generation")
# ---------------------------------------------------------------------------
lead_track = rt.tracks[[t.index for t in an.tracks if t.role == "lead"][0]]
scale_pcs = an.scale_pitches

pad = gen.generate_pad(rt, an, bars=4, complexity=0.7, seed=1)
check("pad generated", len(pad.notes) > 0, f"{len(pad.notes)} notes")
check("pad in scale", all(n.pitch % 12 in scale_pcs for n in pad.notes))
check("pad above sub (>=48)", all(n.pitch >= 48 for n in pad.notes),
      f"min={min((n.pitch for n in pad.notes), default=0)}")

arp = gen.mutate_arp(rt, an, lead_track, mutation_rate=0.4, seed=2)
check("arp generated", len(arp.notes) > 0, f"{len(arp.notes)} notes")
check("arp scale-locked", all(n.pitch % 12 in scale_pcs for n in arp.notes))
differs = sum(1 for a, b in zip(sorted(lead_track.notes, key=lambda n: n.start),
                                sorted(arp.notes, key=lambda n: n.start))
              if a.pitch != b.pitch)
check("arp actually mutated", differs > 0, f"{differs} notes changed")

cm = gen.generate_counter_melody(rt, an, lead_track, complexity=0.6, seed=3)
check("counter generated", len(cm.notes) > 0, f"{len(cm.notes)} notes")
check("counter scale-locked", all(n.pitch % 12 in scale_pcs for n in cm.notes))

# counter should sit mostly in the lead's gaps
lead_spans = [(n.start, n.end) for n in lead_track.notes]
overlap = sum(1 for c in cm.notes if any(s < c.end and c.start < e for s, e in lead_spans))
ratio = overlap / max(1, len(cm.notes))
check("counter fills gaps (<35% overlap)", ratio < 0.35, f"overlap={ratio:.1%}")

bass = gen.generate_bass_root_sync(rt, an, bars=4, style="rolling", seed=4)
check("bass generated", len(bass.notes) > 0, f"{len(bass.notes)} notes")
check("bass in sub register", all(24 <= n.pitch <= 47 for n in bass.notes))
step16 = rt.tpq // 4
downbeat_hits = sum(1 for n in bass.notes if (n.start % rt.tpq) == 0)
check("bass leaves kick window open", downbeat_hits == 0, f"{downbeat_hits} notes on the beat")

enh = gen.enhance_lead(rt, an, lead_track, octave_layer=True, seed=5)
orig_set = {(n.pitch, n.start, n.dur, n.velocity) for n in lead_track.notes}
enh_set = {(n.pitch, n.start, n.dur, n.velocity) for n in enh.notes}
check("enhanced lead PRESERVES original notes", orig_set.issubset(enh_set),
      f"{len(orig_set)} original / {len(enh_set)} total")

# ---------------------------------------------------------------------------
print("\n[4] Arrangement + Export")
# ---------------------------------------------------------------------------
arrangement = arr.build_arrangement(an, "club")
check("arrangement built", arrangement["total_bars"] == 192, str(arrangement["total_bars"]))
check("has all sections", len(arrangement["sections"]) == 7, str(len(arrangement["sections"])))
ms = arrangement["note_ms"]
print(f"     @145 BPM: 1/4={ms['1/4']}ms  1/8D={ms['1/8D']}ms  1/16={ms['1/16']}ms")
check("BPM->ms math correct", abs(ms["1/4"] - 413.79) < 0.5, f"{ms['1/4']}")

layers = {"lead": enh, "pad": pad, "arp": arp, "counter": cm, "bass": bass}
res = exp.export_project(rt, an, layers, arrangement,
                         project_name="SelfTest", out_root=tmp / "out", source_path=str(src_path))
check("export ok", res["ok"], res["project_dir"])
check("5 role files + combined", res["file_count"] == 6, str(res["file_count"]))

pd = Path(res["project_dir"])
for fn in ("01_Original_Lead_Enhanced.mid", "02_Generated_Atmospheric_Pad.mid",
           "03_Arp_Variation_B.mid", "04_Counter_Melody.mid", "05_Bassline_Root_Sync.mid",
           "00_ALL_TRACKS_Combined.mid", "ARRANGEMENT_GUIDE.md", "midiforge_manifest.json"):
    check(f"exists {fn}", (pd / fn).exists())

# Re-read exported files — must be valid SMF Cubase can open
for fn in ("01_Original_Lead_Enhanced.mid", "02_Generated_Atmospheric_Pad.mid",
           "05_Bassline_Root_Sync.mid"):
    re_md = read_midi(pd / fn)
    check(f"re-read {fn}", len(re_md.all_notes()) > 0,
          f"{len(re_md.all_notes())} notes @ {re_md.bpm:.1f} BPM")
    check(f"  tempo carried in {fn}", abs(re_md.bpm - 145.0) < 0.1, f"{re_md.bpm:.2f}")

combo = read_midi(pd / "00_ALL_TRACKS_Combined.mid")
check("combined has 5 tracks", len(combo.tracks) == 5, str(len(combo.tracks)))

guide = (pd / "ARRANGEMENT_GUIDE.md").read_text(encoding="utf-8")
check("guide has tempo", "145" in guide)
check("guide has key", an.key_name in guide)
check("guide has sections", "Breakdown" in guide and "Drop" in guide)
check("guide has ms table", "413.79" in guide or "413.8" in guide)

# ---------------------------------------------------------------------------
print("\n[5] Edge cases")
# ---------------------------------------------------------------------------
empty = MidiData(tpq=480)
empty.tracks = [Track(name="Empty", notes=[])]
ea = ana.analyze(empty)
check("empty file survives analysis", ea.bars >= 1)

single = MidiData(tpq=480, tempo_us=int(60_000_000 / 148))
single.tracks = [Track(name="One", notes=[Note(pitch=60, start=0, dur=480, velocity=100)])]
sa = ana.analyze(single)
check("single-note file survives", sa.key_name is not None, f"{sa.key_name} {sa.scale}")
p2 = gen.generate_pad(single, sa, bars=2, complexity=0.5)
check("pad from 1 note", len(p2.notes) > 0, f"{len(p2.notes)} notes")

# ---------------------------------------------------------------------------
print("\n" + "=" * 62)
print(f"PASSED {len(oks)}   FAILED {len(fails)}")
if fails:
    print("\nFAILURES:")
    for f in fails:
        print("  - " + f)
print("=" * 62)
sys.exit(1 if fails else 0)
