'use strict';

const fs = require('fs');
const path = require('path');
const { crc32 } = require('./crc32');

function dosDateTime(date) {
  const d = date instanceof Date ? date : new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { dosTime, dosDate };
}

function addFile(entries, relPath, data, mtime) {
  const name = Buffer.from(relPath.replace(/\\/g, '/'), 'utf8');
  const raw = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const crc = crc32(raw) >>> 0;
  const { dosTime, dosDate } = dosDateTime(mtime);
  entries.push({ name, raw, crc, dosTime, dosDate });
}

function walkAdd(entries, absDir, prefix) {
  const list = fs.readdirSync(absDir, { withFileTypes: true });
  for (const entry of list) {
    const full = path.join(absDir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walkAdd(entries, full, rel);
    } else if (entry.isFile()) {
      const st = fs.statSync(full);
      addFile(entries, rel, fs.readFileSync(full), st.mtime);
    }
  }
}

function buildZip(entries) {
  const parts = [];
  const centrals = [];
  let offset = 0;

  for (const e of entries) {
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(e.dosTime, 10);
    local.writeUInt16LE(e.dosDate, 12);
    local.writeUInt32LE(e.crc, 14);
    local.writeUInt32LE(e.raw.length, 18);
    local.writeUInt32LE(e.raw.length, 22);
    local.writeUInt16LE(e.name.length, 26);
    local.writeUInt16LE(0, 28);

    const localFull = Buffer.concat([local, e.name, e.raw]);
    parts.push(localFull);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(e.dosTime, 12);
    central.writeUInt16LE(e.dosDate, 14);
    central.writeUInt32LE(e.crc, 18);
    central.writeUInt32LE(e.raw.length, 22);
    central.writeUInt32LE(e.raw.length, 26);
    central.writeUInt16LE(e.name.length, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt16LE(0, 38);
    central.writeUInt32LE(0, 42);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, e.name]));
    offset += localFull.length;
  }

  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, centralDir, end]);
}

function zipDirectory(absDir, zipPath) {
  const entries = [];
  walkAdd(entries, absDir, path.basename(absDir));
  const buf = buildZip(entries);
  fs.writeFileSync(zipPath, buf);
  return { zipPath, bytes: buf.length, files: entries.length };
}

module.exports = {
  addFile,
  buildZip,
  zipDirectory,
};
