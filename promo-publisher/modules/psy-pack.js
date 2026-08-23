'use strict';

/**
 * psy_pack_v3 — Phrygian Family MIDI sketches for Cubase/Ableton.
 * Dated folders. Mix 20 bass / 15 leads / 10 arps / 5 drums when count=50.
 */

const fs = require('fs');
const path = require('path');
const { writeMidi, pulseEvents, programChange } = require('./midi-writer');
const { ensureDir, writeJson, OUTPUT_DIR } = require('./store');
const family = require('./phrygian-family');

const PHRYGIAN_INTERVALS = family.FAMILY.phrygian.intervals;
const ROOTS = family.ROOTS;
const DEFAULT_BPM = 142;

function windowsStudioPaths() {
  if (process.platform !== 'win32') {
    return { midiExport: null, cubaseInbox: null };
  }
  return {
    midiExport: process.env.SHIBASS_ROOT
      ? path.join(process.env.SHIBASS_ROOT, '10_OUTPUTS', 'MIDI_EXPORT', 'psy_pack_v3')
      : 'H:\\shibass-ai\\10_OUTPUTS\\MIDI_EXPORT\\psy_pack_v3',
    cubaseInbox: process.env.SHIBASS_CUBASE_INBOX
      || 'H:\\ShiBass_Cubase_Projects\\Audix_Templates\\psy_pack_inbox',
  };
}

function dateStamp(options = {}) {
  if (options.date) {
    return String(options.date).slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

function packDirs(options = {}) {
  const win = windowsStudioPaths();
  const stamp = dateStamp(options);
  return {
    stamp,
    local: path.join(OUTPUT_DIR, 'psy_pack_v3', stamp),
    midiExport: win.midiExport ? path.join(win.midiExport, stamp) : null,
    cubaseInbox: win.cubaseInbox,
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

function fileSpec(kind, rootName, rootMidi, bpm, seed, bars, scaleFamily) {
  const rng = family.mulberry32(seed);
  const ppq = 96;
  const scale = family.scaleNotes(rootMidi, scaleFamily.intervals, 2);
  const slug = scaleFamily.id.replace(/_/g, '-');
  const safe = `${kind}_${rootName}_${slug}_${bpm}bpm_s${seed}`;

  if (kind === 'kick') {
    return {
      name: safe,
      family: scaleFamily,
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
      family: scaleFamily,
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
      family: scaleFamily,
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
      family: scaleFamily,
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
    family: scaleFamily,
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
  if (!destDir) {
    return false;
  }
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
  const seedBase = Number(options.seed || Date.now() % 100000);
  const rng = family.mulberry32(seedBase);
  const bpm = family.pickBpm(rng, options.bpm === undefined ? DEFAULT_BPM : options.bpm);
  const rootName = String(options.root || 'E').toUpperCase();
  const rootMidi = ROOTS[rootName] || ROOTS.E;
  const bars = Number(options.bars || 8);
  const kinds = family.kindsForCount(count);
  const dirs = packDirs(options);
  ensureDir(dirs.local);

  const files = [];
  for (let i = 0; i < count; i += 1) {
    const kind = kinds[i];
    const scaleFamily = family.pickFamily(kind, family.mulberry32(seedBase + i * 17));
    const spec = fileSpec(kind, rootName, rootMidi, bpm, seedBase + i, bars, scaleFamily);
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
      family: scaleFamily.id,
      key: `${rootName} ${scaleFamily.label}`,
      size: spec.buf.length,
    });
  }

  const mix = family.countByKind(kinds);
  const manifest = {
    version: 'psy_pack_v3',
    generatedAt: new Date().toISOString(),
    date: dirs.stamp,
    scale: `${rootName} Phrygian Family`,
    family: {
      lockedRoles: ['bass', 'kick', 'hats'],
      wanderRoles: ['lead', 'arp'],
      weights: { phrygian: 0.7, phrygian_dominant: 0.25, locrian: 0.05 },
      bpmRange: [family.BPM_MIN, family.BPM_MAX],
    },
    mix,
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
