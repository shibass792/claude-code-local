'use strict';

/**
 * psy_pack_v3 — generate Phrygian psytrance MIDI sketches for Cubase/Ableton.
 */

const fs = require('fs');
const path = require('path');
const { writeMidi, pulseEvents, programChange } = require('./midi-writer');
const { ensureDir, writeJson, OUTPUT_DIR } = require('./store');

const PHRYGIAN_INTERVALS = [0, 1, 3, 5, 7, 8, 10];
const ROOTS = { E: 64, F: 65, G: 67, A: 69, D: 62 };
const DEFAULT_BPM = 142;

function packDirs() {
  const homeOut = process.env.SHIBASS_ROOT
    ? path.join(process.env.SHIBASS_ROOT, '10_OUTPUTS', 'MIDI_EXPORT', 'psy_pack_v3')
    : path.join('H:', 'shibass-ai', '10_OUTPUTS', 'MIDI_EXPORT', 'psy_pack_v3');
  const cubaseInbox = process.env.SHIBASS_CUBASE_INBOX
    || path.join('H:', 'ShiBass_Cubase_Projects', 'Audix_Templates', 'psy_pack_inbox');
  return {
    local: path.join(OUTPUT_DIR, 'psy_pack_v3'),
    midiExport: homeOut,
    cubaseInbox,
  };
}

function scaleNotes(rootMidi, octaves = 2) {
  const notes = [];
  for (let o = 0; o < octaves; o += 1) {
    for (const iv of PHRYGIAN_INTERVALS) {
      notes.push(rootMidi + iv + o * 12);
    }
  }
  return notes;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function barsToTicks(bars, ppq = 96) {
  return bars * 4 * ppq;
}

function kickPattern(ppq, bars) {
  const notes = [];
  const end = barsToTicks(bars, ppq);
  for (let t = 0; t < end; t += ppq) {
    notes.push({ tick: t, note: 36, duration: ppq / 2, velocity: 120 });
  }
  return notes;
}

function hatPattern(ppq, bars, rng) {
  const notes = [];
  const step = ppq / 4;
  const end = barsToTicks(bars, ppq);
  for (let t = 0; t < end; t += step) {
    if (rng() < 0.12) continue;
    notes.push({ tick: t, note: 42, duration: step, velocity: t % ppq === 0 ? 70 : 42 });
  }
  return notes;
}

function bassPattern(root, ppq, bars, rng) {
  const notes = [];
  const end = barsToTicks(bars, ppq);
  const bassRoot = root - 24;
  for (let t = 0; t < end; t += ppq) {
    const off = Math.round(ppq * 0.5);
    notes.push({
      tick: t + off,
      note: bassRoot + (rng() < 0.2 ? 12 : 0),
      duration: ppq * 0.45,
      velocity: 108,
    });
  }
  return notes;
}

function melodyPattern(scale, ppq, bars, rng, density = 0.55) {
  const notes = [];
  const step = ppq / 2;
  const end = barsToTicks(bars, ppq);
  for (let t = 0; t < end; t += step) {
    if (rng() > density) continue;
    notes.push({
      tick: t,
      note: scale[Math.floor(rng() * scale.length)],
      duration: rng() < 0.25 ? step * 2 : step,
      velocity: 86 + Math.floor(rng() * 30),
    });
  }
  return notes;
}

function arpPattern(scale, ppq, bars) {
  const notes = [];
  const step = ppq / 4;
  const end = barsToTicks(bars, ppq);
  let i = 0;
  for (let t = 0; t < end; t += step) {
    notes.push({ tick: t, note: scale[i % scale.length], duration: step, velocity: 78 });
    i += 1;
  }
  return notes;
}

function fileSpec(kind, rootName, rootMidi, bpm, seed, bars) {
  const rng = mulberry32(seed);
  const ppq = 96;
  const scale = scaleNotes(rootMidi, 2);
  const safe = `${kind}_${rootName}_phrygian_${bpm}bpm_s${seed}`;

  if (kind === 'kick') {
    return {
      name: safe,
      buf: writeMidi({
        bpm,
        ppq,
        tracks: [{ name: 'Kick', events: [...pulseEvents(kickPattern(ppq, bars), { channel: 9, ppq, gate: 0.4 })] }],
      }),
    };
  }
  if (kind === 'hats') {
    return {
      name: safe,
      buf: writeMidi({
        bpm,
        ppq,
        tracks: [{ name: 'Hats', events: [...pulseEvents(hatPattern(ppq, bars, rng), { channel: 9, ppq, gate: 0.3 })] }],
      }),
    };
  }
  if (kind === 'bass') {
    return {
      name: safe,
      buf: writeMidi({
        bpm,
        ppq,
        tracks: [{
          name: 'Bass',
          events: [programChange(0, 0, 38), ...pulseEvents(bassPattern(rootMidi, ppq, bars, rng), { channel: 0, ppq, gate: 0.55 })],
        }],
      }),
    };
  }
  if (kind === 'arp') {
    return {
      name: safe,
      buf: writeMidi({
        bpm,
        ppq,
        tracks: [{
          name: 'Arp',
          events: [programChange(0, 1, 81), ...pulseEvents(arpPattern(scale, ppq, bars), { channel: 1, ppq, gate: 0.5 })],
        }],
      }),
    };
  }
  return {
    name: safe,
    buf: writeMidi({
      bpm,
      ppq,
      tracks: [{
        name: 'Lead',
        events: [programChange(0, 0, 81), ...pulseEvents(melodyPattern(scale, ppq, bars, rng), { channel: 0, ppq, gate: 0.65 })],
      }],
    }),
  };
}

function copyIfPossible(src, destDir, fileName) {
  try {
    ensureDir(destDir);
    fs.copyFileSync(src, path.join(destDir, fileName));
    return true;
  } catch {
    return false;
  }
}

function generatePsyPack(options = {}) {
  const count = Math.min(80, Math.max(5, Number(options.count || 10)));
  const bpm = Number(options.bpm || DEFAULT_BPM);
  const rootName = String(options.root || 'E').toUpperCase();
  const rootMidi = ROOTS[rootName] || ROOTS.E;
  const bars = Number(options.bars || 8);
  const seedBase = Number(options.seed || Date.now() % 100000);
  const kinds = ['kick', 'bass', 'lead', 'arp', 'hats'];
  const dirs = packDirs();
  ensureDir(dirs.local);

  const files = [];
  for (let i = 0; i < count; i += 1) {
    const kind = kinds[i % kinds.length];
    const spec = fileSpec(kind, rootName, rootMidi, bpm, seedBase + i, bars);
    const fileName = `${String(i + 1).padStart(2, '0')}_${spec.name}.mid`;
    const dest = path.join(dirs.local, fileName);
    fs.writeFileSync(dest, spec.buf);
    copyIfPossible(dest, dirs.midiExport, fileName);
    copyIfPossible(dest, dirs.cubaseInbox, fileName);
    files.push({
      name: fileName,
      path: dest,
      kind,
      bpm,
      key: `${rootName} Phrygian`,
      size: spec.buf.length,
    });
  }

  const manifest = {
    version: 'psy_pack_v3',
    generatedAt: new Date().toISOString(),
    scale: `${rootName} Phrygian`,
    bpm,
    count: files.length,
    route: 'Drop these .mid files on Serum / Sylenth1 in Cubase Audix templates',
    dirs,
    files,
  };
  writeJson(path.join(dirs.local, 'manifest.json'), manifest);
  return { success: true, source: 'psy_pack_v3', ...manifest };
}

module.exports = {
  PHRYGIAN_INTERVALS,
  packDirs,
  generatePsyPack,
};
