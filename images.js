const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { UPLOAD_DIR, ALLOWED_MIME, MAX_FILE_BYTES } = require('./config');

const MAGIC = [
  ['image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
  ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff])],
  ['image/gif', Buffer.from('GIF8')],
  ['image/webp', Buffer.from('RIFF')],
];

function sniff(data) {
  for (const [mime, sig] of MAGIC) {
    if (data.compare(sig, 0, sig.length, 0, sig.length) === 0) {
      if (mime !== 'image/webp' || data.slice(8, 12).toString() === 'WEBP') return mime;
    }
  }
  return null;
}

function safeName(name) {
  return path.basename(String(name || 'file')).replace(/[^\w.\-]/g, '_').slice(0, 80) || 'file';
}

function saveImage(data, declaredMime, ownerId) {
  if (!Buffer.isBuffer(data) || data.length === 0) throw new Error('EMPTY_IMAGE');
  if (data.length > MAX_FILE_BYTES) throw new Error('FILE_TOO_LARGE');
  const mime = sniff(data);
  if (!mime || mime !== declaredMime || !ALLOWED_MIME[mime]) throw new Error('BAD_IMAGE');
  const fileName = `${crypto.randomUUID()}${ALLOWED_MIME[mime]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, fileName), data);
  return { fileName, mime, bytes: data.length, ownerId };
}

module.exports = { saveImage, safeName, sniff };
