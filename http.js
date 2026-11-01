function sendJson(res, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function fail(res, status, error, extra) {
  sendJson(res, status, { ok: false, error, ...extra });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(Object.assign(new Error('BODY_TOO_LARGE'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 256 * 1024) {
  const raw = await readBody(req, limit);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw Object.assign(new Error('BAD_JSON'), { status: 400 });
  }
}

function clientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

const buckets = new Map();

/** Fixed-ish sliding window counter. Returns { allowed, retryAfterSec }. */
function take(bucketKey, capacity, windowMs, nowTs) {
  const current = buckets.get(bucketKey) || { count: 0, resetAt: nowTs + windowMs };
  if (nowTs >= current.resetAt) {
    current.count = 0;
    current.resetAt = nowTs + windowMs;
  }
  current.count += 1;
  buckets.set(bucketKey, current);
  if (buckets.size > 5000) {
    for (const [key, value] of buckets) {
      if (value.resetAt < nowTs) buckets.delete(key);
    }
  }
  return current.count > capacity ? { allowed: false, retryAfterSec: Math.ceil((current.resetAt - nowTs) / 1000) } : { allowed: true };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function cleanText(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

module.exports = { sendJson, fail, readBody, readJson, clientIp, take, cleanText, EMAIL_RE };
