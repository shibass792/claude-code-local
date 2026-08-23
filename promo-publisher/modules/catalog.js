const path = require('path');
const { CATALOG_INDEX, readJson, writeJson } = require('./store');
const { appendLog, snapshotState } = require('./creation-log');
const sql = require('./sql-db');
const music = require('./music-library');
const backgrounds = require('./backgrounds');

const ROLE_LABELS = {
  tracks: 'קטעים',
  covers: 'עטיפות',
  effects: 'אפקטים',
  stems: 'ערוצים',
  midi: 'MIDI',
  fm: 'FM',
};

const STEM_CHANNELS = [
  { id: 'kick', label: 'Kick', pattern: /(^|[^a-z])(kick|bd|bassdrum)([^a-z]|$)/i },
  { id: 'bass', label: 'Bass', pattern: /(^|[^a-z])(bass|sub|reese)([^a-z]|$)/i },
  { id: 'lead', label: 'Lead', pattern: /(^|[^a-z])(lead|acid|hoover)([^a-z]|$)/i },
  { id: 'pad', label: 'Pad', pattern: /(^|[^a-z])(pad|atmos|atmosphere|drone)([^a-z]|$)/i },
  { id: 'perc', label: 'Perc', pattern: /(^|[^a-z])(perc|hat|clap|snare|tom|ride|crash|top)([^a-z]|$)/i },
  { id: 'vocal', label: 'Vocal', pattern: /(^|[^a-z])(vocal|vox|voice)([^a-z]|$)/i },
  { id: 'arp', label: 'Arp', pattern: /(^|[^a-z])(arp|pluck|stab)([^a-z]|$)/i },
];

function normalizeHay(value) {
  return String(value ?? '').toLowerCase().replace(/\\/g, '/');
}

function isFmPath(value) {
  const hay = normalizeHay(value);
  return (
    /(^|\/)fm(\/|$)/.test(hay) ||
    /(^|\/)fm8(\/|$)/.test(hay) ||
    /(^|\/)dx7(\/|$)/.test(hay) ||
    /native.?instruments.?fm/.test(hay) ||
    /operator.?fm/.test(hay)
  );
}

function isEffectPath(value) {
  const hay = normalizeHay(value);
  return /(^|\/)(fx|effects?|one[-_]?shots?|risers?|impacts?|sweeps?|downlifters?|uplifters?|foley)(\/|$)/.test(
    hay,
  ) || /(riser|impact|sweep|downlifter|uplifter|oneshot|one-shot)/.test(hay);
}

function isFullTrackPath(value) {
  const hay = normalizeHay(value);
  return /(^|\/)(tracks?|singles?|masters?|mixdowns?|bounces?|renders?|album)(\/|$)/.test(hay)
    || /(master|mixdown|bounce|full[_-]?track)/.test(hay);
}

function stemChannelFor(value) {
  const hay = normalizeHay(value);
  for (const channel of STEM_CHANNELS) {
    if (channel.pattern.test(hay)) {
      return channel;
    }
  }
  return null;
}

function roleLabel(role) {
  switch (role) {
    case 'tracks':
    case 'covers':
    case 'effects':
    case 'stems':
    case 'midi':
    case 'fm':
      return ROLE_LABELS[role];
    default: {
      const _unused = role;
      return 'אחר';
    }
  }
}

function classifyRecord(record) {
  const hay = `${record.path ?? ''} ${record.name ?? ''} ${record.folder ?? ''}`;
  if (isFmPath(hay)) {
    return {
      role: 'fm',
      roleLabel: roleLabel('fm'),
      excluded: true,
      channel: 'fm',
      channelLabel: 'FM',
    };
  }
  if (record.kind === 'cover' || record.ext && ['.jpg', '.jpeg', '.png', '.webp', '.bmp'].includes(record.ext)) {
    return {
      role: 'covers',
      roleLabel: roleLabel('covers'),
      excluded: false,
      channel: 'covers',
      channelLabel: 'עטיפות',
    };
  }
  if (record.kind === 'midi') {
    return {
      role: 'midi',
      roleLabel: roleLabel('midi'),
      excluded: false,
      channel: 'midi',
      channelLabel: 'MIDI',
    };
  }
  if (isEffectPath(hay)) {
    return {
      role: 'effects',
      roleLabel: roleLabel('effects'),
      excluded: false,
      channel: 'fx',
      channelLabel: 'FX',
    };
  }
  const stem = stemChannelFor(hay);
  if (stem && !isFullTrackPath(hay)) {
    return {
      role: 'stems',
      roleLabel: roleLabel('stems'),
      excluded: false,
      channel: stem.id,
      channelLabel: stem.label,
    };
  }
  return {
    role: 'tracks',
    roleLabel: roleLabel('tracks'),
    excluded: false,
    channel: 'master',
    channelLabel: 'Master',
  };
}

