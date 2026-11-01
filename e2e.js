const assert = require('node:assert');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync, readdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

const PORT = 3399;
const BASE = `http://localhost:${PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), 'htms-e2e-'));

const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', join(__dirname, '..', 'server', 'index.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/me`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error('测试服务器未能启动');
}

const jar = {};
let passed = 0;

async function api(path, opts = {}, who = 'me') {
  const headers = { 'x-requested-with': 'fetch', ...(opts.headers || {}) };
  if (jar[who]) headers.cookie = `sid=${jar[who]}`;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  const type = res.headers.get('content-type') || '';
  const body = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && /sid=([^;]+)/.test(setCookie)) jar[who] = /sid=([^;]+)/.exec(setCookie)[1];
  return { status: res.status, body, headers: res.headers };
}

function check(label, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${label}`);
}

function pageFile(name) {
  return new File([PNG_1PX], name, { type: 'image/png' });
}

(async () => {
  await waitForServer();
  console.log('# 账号');
  const email = `tester_${Date.now()}@example.com`;
  const reg = await api('/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', displayName: '测试作者' }),
  });
  check('注册返回中文昵称且为首个管理员', () => {
    assert.strictEqual(reg.status, 200);
    assert.strictEqual(reg.body.user.display_name, '测试作者');
    assert.strictEqual(reg.body.user.role, 'admin');
  });

  const weak = await api('/api/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'x@y.com', password: '123', displayName: 'a' }),
  });
  check('弱密码被拒', () => assert.strictEqual(weak.body.error, 'BAD_PASSWORD'));

  const badLogin = await api('/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'wrongpass1' }),
  });
  check('错误口令被拒', () => assert.strictEqual(badLogin.status, 401));

  // second ordinary user
  const email2 = `reader_${Date.now()}@example.com`;
  const reg2 = await api('/api/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: email2, password: 'readerpass1', displayName: '读者甲' }),
  }, 'reader');
  check('第二个账号是普通用户', () => assert.strictEqual(reg2.body.user.role, 'user'));

  console.log('# 上传与编辑');
  const form = new FormData();
  form.set('name', '测试漫画');
  form.set('author', '测试作者');
  form.set('description', '第一话试读');
  form.set('cover', pageFile('cover.png'));
  const created = await api('/api/comics', { method: 'POST', body: form });
  check('创建漫画（含封面）', () => {
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.body.comic.name, '测试漫画');
    assert.ok(created.body.comic.cover_image_id > 0);
  });
  const comicId = created.body.comic.id;

  const dup = await api('/api/comics', { method: 'POST', body: (() => { const f = new FormData(); f.set('name', '测试漫画'); f.set('author', 'a'); return f; })() });
  check('同名漫画被拒', () => assert.strictEqual(dup.body.error, 'DUPLICATE_NAME'));

  const chapterForm = new FormData();
  chapterForm.set('title', '第 1 话');
  chapterForm.set('chapter_no', '1');
  chapterForm.append('pages', pageFile('01.png'));
  chapterForm.append('pages', pageFile('02.png'));
  chapterForm.append('pages', pageFile('03.png'));
  const chapter = await api(`/api/comics/${comicId}/chapters`, { method: 'POST', body: chapterForm });
  check('上传章节含 3 页', () => {
    assert.strictEqual(chapter.status, 201);
    assert.strictEqual(chapter.body.pageCount, 3);
  });
  const chapterId = chapter.body.chapter.id;

  const spoof = new FormData();
  spoof.set('title', '恶意话');
  spoof.set('chapter_no', '2');
  spoof.append('pages', new File([Buffer.from('#!/bin/sh\nrm -rf /')], 'evil.png', { type: 'image/png' }));
  const rejected = await api(`/api/comics/${comicId}/chapters`, { method: 'POST', body: spoof });
  check('伪装成 png 的非图片被拒', () => assert.strictEqual(rejected.status, 400));

  const patched = await api(`/api/chapters/${chapterId}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '第 1 话（修订）' }),
  });
  check('编辑章节标题', () => assert.strictEqual(patched.body.chapter.title, '第 1 话（修订）'));

  const renamed = await api(`/api/comics/${comicId}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '测试漫画·改名' }),
  });
  check('编辑漫画信息', () => assert.strictEqual(renamed.body.comic.name, '测试漫画·改名'));

  console.log('# 阅读与弹幕');
  const reader = await api(`/api/reader/${chapterId}`);
  check('阅读页返回 3 页与水印身份', () => {
    assert.strictEqual(reader.body.pages.length, 3);
    assert.match(reader.body.watermark, /^测试作者 · #\d+$/);
  });
  const sent = await api(`/api/reader/${chapterId}/danmaku`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: '这段分镜好强', page_index: 1, time_ms: 3200, color: '#ffcc00' }),
  });
  check('发送弹幕', () => assert.strictEqual(sent.status, 201));
  const longText = await api(`/api/reader/${chapterId}/danmaku`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: '长'.repeat(200), page_index: 0, time_ms: 10 }),
  });
  check('超长弹幕被截断到 60 字', () => assert.strictEqual(longText.body.danmaku.content.length, 60));
  const xss = await api(`/api/reader/${chapterId}/danmaku`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: '<img src=x onerror=alert(1)>', page_index: 0, time_ms: 10 }),
  });
  check('弹幕里的脚本原样存储为文本', () => assert.ok(xss.body.danmaku.content.startsWith('<img')));
  const anon = await api(`/api/reader/${chapterId}`, {}, 'ghost');
  check('未登录不能读章节', () => assert.strictEqual(anon.status, 401));

  console.log('# 图片分发与防盗链');
  const imageId = reader.body.pages[0].image_id;
  const img = await api(`/i/${imageId}`);
  check('已登录可取图且禁缓存', () => {
    assert.strictEqual(img.status, 200);
    assert.strictEqual(img.headers.get('content-type'), 'image/png');
    assert.strictEqual(img.headers.get('cache-control'), 'private, no-store');
  });
  const noAuth = await api(`/i/${imageId}`, {}, 'ghost');
  check('无 cookie 取图被拒', () => assert.strictEqual(noAuth.status, 401));
  const hotlink = await api(`/i/${imageId}`, { headers: { referer: 'https://evil.example.com/steal' } });
  check('外站 referer 取图被拒', () => assert.strictEqual(hotlink.status, 403));
  const coverId = created.body.comic.cover_image_id;
  const guestCover = await api(`/i/${coverId}`, {}, 'ghost');
  check('游客可看已发布作品的封面', () => assert.strictEqual(guestCover.status, 200));
  const guestPage = await api(`/i/${imageId}`, {}, 'ghost');
  check('游客取不到正文页', () => assert.strictEqual(guestPage.status, 401));

  console.log('# 他人权限边界');
  const strangerList = await api('/api/comics', {}, 'reader');
  check('他人可浏览已发布漫画', () => assert.strictEqual(strangerList.body.comics.length, 1));
  const strangerEdit = await api(`/api/comics/${comicId}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '劫持' }),
  }, 'reader');
  check('他人不能改我的漫画', () => assert.strictEqual(strangerEdit.status, 403));
  const strangerDm = await api(`/api/reader/${chapterId}/danmaku`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: '路人弹幕', page_index: 0, time_ms: 1 }),
  }, 'reader');
  check('他人能给我的章节发弹幕', () => assert.strictEqual(strangerDm.status, 201));

  console.log('# 版权保护：举报与下架');
  const reported = await api(`/api/comics/${comicId}/report`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'copyright', note: '搬运自我的公众号' }),
  }, 'reader');
  check('提交侵权举报', () => assert.strictEqual(reported.status, 201));
  const notAdmin = await api('/api/admin/reports', {}, 'reader');
  check('普通用户看不到审核台', () => assert.strictEqual(notAdmin.status, 403));
  const adminList = await api('/api/admin/reports');
  check('管理员看到待处理举报', () => assert.strictEqual(adminList.body.reports[0].status, 'pending'));
  const taken = await api(`/api/admin/comics/${comicId}/status`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'takedown', note: '侵权成立，已下架' }),
  });
  check('下架漫画', () => assert.strictEqual(taken.body.comic.status, 'takedown'));
  const readerAfter = await api(`/api/reader/${chapterId}`, {}, 'reader');
  check('下架后他人读不到章节', () => assert.strictEqual(readerAfter.status, 410));
  const listAfter = await api('/api/comics', {}, 'reader');
  check('下架后不出现在漫画墙', () => assert.strictEqual(listAfter.body.comics.length, 0));
  const ownerAfter = await api(`/api/comics/${comicId}`);
  check('作者仍能查看自己的下架作品', () => assert.strictEqual(ownerAfter.status, 200));
  const imgAfter = await api(`/i/${imageId}`, {}, 'reader');
  check('下架后他人无法直连取图', () => assert.strictEqual(imgAfter.status, 403));
  const reinstate = await api(`/api/admin/comics/${comicId}/status`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'published' }),
  });
  check('恢复上架', () => assert.strictEqual(reinstate.body.comic.status, 'published'));

  console.log('# 删除');
  const delChapter = await api(`/api/chapters/${chapterId}`, { method: 'DELETE' });
  check('删除章节', () => assert.strictEqual(delChapter.status, 200));
  const delComic = await api(`/api/comics/${comicId}`, { method: 'DELETE' });
  check('删除漫画', () => assert.strictEqual(delComic.status, 200));
  const gone = await api(`/api/comics/${comicId}`);
  check('删除后 404', () => assert.strictEqual(gone.status, 404));

  const leftovers = readdirSync(join(dataDir, 'uploads'));
  check('删除漫画后磁盘图片被回收', () => assert.deepStrictEqual(leftovers, []));

  console.log(`\n全部 ${passed} 项通过`);
  await teardown();
})().catch(async (error) => {
  console.error('失败:', error.message);
  await teardown();
  process.exit(1);
});

async function teardown() {
  await new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill();
    setTimeout(resolve, 1500);
  });
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {}
}
