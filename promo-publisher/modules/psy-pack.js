const fs = require('fs');
const path = require('path');
const { OUTPUT_DIR, ensureDir, writeJson, readJson } = require('./store');
const { appendLog } = require('./creation-log');
const { DEFAULT_PPQ, writeMidiFile, isMidiFile } = require('./midi-writer');
const { writeZip } = require('./zip-store');

const PACK_NAME = 'ShiBass Psy-Tech Pack Vol. 1';
const PACK_SLUG = 'ShiBass_Psy-Tech_Pack_Vol_1';
const PACK_DIR = path.join(OUTPUT_DIR, 'packs', PACK_SLUG);
const PACK_ZIP = path.join(OUTPUT_DIR, 'packs', `${PACK_SLUG}.zip`);
const PACK_MANIFEST = path.join(PACK_DIR, 'manifest.json');
const PRICE_USD = { min: 15, max: 25 };

const PHRYGIAN = {
  E: [64, 65, 67, 69, 71, 72, 74, 76],
  A: [69, 70, 72, 74, 76, 77, 79, 81],
  Fs: [66, 67, 69, 71, 73, 74, 76, 78],
};

const SKELETONS = [
  {
    id: 'A',
    title: 'Psy-Tech 142 · E Phrygian',
    folder: '01_Skeletons/A_PsyTech_142_E_Phrygian',
    bpm: 142,
    key: 'E Phrygian',
    scale: PHRYGIAN.E,
    kickNote: 36,
    bassRoot: 28,
    style: 'psy-tech',
    bars: 32,
    arrangement: 'Intro 1–16 · Build 17–32 · Drop 33–64 · Break 65–80 · Drop2 81–112 · Outro 113–128',
  },
  {
    id: 'B',
    title: 'Progressive 138 · A Phrygian',
    folder: '01_Skeletons/B_Progressive_138_A_Phrygian',
    bpm: 138,
    key: 'A Phrygian',
    scale: PHRYGIAN.A,
    kickNote: 36,
    bassRoot: 33,
    style: 'progressive',
    bars: 32,
    arrangement: 'Intro 1–16 · Build 17–32 · Drop 33–64 · Break 65–80 · Drop2 81–112 · Outro 113–128',
  },
  {
    id: 'C',
    title: 'Full-on 146 · F# Phrygian',
    folder: '01_Skeletons/C_FullOn_146_Fs_Phrygian',
    bpm: 146,
    key: 'F# Phrygian',
    scale: PHRYGIAN.Fs,
    kickNote: 36,
    bassRoot: 30,
    style: 'full-on',
    bars: 32,
    arrangement: 'Intro 1–16 · Build 17–32 · Drop 33–64 · Break 65–80 · Drop2 81–112 · Outro 113–128',
  },
];

const PRESETS = [
  { id: 1, name: 'SB_Kick_Layer', synth: 'Serum', role: 'Kick body + click. קבע לפני כל סאונד אחר.' },
  { id: 2, name: 'SB_Sub_Bass', synth: 'Serum', role: 'סאב מונו מתחת ל-80Hz, בלי המון מיד.' },
  { id: 3, name: 'SB_Reese_Mid', synth: 'Serum', role: 'מיד-באס מתגלגל לפסיי-טק.' },
  { id: 4, name: 'SB_Acid_303', synth: 'Serum', role: 'קו 303 עם רזוננס גבוה, אוטומציה על cutoff.' },
  { id: 5, name: 'SB_Lead_Hook', synth: 'Serum', role: 'הוק ראשי לדרופ — 4–8 תיבות.' },
  { id: 6, name: 'SB_Pluck_Arp', synth: 'Sylenth1', role: 'ארפ פריג׳י לבילד.' },
  { id: 7, name: 'SB_Pad_Phrygian', synth: 'Sylenth1', role: 'פד רחב לברֵיק בלבד.' },
  { id: 8, name: 'SB_FX_Riser', synth: 'Serum', role: 'רייזר 8–16 תיבות לפני דרופ.' },
  { id: 9, name: 'SB_FX_Impact', synth: 'Serum', role: 'אימפקט + טייל בבר 1 של הדרופ.' },
  { id: 10, name: 'SB_Sylenth_Stab', synth: 'Sylenth1', role: 'סטאב סינקופטי לפסיי-טק.' },
];

function ticksPerBar(ppq = DEFAULT_PPQ) {
  return ppq * 4;
}

function repeatingNotes({ bars, everyTicks, note, velocity, durationTicks, channel = 0, startBar = 0 }) {
  const bar = ticksPerBar();
  const notes = [];
  const start = startBar * bar;
  const end = (startBar + bars) * bar;
  for (let tick = start; tick < end; tick += everyTicks) {
    notes.push({
      startTick: tick,
      durationTicks,
      note,
      velocity,
      channel,
    });
  }
  return notes;
}