function folderKey(parentPath, root) {
  if (!parentPath) {
    return 'root';
  }
  if (root && parentPath.startsWith(root)) {
    const relative = parentPath.slice(root.length).replace(/^[/\\]+/, '');
    return relative || path.basename(root);
  }
  return path.basename(parentPath);
}

function emptyCatalog() {
  return {
    scannedAt: null,
    mock: false,
    counts: {
      tracks: 0,
      covers: 0,
      effects: 0,
      stems: 0,
      midi: 0,
      folders: 0,
      excludedFm: 0,
      total: 0,
    },
    folders: [],
    channels: [],
    items: [],
  };
}

function buildCatalog() {
  const musicIndex = music.getIndex();
  const bgIndex = backgrounds.getIndex();
  const items = [];

  for (const track of musicIndex.tracks ?? []) {
    const classified = classifyRecord(track);
    items.push({
      ...track,
      media: track.kind === 'midi' ? 'midi' : 'audio',
      ...classified,
      folder: track.folder || path.basename(track.parent || path.dirname(track.path)),
      parent: track.parent || path.dirname(track.path),
    });
  }

  for (const image of bgIndex.images ?? []) {
    const classified = classifyRecord({ ...image, kind: 'cover' });
    items.push({
      ...image,
      kind: 'cover',
      media: 'image',
      ...classified,
      folder: path.basename(path.dirname(image.path)),
      parent: path.dirname(image.path),
    });
  }

  const counts = {
    tracks: 0,
    covers: 0,
    effects: 0,
    stems: 0,
    midi: 0,
    folders: 0,
    excludedFm: 0,
    total: items.length,
  };
  const folderMap = new Map();
  const channelMap = new Map();

  for (const item of items) {
    if (item.excluded) {
      counts.excludedFm += 1;
    } else if (item.role === 'tracks' || item.role === 'covers' || item.role === 'effects' || item.role === 'stems' || item.role === 'midi') {
      counts[item.role] += 1;
    }
    const folderId = folderKey(item.parent, item.root);
    const folder = folderMap.get(folderId) ?? {
      id: folderId,
      name: item.folder || folderId,
      path: item.parent,
      counts: { tracks: 0, covers: 0, effects: 0, stems: 0, midi: 0 },
    };
    if (!item.excluded && folder.counts[item.role] !== undefined) {
      folder.counts[item.role] += 1;
    }
    folderMap.set(folderId, folder);

    const channelId = item.excluded ? 'fm' : item.channel;
    const channel = channelMap.get(channelId) ?? {
      id: channelId,
      label: item.channelLabel,
      count: 0,
    };
    channel.count += 1;
    channelMap.set(channelId, channel);
  }

  const folders = [...folderMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  counts.folders = folders.length;

  const catalog = {
    scannedAt: new Date().toISOString(),
    mock: false,
    roots: [...new Set([...(musicIndex.roots ?? []), ...(bgIndex.roots ?? [])])],
    counts,
    folders,
    channels: [...channelMap.values()].sort((a, b) => b.count - a.count),
    items: items.sort((a, b) => a.name.localeCompare(b.name)),
  };
  writeJson(CATALOG_INDEX, catalog);
  sql.replaceCatalog(catalog);
  appendLog({
    source: 'catalog',
    message: `Catalog ready — ${counts.tracks} tracks, ${counts.covers} covers, ${counts.effects} fx, ${counts.stems} stems, ${counts.excludedFm} FM hidden`,
    counts,
  });
  snapshotState({ catalog: counts });
  return catalog;
}

async function scanCatalog(payload = {}) {
  await music.scanLibrary(payload);
  await backgrounds.scanBackgrounds(payload);
  return buildCatalog();
}

function getCatalog() {
  const stored = readJson(CATALOG_INDEX, null);
  if (stored?.items) {
    return stored;
  }
  return buildCatalog();
}

module.exports = {
  ROLE_LABELS,
  STEM_CHANNELS,
  isFmPath,
  isEffectPath,
  classifyRecord,
  roleLabel,
  buildCatalog,
  scanCatalog,
  getCatalog,
  emptyCatalog,
};
