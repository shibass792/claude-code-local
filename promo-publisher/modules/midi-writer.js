const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./store');

const DEFAULT_PPQ = 480;

function assertPositiveInt(name, value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function encodeVlq(value) {
  assertPositiveInt('vlq', value);
  const bytes = [value & 0x7f];
  let rest = value >>> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  return Buffer.from(bytes);
}

function tempoBytes(bpm) {
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 300) {
    throw new Error('bpm must be between 40 and 300');
  }
  const micros = Math.round(60000000 / bpm);
  return Buffer.from([
    0x00, 0xff, 0x51, 0x03,
    (micros >> 16) & 0xff,
    (micros >> 8) & 0xff,
    micros & 0xff,
  ]);
}

function metaText(type, text) {
  const body = Buffer.from(String(text), 'ascii').subarray(0, 127);
  return Buffer.concat([
    Buffer.from([0x00, 0xff, type, body.length]),
    body,
  ]);
}

function trackChunk(payload) {
  const header = Buffer.alloc(8);
  header.write('MTrk', 0);
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function noteEvents(notes, ppq) {
  if (!Array.isArray(notes)) {
    throw new Error('notes must be an array');
  }
  const edges = [];
  for (const note of notes) {
    const start = Number(note.startTick);
    const duration = Number(note.durationTicks);
    const pitch = Number(note.note);
    const velocity = Number(note.velocity ?? 100);
    const channel = Number(note.channel ?? 0);
    assertPositiveInt('startTick', start);
    if (!Number.isInteger(duration) || duration <= 0) {
      throw new Error('durationTicks must be a positive integer');
    }
    if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) {
      throw new Error('note must be 0-127');
    }
    edges.push({ tick: start, kind: 'on', pitch, velocity, channel });
    edges.push({ tick: start + duration, kind: 'off', pitch, velocity: 0, channel });
  }
  edges.sort((a, b) => a.tick - b.tick || (a.kind === 'off' ? -1 : 1));

  const parts = [];
  let cursor = 0;
  for (const edge of edges) {
    const delta = edge.tick - cursor;
    const status = (edge.kind === 'on' ? 0x90 : 0x80) | (edge.channel & 0x0f);
    parts.push(encodeVlq(delta));
    parts.push(Buffer.from([status, edge.pitch, edge.velocity & 0x7f]));
    cursor = edge.tick;
  }
  if (cursor === 0) {
    parts.push(encodeVlq(ppq));
  }
  parts.push(Buffer.from([0x00, 0xff, 0x2f, 0x00]));
  return Buffer.concat(parts);
}

function writeMidiFile(filePath, { bpm, tracks, ppq = DEFAULT_PPQ, name = 'ShiBass' }) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('filePath is required');
  }
  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new Error('tracks must be a non-empty array');
  }
  assertPositiveInt('ppq', ppq);
  if (ppq < 24) {
    throw new Error('ppq is too small');
  }

  const chunks = [];
  const conductor = Buffer.concat([
    metaText(0x03, name),
    tempoBytes(bpm),
    Buffer.from([0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08]),
    Buffer.from([0x00, 0xff, 0x2f, 0x00]),
  ]);
  chunks.push(trackChunk(conductor));

  for (const track of tracks) {
    const payload = Buffer.concat([
      metaText(0x03, track.name ?? 'part'),
      noteEvents(track.notes ?? [], ppq),
    ]);
    chunks.push(trackChunk(payload));
  }

  const header = Buffer.alloc(14);
  header.write('MThd', 0);
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(1, 8);
  header.writeUInt16BE(chunks.length, 10);
  header.writeUInt16BE(ppq, 12);

  ensureDir(path.dirname(filePath));
  const bytes = Buffer.concat([header, ...chunks]);
  fs.writeFileSync(filePath, bytes);
  return { path: filePath, bytes: bytes.length, tracks: chunks.length, bpm, ppq };
}

function isMidiFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return false;
  }
  const buf = fs.readFileSync(filePath);
  return buf.length >= 14 && buf.subarray(0, 4).toString() === 'MThd';
}

module.exports = {
  DEFAULT_PPQ,
  encodeVlq,
  writeMidiFile,
  isMidiFile,
};