function bassLine({ skeleton, bars }) {
  const bar = ticksPerBar();
  const notes = [];
  const degrees = [0, 0, 1, 0, 3, 0, 4, 0];
  for (let i = 0; i < bars * 8; i += 1) {
    const tick = (DEFAULT_PPQ / 2) + i * (DEFAULT_PPQ / 2);
    if (tick >= bars * bar) {
      break;
    }
    const degree = degrees[i % degrees.length];
    notes.push({
      startTick: tick,
      durationTicks: Math.floor(DEFAULT_PPQ * 0.42),
      note: skeleton.bassRoot + (degree === 0 ? 0 : skeleton.scale[degree] - skeleton.scale[0]),
      velocity: 92 + (i % 2) * 8,
      channel: 1,
    });
  }
  return notes;
}

function leadLine({ skeleton, bars, offset = 0 }) {
  const bar = ticksPerBar();
  const motif = [0, 1, 0, 2, 4, 3, 1, 0];
  const notes = [];
  for (let barIndex = Math.floor(bars / 2); barIndex < bars; barIndex += 1) {
    for (let step = 0; step < 8; step += 1) {
      if ((barIndex + step + offset) % 3 === 0) {
        continue;
      }
      notes.push({
        startTick: barIndex * bar + step * (DEFAULT_PPQ / 2),
        durationTicks: Math.floor(DEFAULT_PPQ * 0.38),
        note: skeleton.scale[(motif[step] + offset) % skeleton.scale.length],
        velocity: 88 + ((step + offset) % 4) * 6,
        channel: 2,
      });
    }
  }
  return notes;
}

function percLine(bars) {
  return repeatingNotes({
    bars,
    everyTicks: DEFAULT_PPQ,
    note: 42,
    velocity: 70,
    durationTicks: 80,
    channel: 9,
    startBar: 0,
  }).concat(repeatingNotes({
    bars,
    everyTicks: DEFAULT_PPQ * 2,
    note: 39,
    velocity: 84,
    durationTicks: 60,
    channel: 9,
    startBar: 0,
  }));
}

function clipNotes(kind, index, scale) {
  const root = scale[index % scale.length];
  switch (kind) {
    case 'lead':
      return [0, 1, 3, 4, 3, 1, 0, 2].map((deg, step) => ({
        startTick: step * (DEFAULT_PPQ / 2),
        durationTicks: 200,
        note: scale[(deg + index) % scale.length],
        velocity: 90 + (step % 3) * 5,
        channel: 0,
      }));
    case 'acid':
      return Array.from({ length: 16 }, (_, step) => ({
        startTick: step * (DEFAULT_PPQ / 4),
        durationTicks: 90,
        note: scale[(step + index) % scale.length] - 12,
        velocity: 70 + (step % 8) * 4,
        channel: 0,
      }));
    case 'pad':
      return [0, 2, 4].map((deg, voice) => ({
        startTick: 0,
        durationTicks: DEFAULT_PPQ * 16,
        note: scale[(deg + index) % scale.length],
        velocity: 64 + voice * 6,
        channel: 0,
      }));
    case 'perc':
      return [36, 39, 42, 46].map((note, step) => ({
        startTick: step * DEFAULT_PPQ,
        durationTicks: 70,
        note,
        velocity: 80,
        channel: 9,
      }));
    default: {
      const exhaustive = kind;
      throw new Error(`Unknown clip kind: ${exhaustive}`);
    }
  }
}

function writeText(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, text.endsWith('\n') ? text : `${text}\n`, 'utf-8');
}

function dawTemplateNotes() {
  return [
    '# Cubase / Ableton — תבנית עבודה קבועה',
    '',
    '1. BPM לפי השלד (142 / 138 / 146). סולם פריג׳י כתוב ב-structure.txt.',
    '2. ערוצים קבועים: Kick, Bass, Reese, Acid, Lead, Pad, Perc, FX.',
    '3. הלבישו את 10 הפריסטים מתיקיית Presets (ייצוא מ-Serum / Sylenth1 במחשב).',
    '4. קבעו Kick & Bass לפני כל שכבה אחרת. בלי זה אין דרופ.',
    '5. Cubase templates: H:\\ShiBass_Cubase_Projects\\Audix_Templates',
    '6. ייצוא ל-Audix: WAV 24-bit 44.1k, בלי לימיטר על המאסטר עד סוף המיקס.',
  ].join('\n');
}

