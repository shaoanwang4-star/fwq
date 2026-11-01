const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

module.exports = {
  PORT,
  DATA_DIR,
  DB_FILE: path.join(DATA_DIR, 'htms.sqlite'),
  UPLOAD_DIR: path.join(DATA_DIR, 'uploads'),
  WEB_DIR: path.join(__dirname, '..', 'web'),
  SESSION_TTL_MS: 7 * 24 * 3600 * 1000,
  MAX_BODY_BYTES: Number(process.env.MAX_BODY_BYTES || 64 * 1024 * 1024),
  MAX_FILE_BYTES: Number(process.env.MAX_FILE_BYTES || 8 * 1024 * 1024),
  MAX_FILES: 40,
  PAGE_WINDOW_MS: 15000,
  ALLOWED_MIME: {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
  },
};
