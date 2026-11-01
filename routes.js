const fs = require('node:fs');
const path = require('node:path');
const { run, get, all, transaction, now } = require('./db');
const auth = require('./auth');
const { sendJson, fail, readJson, readBody, clientIp, take, cleanText, EMAIL_RE } = require('./http');
const { saveImage, safeName } = require('./images');
const { parseMultipart, boundaryFrom } = require('./multipart');
const cfg = require('./config');
const { UPLOAD_DIR } = cfg;

function badRequest(res, error) {
  fail(res, 400, error);
}

function requireUser(req, res) {
  const user = auth.currentUser(req);
  if (!user) fail(res, 401, 'NEED_LOGIN');
  return user;
}

function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (user && user.role !== 'admin') fail(res, 403, 'NEED_ADMIN');
  return user && user.role === 'admin' ? user : undefined;
}

async function readForm(req) {
  const type = req.headers['content-type'] || '';
  if (type.includes('multipart/form-data')) {
    const boundary = boundaryFrom(type);
    if (!boundary) throw Object.assign(new Error('NO_BOUNDARY'), { status: 400 });
    const raw = await readBody(req, cfg.MAX_BODY_BYTES);
    return parseMultipart(raw, boundary);
  }
  const raw = await readBody(req, cfg.MAX_BODY_BYTES);
  if (!raw.length) return { fields: {}, files: [] };
  let parsed = {};
  if (type.includes('application/json')) {
    parsed = JSON.parse(raw.toString('utf8'));
  } else {
    for (const [k, v] of new URLSearchParams(raw.toString('utf8'))) parsed[k] = v;
  }
  const fields = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (Array.isArray(value)) value.forEach((item, i) => (fields[`${key}[${i}]`] = String(item)));
    else fields[key] = String(value);
  }
  return { fields, files: [] };
}

function orphanImageCleanup(imageIds) {
  for (const id of imageIds) {
    const used = get('SELECT 1 AS x FROM pages WHERE image_id = ? LIMIT 1', id)
      || get('SELECT 1 AS x FROM comics WHERE cover_image_id = ? LIMIT 1', id);
    if (used) continue;
    const row = get('SELECT file_name FROM images WHERE id = ?', id);
    if (row) fs.unlink(path.join(UPLOAD_DIR, safeName(row.file_name)), () => {});
    run('DELETE FROM images WHERE id = ?', id);
  }
}

function chapterImageIds(chapterId) {
  return all('SELECT image_id AS id FROM pages WHERE chapter_id = ?', chapterId).map((r) => r.id);
}

function comicImageIds(comicId) {
  const ids = all(
    `SELECT i.image_id AS id FROM pages i JOIN chapters c ON c.id = i.chapter_id WHERE c.comic_id = ?`,
    comicId,
  ).map((r) => r.id);
  const comic = get('SELECT cover_image_id AS id FROM comics WHERE id = ?', comicId);
  if (comic && comic.id) ids.push(comic.id);
  return ids;
}

const routes = [];