function packReadme(manifest) {
  return [
    `# ${PACK_NAME}`,
    '',
    `מחיר מומלץ: $${PRICE_USD.min}–$${PRICE_USD.max}`,
    `MIDI: ${manifest.midiCount} · פריסטים: ${manifest.presets.length} · שלדים: ${manifest.skeletons.length}`,
    '',
    '## תוכן',
    '- `MIDI/01_Skeletons` — 3 שלדי טראק (Kick + Bass + Lead + Perc)',
    '- `MIDI/02_Leads` — 10 הוקים',
    '- `MIDI/03_Acid` — 10 קווי 303',
    '- `MIDI/04_Pads` — 10 פדים פריג׳יים',
    '- `MIDI/05_Perc` — 10 לופים כלי הקשה',
    '- `Presets/` — 10 שמות לייצוא מ-Serum / Sylenth1 (אין כאן קבצי .fxp מזויפים)',
    '',
    '## שבוע 1',
    'ימים 1–2: תפעיל את שלושת השלדים ב-DAW ותקבע Kick & Bass.',
    'ימים 3–4: סוגרים Arrangement על השלד החזק, מיקס 80/20, ייצוא ל-Audix.',
    'ימים 5–7: ZIP הזה → Gumroad / אתר הלייבל.',
  ].join('\n');
}

function collectFiles(dir, prefix = '') {
  const entries = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (fs.statSync(full).isDirectory()) {
      entries.push(...collectFiles(full, rel));
    } else {
      entries.push({ name: `${PACK_SLUG}/${rel}`, data: fs.readFileSync(full) });
    }
  }
  return entries;
}

function listMidi(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const found = [];
  const walk = (current) => {
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.mid$/i.test(name)) {
        found.push(full);
      }
    }
  };
  walk(dir);
  return found;
}

