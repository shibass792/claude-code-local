'use strict';

/**
 * Minimal Standard MIDI File writer (format 1, store-only, no deps).
 */

function vlq(value) {
  const bytes = [value & 0x7f];
  let v = value >>> 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return Buffer.from(bytes);
}

function meta(delta, type, data) {
  return Buffer.concat([vlq(delta), Buffer.from([0xff, type, data.length]), data]);
}

function noteOn(delta, channel, note, velocity) {
  return Buffer.concat([vlq(delta), Buffer.from([0x90 | (channel & 0x0f), note & 0x7f, velocity & 0x7f])]);
}

function noteOff(delta, channel, note) {
  return Buffer.concat([vlq(delta), Buffer.from([0x80 | (channel & 0x0f), note & 0x7f, 0])]);
}

function trackChunk(events) {
  const body = Buffer.concat([...events, meta(0, 0x2f, Buffer.alloc(0))]);
  const header = Buffer.alloc(8);
  header.write('MTrk', 0);
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

function tempoMeta(bpm) {
  const usec = Math.round(60000000 / bpm);
  const data = Buffer.alloc(3);
  data.writeUIntBE(usec, 0, 3);
  return meta(0, 0x51, data);
}

function timeSigMeta() {
  return meta(0, 0x58, Buffer.from([4, 2, 24, 8]));
}

function programChange(delta, channel, program) {
  return Buffer.concat([vlq(delta), Buffer.from([0xc0 | (channel & 0x0f), program & 0x7f])]);
}

/**
 * @param {{ bpm?: number, tracks: Array<{ name?: string, events: Buffer[] }> }} spec
 */
function writeMidi({ bpm = 142, ppq = 96, tracks }) {
  const header = Buffer.alloc(14);
  header.write('MThd', 0);
  header.writeUInt32BE(6, 4);
  header.writeUInt16BE(1, 8);
  header.writeUInt16BE(tracks.length + 1, 10);
  header.writeUInt16BE(ppq, 12);

  const conductor = trackChunk([tempoMeta(bpm), timeSigMeta()]);
  const bodies = tracks.map((track) => {
    const name = Buffer.from(String(track.name || 'track'), 'utf8').subarray(0, 32);
    return trackChunk([meta(0, 0x03, name), ...(track.events || [])]);
  });
  return Buffer.concat([header, conductor, ...bodies]);
}

function pulseEvents(notes, { channel = 0, ppq = 96, gate = 0.7 } = {}) {
  const events = [];
  let lastTick = 0;
  const sorted = [...notes].sort((a, b) => a.tick - b.tick);
  for (const n of sorted) {
    const start = Math.max(0, n.tick - lastTick);
    events.push(noteOn(start, channel, n.note, n.velocity ?? 100));
    lastTick = n.tick;
    const dur = Math.max(1, Math.round((n.duration || ppq) * gate));
    events.push(noteOff(dur, channel, n.note));
    lastTick += dur;
  }
  return events;
}

module.exports = {
  vlq,
  meta,
  noteOn,
  noteOff,
  programChange,
  writeMidi,
  pulseEvents,
};
