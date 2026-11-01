const crypto = require('node:crypto');
const { run, get, now } = require('./db');
const { SESSION_TTL_MS } = require('./config');

const SCRYPT = { N: 16384, r: 8, p: 1 };

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32, SCRYPT).toString('hex');
}

function createPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: hashPassword(password, salt) };
}

function verifyPassword(password, salt, hash) {
  const candidate = Buffer.from(hashPassword(password, salt), 'hex');
  const stored = Buffer.from(hash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)', token, userId, now() + SESSION_TTL_MS);
  run('DELETE FROM sessions WHERE expires_at < ?', now());
  return token;
}

function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
}

function userByToken(token) {
  if (!token) return undefined;
  const row = get(
    `SELECT u.id, u.email, u.display_name, u.role, u.created_at FROM sessions s
     JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`,
    token,
    now(),
  );
  return row;
}

function currentUser(req) {
  return userByToken(parseCookies(req.headers.cookie).sid);
}

function canEdit(user, comic) {
  return user && (user.role === 'admin' || comic.owner_id === user.id);
}

module.exports = {
  createPassword,
  verifyPassword,
  parseCookies,
  createSession,
  destroySession,
  currentUser,
  canEdit,
};