function generatePack() {
  ensureDir(PACK_DIR);
  const midiRoot = path.join(PACK_DIR, 'MIDI');
  const written = [];

  for (const skeleton of SKELETONS) {
    const folder = path.join(PACK_DIR, 'MIDI', skeleton.folder);
    const kick = writeMidiFile(path.join(folder, 'kick.mid'), {
      bpm: skeleton.bpm,
      name: `${skeleton.id} Kick`,
      tracks: [{
        name: 'Kick',
        notes: repeatingNotes({
          bars: skeleton.bars,
          everyTicks: DEFAULT_PPQ,
          note: skeleton.kickNote,
          velocity: 120,
          durationTicks: 140,
        }),
      }],
    });
    const bass = writeMidiFile(path.join(folder, 'bass.mid'), {
      bpm: skeleton.bpm,
      name: `${skeleton.id} Bass`,
      tracks: [{ name: 'Bass', notes: bassLine({ skeleton, bars: skeleton.bars }) }],
    });
    const lead = writeMidiFile(path.join(folder, 'lead.mid'), {
      bpm: skeleton.bpm,
      name: `${skeleton.id} Lead`,
      tracks: [{ name: 'Lead', notes: leadLine({ skeleton, bars: skeleton.bars }) }],
    });
    const perc = writeMidiFile(path.join(folder, 'perc.mid'), {
      bpm: skeleton.bpm,
      name: `${skeleton.id} Perc`,
      tracks: [{ name: 'Perc', notes: percLine(skeleton.bars) }],
    });
    writeText(path.join(folder, 'structure.txt'), [
      skeleton.title,
      `Key: ${skeleton.key}`,
      `BPM: ${skeleton.bpm}`,
      `Style: ${skeleton.style}`,
      `Arrangement (full track): ${skeleton.arrangement}`,
      'MIDI sketch length: 32 bars — loop / arrange in Cubase or Ableton.',
      'Fix Kick & Bass first. Then Serum/Sylenth1 presets from ../Presets.',
    ].join('\n'));
    written.push(kick.path, bass.path, lead.path, perc.path);
  }

  const clipPlan = [
    { kind: 'lead', folder: '02_Leads', count: 10, bpm: 142, scale: PHRYGIAN.E },
    { kind: 'acid', folder: '03_Acid', count: 10, bpm: 144, scale: PHRYGIAN.E },
    { kind: 'pad', folder: '04_Pads', count: 10, bpm: 138, scale: PHRYGIAN.A },
    { kind: 'perc', folder: '05_Perc', count: 10, bpm: 146, scale: PHRYGIAN.Fs },
  ];

  for (const group of clipPlan) {
    for (let i = 0; i < group.count; i += 1) {
      const file = path.join(midiRoot, group.folder, `${String(i + 1).padStart(2, '0')}_${group.kind}.mid`);
      writeMidiFile(file, {
        bpm: group.bpm,
        name: `${group.kind} ${i + 1}`,
        tracks: [{ name: group.kind, notes: clipNotes(group.kind, i, group.scale) }],
      });
      written.push(file);
    }
  }

  writeText(path.join(PACK_DIR, 'Presets', 'Serum', 'EXPORT_FROM_RACK.txt'), [
    'ייצאו מכאן את הפריסטים מ-Serum במחשב (H:\\ ספרייה: 1,616 Serum).',
    'אין בריפו קבצי .fxp מזויפים — רק שמות ומשבצות.',
    ...PRESETS.filter((row) => row.synth === 'Serum').map((row) => `${row.name} — ${row.role}`),
  ].join('\n'));
  writeText(path.join(PACK_DIR, 'Presets', 'Sylenth1', 'EXPORT_FROM_RACK.txt'), [
    'ייצאו מכאן את הפריסטים מ-Sylenth1 (ראק על פורט 4903).',
    ...PRESETS.filter((row) => row.synth === 'Sylenth1').map((row) => `${row.name} — ${row.role}`),
  ].join('\n'));
  writeText(path.join(PACK_DIR, 'Presets', 'preset_list.md'), PRESETS.map((row) => {
    return `${row.id}. ${row.name} (${row.synth}) — ${row.role}`;
  }).join('\n'));

  writeText(path.join(PACK_DIR, 'Templates', 'Cubase_Ableton_notes.md'), dawTemplateNotes());
  writeText(path.join(PACK_DIR, 'LICENSE.txt'), 'ShiBass / Audix Records — personal use + your own releases. Do not resell the raw pack.');

  const midiFiles = listMidi(PACK_DIR);
  const manifest = {
    mock: false,
    engine: 'psy_pack_v3',
    name: PACK_NAME,
    slug: PACK_SLUG,
    priceUsd: PRICE_USD,
    generatedAt: new Date().toISOString(),
    midiCount: midiFiles.length,
    leadingMidi: 40,
    skeletonMidi: 12,
    skeletons: SKELETONS.map((row) => ({
      id: row.id,
      title: row.title,
      bpm: row.bpm,
      key: row.key,
      style: row.style,
      folder: row.folder,
    })),
    presets: PRESETS,
    relativeDir: `output/packs/${PACK_SLUG}`,
    relativeZip: `output/packs/${PACK_SLUG}.zip`,
  };

  writeText(path.join(PACK_DIR, 'README.md'), packReadme(manifest));
  writeJson(PACK_MANIFEST, manifest);
  const zip = writeZip(PACK_ZIP, collectFiles(PACK_DIR));

  appendLog({
    source: 'psy_pack_v3',
    message: `Generated ${manifest.midiCount} MIDI + ${PRESETS.length} preset slots → ${zip.path}`,
  });

  return {
    success: true,
    mock: false,
    engine: 'psy_pack_v3',
    midiCount: manifest.midiCount,
    presets: PRESETS.length,
    skeletons: SKELETONS.length,
    zipBytes: zip.bytes,
    relativeDir: manifest.relativeDir,
    relativeZip: manifest.relativeZip,
    manifest,
  };
}

function getPackStatus() {
  const manifest = readJson(PACK_MANIFEST, null);
  const zipExists = fs.existsSync(PACK_ZIP);
  if (!manifest) {
    return {
      ready: false,
      mock: false,
      engine: 'psy_pack_v3',
      midiCount: 0,
      presets: PRESETS,
      skeletons: SKELETONS.map((row) => ({ id: row.id, title: row.title, bpm: row.bpm, key: row.key })),
      next: 'לחץ «הרץ psy_pack_v3» — 3 שלדים + 40 MIDI מובילים + 10 משבצות פריסטים',
    };
  }
  return {
    ready: zipExists && manifest.midiCount >= 40,
    mock: false,
    engine: 'psy_pack_v3',
    midiCount: manifest.midiCount,
    presets: manifest.presets,
    skeletons: manifest.skeletons,
    relativeDir: manifest.relativeDir,
    relativeZip: manifest.relativeZip,
    generatedAt: manifest.generatedAt,
    next: zipExists
      ? `${manifest.midiCount} MIDI ב-ZIP — ייצאו 10 פריסטים מ-Serum/Sylenth1 ואז Gumroad $${PRICE_USD.min}–$${PRICE_USD.max}`
      : 'המניפסט קיים אבל ה-ZIP חסר — הרץ שוב',
  };
}

module.exports = {
  PACK_NAME,
  PACK_DIR,
  PACK_ZIP,
  PACK_MANIFEST,
  PRESETS,
  SKELETONS,
  PRICE_USD,
  generatePack,
  getPackStatus,
  isMidiFile,
};