function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => {
    keys.push(k);
    return '([^/]+)';
  })}$`);
  routes.push({ method, re, keys, handler });
}

function dispatch(method, pathname) {
  for (const item of routes) {
    if (item.method !== method) continue;
    const m = item.re.exec(pathname);
    if (m) {
      const params = {};
      item.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { handler: item.handler, params };
    }
  }
  return null;
}

/* ---------------- accounts ---------------- */

route('POST', '/api/register', async (req, res) => {
  const limit = take(`reg:${clientIp(req)}`, 20, 60 * 1000, now());
  if (!limit.allowed) return fail(res, 429, 'TOO_MANY', { retryAfterSec: limit.retryAfterSec });
  const body = await readJson(req);
  const email = cleanText(body.email, 200).toLowerCase();
  const displayName = cleanText(body.displayName, 40);
  const password = String(body.password || '');
  if (!EMAIL_RE.test(email)) return badRequest(res, 'BAD_EMAIL');
  if (password.length < 8 || password.length > 200) return badRequest(res, 'BAD_PASSWORD');
  if (displayName.length < 1) return badRequest(res, 'BAD_NAME');
  if (get('SELECT 1 AS x FROM users WHERE email = ?', email)) return fail(res, 409, 'EMAIL_TAKEN');
  const { salt, hash } = auth.createPassword(password);
  const isFirst = Number(get('SELECT COUNT(*) AS c FROM users').c) === 0;
  const info = run(
    'INSERT INTO users (email, password_hash, salt, display_name, role, created_at) VALUES (?,?,?,?,?,?)',
    email, hash, salt, displayName, isFirst ? 'admin' : 'user', now(),
  );
  const token = auth.createSession(Number(info.lastInsertRowid));
  sendJson(res, 200, { ok: true, user: get('SELECT id, email, display_name, role FROM users WHERE id = ?', Number(info.lastInsertRowid)) }, {
    'set-cookie': `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cfg.SESSION_TTL_MS / 1000}`,
  });
});

route('POST', '/api/login', async (req, res) => {
  const limit = take(`login:${clientIp(req)}`, 30, 60 * 1000, now());
  if (!limit.allowed) return fail(res, 429, 'TOO_MANY', { retryAfterSec: limit.retryAfterSec });
  const body = await readJson(req);
  const email = cleanText(body.email, 200).toLowerCase();
  const user = get('SELECT * FROM users WHERE email = ?', email);
  if (!user || !auth.verifyPassword(String(body.password || ''), user.salt, user.password_hash)) {
    return fail(res, 401, 'BAD_CREDENTIALS');
  }
  const token = auth.createSession(user.id);
  sendJson(res, 200, { ok: true, user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role } }, {
    'set-cookie': `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${cfg.SESSION_TTL_MS / 1000}`,
  });
});

route('POST', '/api/logout', (req, res) => {
  auth.destroySession(auth.parseCookies(req.headers.cookie).sid);
  sendJson(res, 200, { ok: true }, { 'set-cookie': 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
});

route('GET', '/api/me', (req, res) => {
  const user = auth.currentUser(req);
  sendJson(res, 200, { ok: true, user: user || null });
});

/* ---------------- comics ---------------- */

route('GET', '/api/comics', (req, res, params, query) => {
  const user = auth.currentUser(req);
  const mine = query.get('mine') === '1';
  if (mine && !user) return fail(res, 401, 'NEED_LOGIN');
  const q = cleanText(query.get('q') || '', 60);
  const rows = all(
    `SELECT c.id, c.name, c.author, c.description, c.status, c.cover_image_id, c.owner_id, c.updated_at,
            u.display_name AS owner_name,
            (SELECT COUNT(*) FROM chapters ch WHERE ch.comic_id = c.id) AS chapter_count
     FROM comics c JOIN users u ON u.id = c.owner_id
     WHERE (? = 1 OR c.status = 'published') AND (? = '' OR c.name LIKE '%' || ? || '%' OR c.author LIKE '%' || ? || '%')
       AND (? = 0 OR c.owner_id = ?)
     ORDER BY c.updated_at DESC LIMIT 200`,
    mine ? 1 : 0, q, q, q, mine ? 1 : 0, user ? user.id : 0,
  );
  sendJson(res, 200, { ok: true, comics: rows });
});

route('GET', '/api/comics/:id', (req, res, params) => {
  const comic = get(
    `SELECT c.*, u.display_name AS owner_name FROM comics c JOIN users u ON u.id = c.owner_id WHERE c.id = ?`,
    Number(params.id),
  );
  if (!comic) return fail(res, 404, 'NOT_FOUND');
  const user = auth.currentUser(req);
  if (comic.status === 'takedown' && !auth.canEdit(user, comic)) return fail(res, 410, 'TAKEDOWN');
  const chapters = all('SELECT id, title, chapter_no, created_at FROM chapters WHERE comic_id = ? ORDER BY chapter_no', comic.id);
  sendJson(res, 200, { ok: true, comic, chapters, canEdit: auth.canEdit(user, comic) });
});

route('POST', '/api/comics', async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const form = await readForm(req);
  const name = cleanText(form.fields.name, 80);
  const author = cleanText(form.fields.author, 60) || user.display_name;
  const description = cleanText(form.fields.description, 2000);
  if (name.length < 1) return badRequest(res, 'BAD_NAME');
  if (get('SELECT 1 AS x FROM comics WHERE owner_id = ? AND name = ?', user.id, name)) return fail(res, 409, 'DUPLICATE_NAME');
  let coverId = null;
  const cover = form.files.find((f) => f.name === 'cover');
  if (cover) {
    const saved = saveImage(cover.data, cover.type, user.id);
    coverId = Number(run('INSERT INTO images (owner_id, file_name, mime, bytes, created_at) VALUES (?,?,?,?,?)', saved.ownerId, saved.fileName, saved.mime, saved.bytes, now()).lastInsertRowid);
  }
  const info = run(
    'INSERT INTO comics (owner_id, name, author, description, cover_image_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    user.id, name, author, description, coverId, now(), now(),
  );
  sendJson(res, 201, { ok: true, comic: get('SELECT * FROM comics WHERE id = ?', Number(info.lastInsertRowid)) });
});

route('PATCH', '/api/comics/:id', async (req, res, params) => {
  const user = requireUser(req, res);
  if (!user) return;
  const comic = get('SELECT * FROM comics WHERE id = ?', Number(params.id));
  if (!comic) return fail(res, 404, 'NOT_FOUND');
  if (!auth.canEdit(user, comic)) return fail(res, 403, 'NOT_OWNER');
  const form = await readForm(req);
  const name = cleanText(form.fields.name ?? comic.name, 80);
  const author = cleanText(form.fields.author ?? comic.author, 60);
  const description = cleanText(form.fields.description ?? comic.description, 2000);
  if (!name) return badRequest(res, 'BAD_NAME');
  let coverId = comic.cover_image_id;
  const cover = form.files.find((f) => f.name === 'cover');
  if (cover) {
    const saved = saveImage(cover.data, cover.type, user.id);
    coverId = Number(run('INSERT INTO images (owner_id, file_name, mime, bytes, created_at) VALUES (?,?,?,?,?)', saved.ownerId, saved.fileName, saved.mime, saved.bytes, now()).lastInsertRowid);
  } else if (form.fields.removeCover === '1') {
    coverId = null;
  }
  run('UPDATE comics SET name=?, author=?, description=?, cover_image_id=?, updated_at=? WHERE id=?',
    name, author, description, coverId, now(), comic.id);
  if (comic.cover_image_id && coverId !== comic.cover_image_id) orphanImageCleanup([comic.cover_image_id]);
  sendJson(res, 200, { ok: true, comic: get('SELECT * FROM comics WHERE id = ?', comic.id) });
});

route('DELETE', '/api/comics/:id', (req, res, params) => {
  const user = requireUser(req, res);
  if (!user) return;
  const comic = get('SELECT * FROM comics WHERE id = ?', Number(params.id));
  if (!comic) return fail(res, 404, 'NOT_FOUND');
  if (!auth.canEdit(user, comic)) return fail(res, 403, 'NOT_OWNER');
  transaction(() => {
    const ids = comicImageIds(comic.id);
    run('DELETE FROM comics WHERE id = ?', comic.id);
    orphanImageCleanup(ids);
  });
  sendJson(res, 200, { ok: true });
});

/* ---------------- chapters & pages ---------------- */

route('POST', '/api/comics/:id/chapters', async (req, res, params) => {
  const user = requireUser(req, res);
  if (!user) return;
  const comic = get('SELECT * FROM comics WHERE id = ?', Number(params.id));
  if (!comic) return fail(res, 404, 'NOT_FOUND');
  if (!auth.canEdit(user, comic)) return fail(res, 403, 'NOT_OWNER');
  const form = await readForm(req);
  const title = cleanText(form.fields.title, 80);
  const chapterNo = Number(form.fields.chapter_no);
  if (!title) return badRequest(res, 'BAD_TITLE');
  if (!Number.isFinite(chapterNo) || chapterNo <= 0) return badRequest(res, 'BAD_CHAPTER_NO');
  if (get('SELECT 1 AS x FROM chapters WHERE comic_id = ? AND chapter_no = ?', comic.id, chapterNo)) return fail(res, 409, 'DUPLICATE_CHAPTER_NO');
  const files = form.files.filter((f) => f.name === 'pages' || f.name === 'pages[]');
  if (!files.length) return badRequest(res, 'NO_PAGES');
  if (files.length > cfg.MAX_FILES) return fail(res, 413, 'TOO_MANY_FILES');
  const savedImages = [];
  let chapterId;
  try {
    for (const file of files) {
      const saved = saveImage(file.data, file.type, user.id);
      savedImages.push(saved);
    }
    chapterId = transaction(() => {
      const id = Number(run('INSERT INTO chapters (comic_id, title, chapter_no, created_at) VALUES (?,?,?,?)', comic.id, title, chapterNo, now()).lastInsertRowid);
      savedImages.forEach((saved, index) => {
        const imageId = Number(run('INSERT INTO images (owner_id, file_name, mime, bytes, created_at) VALUES (?,?,?,?,?)', saved.ownerId, saved.fileName, saved.mime, saved.bytes, now()).lastInsertRowid);
        run('INSERT INTO pages (chapter_id, image_id, position, created_at) VALUES (?,?,?,?)', id, imageId, index + 1, now());
      });
      run('UPDATE comics SET updated_at = ? WHERE id = ?', now(), comic.id);
      return id;
    });
  } catch (error) {
    for (const saved of savedImages) fs.unlink(path.join(UPLOAD_DIR, saved.fileName), () => {});
    if (error.message === 'BAD_IMAGE') return badRequest(res, 'BAD_IMAGE');
    throw error;
  }
  sendJson(res, 201, { ok: true, chapter: get('SELECT * FROM chapters WHERE id = ?', chapterId), pageCount: files.length });
});

route('PATCH', '/api/chapters/:id', async (req, res, params) => {
  const user = requireUser(req, res);
  if (!user) return;
  const chapter = get('SELECT ch.*, c.owner_id FROM chapters ch JOIN comics c ON c.id = ch.comic_id WHERE ch.id = ?', Number(params.id));
  if (!chapter) return fail(res, 404, 'NOT_FOUND');
  if (!auth.canEdit(user, chapter)) return fail(res, 403, 'NOT_OWNER');
  const form = await readForm(req);
  const title = cleanText(form.fields.title ?? chapter.title, 80);
  const chapterNo = form.fields.chapter_no === undefined ? chapter.chapter_no : Number(form.fields.chapter_no);
  if (!title) return badRequest(res, 'BAD_TITLE');
  if (!Number.isFinite(chapterNo) || chapterNo <= 0) return badRequest(res, 'BAD_CHAPTER_NO');
  const clash = get('SELECT id FROM chapters WHERE comic_id = ? AND chapter_no = ? AND id <> ?', chapter.comic_id, chapterNo, chapter.id);
  if (clash) return fail(res, 409, 'DUPLICATE_CHAPTER_NO');
  run('UPDATE chapters SET title = ?, chapter_no = ? WHERE id = ?', title, chapterNo, chapter.id);
  run('UPDATE comics SET updated_at = ? WHERE id = ?', now(), chapter.comic_id);
  sendJson(res, 200, { ok: true, chapter: get('SELECT * FROM chapters WHERE id = ?', chapter.id) });
});

route('DELETE', '/api/chapters/:id', (req, res, params) => {
  const user = requireUser(req, res);
  if (!user) return;
  const chapter = get('SELECT ch.*, c.owner_id FROM chapters ch JOIN comics c ON c.id = ch.comic_id WHERE ch.id = ?', Number(params.id));
  if (!chapter) return fail(res, 404, 'NOT_FOUND');
  if (!auth.canEdit(user, chapter)) return fail(res, 403, 'NOT_OWNER');
  transaction(() => {
    const ids = chapterImageIds(chapter.id);
    run('DELETE FROM chapters WHERE id = ?', chapter.id);
    orphanImageCleanup(ids);
    run('UPDATE comics SET updated_at = ? WHERE id = ?', now(), chapter.comic_id);
  });
  sendJson(res, 200, { ok: true });
});

route('DELETE', '/api/pages/:id', (req, res, params) => {
  const user = requireUser(req, res);
  if (!user) return;
  const page = get(
    `SELECT p.id, p.image_id, c.owner_id FROM pages p JOIN chapters ch ON ch.id = p.chapter_id JOIN comics c ON c.id = ch.comic_id WHERE p.id = ?`,
    Number(params.id),
  );
  if (!page) return fail(res, 404, 'NOT_FOUND');
  if (!auth.canEdit(user, page)) return fail(res, 403, 'NOT_OWNER');
  transaction(() => {
    run('DELETE FROM pages WHERE id = ?', page.id);
    orphanImageCleanup([page.image_id]);
  });
  sendJson(res, 200, { ok: true });
});

/* ---------------- reader & danmaku ---------------- */

route('GET', '/api/reader/:chapterId', (req, res, params) => {
  const user = requireUser(req, res);
  if (!user) return;
  const chapter = get(
    `SELECT ch.*, c.name AS comic_name, c.owner_id, c.status FROM chapters ch JOIN comics c ON c.id = ch.comic_id WHERE ch.id = ?`,
    Number(params.chapterId),
  );
  if (!chapter) return fail(res, 404, 'NOT_FOUND');
  if (chapter.status === 'takedown' && !auth.canEdit(user, chapter)) return fail(res, 410, 'TAKEDOWN');
  const pages = all(
    `SELECT p.id, p.position, i.id AS image_id, i.mime, i.bytes FROM pages p JOIN images i ON i.id = p.image_id
     WHERE p.chapter_id = ? ORDER BY p.position`,
    chapter.id,
  );
  const danmaku = all(
    `SELECT d.id, d.page_index, d.time_ms, d.content, d.color, COALESCE(u.display_name, d.guest_name, '匿名') AS sender
     FROM danmaku d LEFT JOIN users u ON u.id = d.user_id WHERE d.chapter_id = ? ORDER BY d.id`,
    chapter.id,
  );
  sendJson(res, 200, {
    ok: true,
    chapter,
    pages: pages.map((p) => ({ ...p, url: `/i/${p.image_id}` })),
    danmaku,
    watermark: `${user.display_name} · #${user.id}`,
    canEdit: auth.canEdit(user, chapter),
  });
});

