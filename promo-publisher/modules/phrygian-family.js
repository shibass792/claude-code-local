'use strict';

/**
 * Phrygian Family for psy_pack_v3.
 * Bass/kick stay Phrygian. Leads/arps wander: ~70% Phrygian, ~25% Dominant, ~5% Locrian.
 */

const ROOTS = { E: 64, F: 65, G: 67, A: 69, D: 62 };

const FAMILY = {
  phrygian: {
    id: 'phrygian',
    label: 'Phrygian',
    intervals: [0, 1, 3, 5, 7, 8, 10],
    degrees: 'E F G A B C D',
  },
  dominant: {
    id: 'phrygian_dominant',
    label: 'Phrygian Dominant',
    intervals: [0, 1, 4, 5, 7, 8, 10],
    degrees: 'E F G# A B C D',
  },
  locrian: {
    id: 'locrian',
    label: 'Locrian',
    intervals: [0, 1, 3, 5, 6, 8, 10],
    degrees: 'E F G A Bb C D',
  },
};

const ROLE_WEIGHTS = {
  wander: { phrygian: 0.7, dominant: 0.25, locrian: 0.05 },
};

const PACK_MIX_50 = Object.freeze({
  bass: 20,
  lead: 15,
  arp: 10,
  kick: 3,
  hats: 2,
});

const BPM_MIN = 138;
const BPM_MAX = 142;

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

function pickFamily(role, rng) {
  const locked = role === 'bass' || role === 'kick' || role === 'hats';
  if (locked) {
    return FAMILY.phrygian;
  }
  const r = rng();
  if (r < ROLE_WEIGHTS.wander.phrygian) {
    return FAMILY.phrygian;
  }
  if (r < ROLE_WEIGHTS.wander.phrygian + ROLE_WEIGHTS.wander.dominant) {
    return FAMILY.dominant;
  }
  return FAMILY.locrian;
}

function pickBpm(rng, requested) {
  if (requested !== undefined && requested !== null && requested !== '') {
    const n = Number(requested);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return BPM_MIN + Math.floor(rng() * (BPM_MAX - BPM_MIN + 1));
}

function scaleNotes(rootMidi, intervals, octaves = 2) {
  const notes = [];
  for (let o = 0; o < octaves; o += 1) {
    for (const iv of intervals) {
      notes.push(rootMidi + iv + o * 12);
    }
  }
  return notes;
}

function kindsForCount(count) {
  const recipe = [
    ['bass', PACK_MIX_50.bass],
    ['lead', PACK_MIX_50.lead],
    ['arp', PACK_MIX_50.arp],
    ['kick', PACK_MIX_50.kick],
    ['hats', PACK_MIX_50.hats],
  ];
  const total = 50;
  if (count === 50) {
    return recipe.flatMap(([kind, n]) => Array.from({ length: n }, () => kind));
  }
  const raw = recipe.map(([kind, n]) => [kind, Math.max(0, Math.round((n / total) * count))]);
  let kinds = raw.flatMap(([kind, n]) => Array.from({ length: n }, () => kind));
  const leftovers = recipe.map(([kind]) => kind);
  let i = 0;
  while (kinds.length < count) {
    kinds.push(leftovers[i % leftovers.length]);
    i += 1;
  }
  return kinds.slice(0, count);
}

function countByKind(kinds) {
  return kinds.reduce((acc, kind) => {
    acc[kind] = (acc[kind] || 0) + 1;
    return acc;
  }, {});
}

module.exports = {
  ROOTS,
  FAMILY,
  PACK_MIX_50,
  BPM_MIN,
  BPM_MAX,
  mulberry32,
  pickFamily,
  pickBpm,
  scaleNotes,
  kindsForCount,
  countByKind,
};
