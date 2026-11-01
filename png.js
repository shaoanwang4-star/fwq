const zlib = require('node:zlib');

const TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Solid-colour PNG with a lighter rectangle, so reader pages are visually distinct. */
function png(width, height, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const panel = x > width * 0.18 && x < width * 0.82 && y > height * 0.22 && y < height * 0.72;
      const off = 1 + x * 3;
      const base = panel ? [Math.min(255, r + 60), Math.min(255, g + 60), Math.min(255, b + 60)] : [r, g, b];
      row[off] = base[0];
      row[off + 1] = base[1];
      row[off + 2] = base[2];
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function swatch(seed) {
  const palette = [
    [38, 44, 66], [70, 40, 74], [26, 62, 72], [72, 46, 30], [34, 54, 40], [58, 34, 52], [30, 48, 88],
  ];
  return palette[seed % palette.length];
}

module.exports = { png, swatch };