route('POST', '/api/reader/:chapterId/danmaku', async (req, res, params) => {
  const user = requireUser(req, res);
  if (!user) return;
  const chapter = get('SELECT * FROM chapters WHERE id = ?', Number(params.chapterId));
  if (!chapter) return fail(res, 404, 'NOT_FOUND');
  const limit = take(`dm:${user.id}`, 60, 60 * 1000, now());
  if (!limit.allowed) return fail(res, 429, 'TOO_MANY', { retryAfterSec: limit.retryAfterSec });
  const body = await readJson(req);
  const content = cleanText(body.content, 60);
  const pageIndex = Math.max(0, Math.min(500, Number(body.page_index) || 0));
  const timeMs = Math.max(0, Math.min(cfg.PAGE_WINDOW_MS, Number(body.time_ms) || 0));
  const color = /^#[0-9a-f]{6}$/i.test(String(body.color || '')) ? String(body.color) : '#ffffff';
  if (!content) return badRequest(res, 'EMPTY_DANMAKU');
  const info = run(
    'INSERT INTO danmaku (chapter_id, user_id, page_index, time_ms, content, color, created_at) VALUES (?,?,?,?,?,?,?)',
    chapter.id, user.id, pageIndex, timeMs, content, color, now(),
  );
  sendJson(res, 201, { ok: true, danmaku: { id: Number(info.lastInsertRowid), page_index: pageIndex, time_ms: timeMs, content, color, sender: user.display_name } });
});

