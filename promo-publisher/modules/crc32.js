'use strict';

const TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  TABLE[i] = c >>> 0;
}

function crc32(buf) {
  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

module.exports = { crc32 };