/* ---------------- copyright: reports & admin ---------------- */

const REASONS = new Set(['copyright', 'unauthorized_upload', 'porn', 'other']);

route('POST', '/api/comics/:id/report', async (req, res, params) => {
  const user = requireUser(req, res);
  if (!user) return;
  const comic = get('SELECT * FROM comics WHERE id = ?', Number(params.id));
  if (!comic) return fail(res, 404, 'NOT_FOUND');
  const limit = take(`rp:${user.id}`, 20, 60 * 1000, now());
  if (!limit.allowed) return fail(res, 429, 'TOO_MANY');
  const body = await readJson(req);
  const reason = REASONS.has(body.reason) ? body.reason : 'other';
  const note = cleanText(body.note, 500);
  run('INSERT INTO reports (comic_id, reporter_id, reason, created_at) VALUES (?,?,?,?)', comic.id, user.id, `${reason}: ${note}`.trim(), now());
  sendJson(res, 201, { ok: true });
});

route('GET', '/api/admin/reports', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const rows = all(
    `SELECT r.*, c.name AS comic_name, c.status AS comic_status, u.display_name AS reporter
     FROM reports r JOIN comics c ON c.id = r.comic_id LEFT JOIN users u ON u.id = r.reporter_id
     ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC LIMIT 200`,
  );
  sendJson(res, 200, { ok: true, reports: rows });
});

route('POST', '/api/admin/comics/:id/status', async (req, res, params) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const comic = get('SELECT * FROM comics WHERE id = ?', Number(params.id));
  if (!comic) return fail(res, 404, 'NOT_FOUND');
  const body = await readJson(req);
  const status = body.status === 'takedown' ? 'takedown' : 'published';
  const note = cleanText(body.note, 300);
  run('UPDATE comics SET status = ?, takedown_reason = ? WHERE id = ?', status, status === 'takedown' ? note : null, comic.id);
  transaction(() => {
    for (const r of all('SELECT id FROM reports WHERE comic_id = ? AND status = ?', comic.id, 'pending')) {
      run('UPDATE reports SET status = ?, handled_note = ?, handled_at = ? WHERE id = ?', 'done', note, now(), r.id);
    }
  });
  sendJson(res, 200, { ok: true, comic: get('SELECT * FROM comics WHERE id = ?', comic.id) });
});

/* ---------------- protected image delivery ---------------- */

route('GET', '/i/:imageId', (req, res, params) => {
  const id = Number(params.imageId);
  const row = get('SELECT * FROM images WHERE id = ?', id);
  if (!row) return fail(res, 404, 'NOT_FOUND');
  const user = auth.currentUser(req);
  const isPublicCover = get(`SELECT 1 AS x FROM comics WHERE cover_image_id = ? AND status = 'published' LIMIT 1`, id);
  if (!user && !isPublicCover) return fail(res, 401, 'NEED_LOGIN');
  const visible =
    isPublicCover
    || get(`SELECT 1 AS x FROM pages p JOIN chapters c ON c.id = p.chapter_id JOIN comics m ON m.id = c.comic_id
            WHERE p.image_id = ? AND m.status = 'published' LIMIT 1`, id)
    || (user && row.owner_id === user.id);
  if (!visible) return fail(res, 403, 'NOT_AVAILABLE');
  const referer = req.headers.referer;
  if (referer) {
    try {
      if (new URL(referer).host !== req.headers.host) return fail(res, 403, 'HOTLINK_DENIED');
    } catch {
      return fail(res, 403, 'BAD_REFERER');
    }
  }
  const file = path.join(UPLOAD_DIR, safeName(row.file_name));
  if (!fs.existsSync(file)) return fail(res, 404, 'MISSING_FILE');
  res.writeHead(200, {
    'content-type': row.mime,
    'content-length': row.bytes,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    'content-disposition': 'inline',
  });
  fs.createReadStream(file).pipe(res);
});

module.exports = { dispatch };
