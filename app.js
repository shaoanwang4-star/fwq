'use strict';

const app = document.getElementById('app');
const nav = document.getElementById('nav');
const who = document.getElementById('who');
const toastEl = document.getElementById('toast');
const searchEl = document.getElementById('search');

let me = null;
const PAGE_WINDOW_MS = 15000;

/* ---------------- helpers ---------------- */

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...opts });
  const data = await res.json().catch(() => ({ ok: false, error: 'BAD_RESPONSE' }));
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.payload = data;
    throw err;
  }
  return data;
}

const LABELS = {
  NEED_LOGIN: '请先登录',
  NEED_ADMIN: '需要管理员权限',
  BAD_EMAIL: '邮箱格式不对',
  BAD_PASSWORD: '密码至少 8 位',
  BAD_NAME: '昵称不能为空',
  EMAIL_TAKEN: '该邮箱已注册',
  BAD_CREDENTIALS: '邮箱或密码错误',
  DUPLICATE_NAME: '你已经有同名作品了',
  DUPLICATE_CHAPTER_NO: '话数重复，请换一个数字',
  NO_PAGES: '没有选择任何图片',
  BAD_IMAGE: '文件不是受支持的图片（png/jpg/gif/webp）',
  TOO_MANY: '操作太快，稍后再试',
  TOO_MANY_FILES: '一次最多上传 40 张',
  BAD_TITLE: '章节标题不能为空',
  BAD_CHAPTER_NO: '话数必须是正数',
  TAKEDOWN: '该作品已被下架',
  NOT_AVAILABLE: '图片不可访问',
  HOTLINK_DENIED: '禁止外链引用',
  NOT_OWNER: '只能修改自己的作品',
  EMPTY_DANMAKU: '弹幕内容不能为空',
  NOT_FOUND: '内容不存在',
  BODY_TOO_LARGE: '上传内容过大',
  FILE_TOO_LARGE: '单张图片超过 8MB',
  SERVER_ERROR: '服务器出错了',
};

function msg(error) {
  return LABELS[error.message] || error.message || '未知错误';
}

let toastTimer;
function toast(text, isErr) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  toastEl.style.borderColor = isErr ? 'var(--accent)' : 'var(--ok)';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 2600);
}

function go(hash) { location.hash = hash; }

/* ---------------- shell ---------------- */

function renderNav(active) {
  const links = [['#/', '漫画墙']];
  if (me) {
    links.push(['#/my', '我的漫画'], ['#/upload', '上传作品']);
    if (me.role === 'admin') links.push(['#/admin', '版权审核']);
  }
  nav.replaceChildren(...links.map(([href, text]) => h('a', { href, class: active === href ? 'active' : '', text })));
  who.replaceChildren(
    me
      ? h('span', {}, `${me.display_name}（${me.role === 'admin' ? '管理员' : '作者'}）`)
      : h('span', {}, '未登录'),
    me
      ? h('button', { class: 'small', style: 'margin-left:10px', onclick: async () => { await api('/api/logout', { method: 'POST' }); me = null; go('#/'); boot(); } }, '退出')
      : h('a', { href: '#/auth', style: 'margin-left:10px' }, '登录'),
  );
  searchEl.value = active === '#/' && location.hash.startsWith('#/?') ? new URLSearchParams(location.hash.slice(3)).get('q') || '' : '';
  searchEl.placeholder = me ? '搜索漫画或作者' : '登录后搜索';
}

/* ---------------- views ---------------- */

function viewAuth() {
  const box = h('div', { class: 'auth panel' });
  const err = h('div', { class: 'err' });
  const email = h('input', { type: 'email', autocomplete: 'username' });
  const pass = h('input', { type: 'password', autocomplete: 'current-password' });
  const name = h('input', { type: 'text', placeholder: '笔名 / 昵称' });
  const nameField = h('div', { class: 'field' }, h('label', {}, '昵称'), name);
  const submit = h('button', { class: 'primary' }, '登录');
  let mode = 'login';

  function paint() {
    submit.textContent = mode === 'login' ? '登录' : '注册并登录';
    nameField.hidden = mode === 'login';
    toggle.textContent = mode === 'login' ? '还没有账号？去注册' : '已有账号？去登录';
    pass.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  }

  const toggle = h('a', { href: '#', onclick: (e) => { e.preventDefault(); mode = mode === 'login' ? 'register' : 'login'; paint(); } });

  async function doSubmit() {
    err.textContent = '';
    const body = { email: email.value.trim(), password: pass.value };
    if (mode === 'register') body.displayName = name.value.trim();
    try {
      const data = await api(`/api/${mode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      me = data.user;
      toast(`欢迎，${me.display_name}`);
      go('#/');
      boot();
    } catch (e) { err.textContent = msg(e); }
  }

  submit.addEventListener('click', doSubmit);
  [email, pass, name].forEach((i) => i.addEventListener('keydown', (e) => e.key === 'Enter' && doSubmit()));
  paint();
  box.append(
    h('h1', {}, me ? '已登录' : '登录 / 注册'),
    h('p', { class: 'sub' }, '阅读、发弹幕、上传作品都需要账号。'),
    h('div', { class: 'field' }, h('label', {}, '邮箱'), email),
    h('div', { class: 'field' }, h('label', {}, '密码'), pass),
    nameField,
    err,
    h('div', { class: 'row' }, submit, toggle),
    h('div', { class: 'notice', style: 'margin-top:16px' }, '首个注册的账号自动成为管理员，可处理侵权举报与下架。'),
  );
  return box;
}

function coverCard(comic) {
  return h('a', { class: 'card', href: `#/comic/${comic.id}` },
    h('div', { class: 'cover' }, comic.cover_image_id ? h('img', { src: `/i/${comic.cover_image_id}`, alt: comic.name, draggable: 'false', loading: 'lazy' }) : h('div', { style: 'display:grid;place-items:center;height:100%;color:var(--muted)' }, '无封面')),
    h('div', { class: 'body' },
      h('div', { class: 'title', text: comic.name }),
      h('div', { class: 'meta', text: `${comic.author} · ${comic.chapter_count} 话` }),
      comic.status !== 'published' ? h('span', { class: 'pill takedown', text: '已下架' }) : null,
    ),
  );
}

async function viewLibrary() {
  const q = location.hash.startsWith('#/?') ? new URLSearchParams(location.hash.slice(3)).get('q') || '' : '';
  renderNav('#/');
  app.replaceChildren(h('h1', {}, '漫画墙'), h('p', { class: 'sub' }, q ? `搜索“${q}”的结果` : '全部已上架作品'), h('div', { class: 'empty' }, '加载中…'));
  try {
    const data = await api(`/api/comics?q=${encodeURIComponent(q)}`);
    const head = h('h1', {}, '漫画墙');
    const grid = h('div', { class: 'grid' }, ...data.comics.map(coverCard));
    app.replaceChildren(head, h('p', { class: 'sub' }, q ? `搜索“${q}”的结果` : `共 ${data.comics.length} 部作品`), data.comics.length ? grid : h('div', { class: 'empty' }, '还没有作品，登录后上传第一部吧。'));
  } catch (e) {
    app.replaceChildren(h('div', { class: 'empty' }, msg(e)));
  }
}

async function viewMy() {
  renderNav('#/my');
  app.replaceChildren(h('div', { class: 'empty' }, '加载中…'));
  const data = await api('/api/comics?mine=1');
  const list = h('div', { class: 'list' });
  for (const comic of data.comics) {
    list.append(h('div', { class: 'list-item' },
      h('div', {},
        h('a', { href: `#/comic/${comic.id}`, style: 'font-weight:600' }, comic.name),
        h('div', { class: 'meta' }, `${comic.author} · ${comic.chapter_count} 话 · 更新于 ` + new Date(comic.updated_at).toLocaleString()),
      ),
      h('div', { class: 'actions' },
        h('span', { class: `pill ${comic.status}` }, comic.status === 'published' ? '上架中' : '已下架'),
        h('button', { class: 'small', onclick: () => go(`#/edit/${comic.id}`) }, '编辑'),
        h('button', { class: 'small', onclick: () => go(`#/chapter/${comic.id}`) }, '加话'),
        h('button', { class: 'small danger', onclick: async () => {
          if (!confirm(`删除《${comic.name}》及其全部章节？图片也会一并清除。`)) return;
          try { await api(`/api/comics/${comic.id}`, { method: 'DELETE' }); toast('已删除'); viewMy(); } catch (e) { toast(msg(e), true); }
        } }, '删除'),
      ),
    ));
  }
  app.replaceChildren(
    h('h1', {}, '我的漫画'),
    h('p', { class: 'sub' }, '只有你和管理员可以编辑这些作品。'),
    data.comics.length ? list : h('div', { class: 'empty' }, '还没有作品。'),
    h('div', { style: 'margin-top:18px' }, h('a', { href: '#/upload' }, '＋ 新建作品')),
  );
}

function formShell(title, sub, fields, onSubmit, okText = '提交') {
  const err = h('div', { class: 'err' });
  const submit = h('button', { class: 'primary' }, okText);
  const form = h('div', { class: 'panel' }, h('h1', {}, title), h('p', { class: 'sub' }, sub), ...fields, err,
    h('div', { class: 'row', style: 'margin-top:6px' }, submit));
  submit.addEventListener('click', async () => {
    err.textContent = '';
    try { await onSubmit(); } catch (e) { err.textContent = msg(e); return; }
  });
  return { form, submit, err };
}

async function viewUpload() {
  renderNav('#/upload');
  const name = h('input', { type: 'text', maxlength: '80' });
  const author = h('input', { type: 'text', maxlength: '60', value: me.display_name });
  const desc = h('textarea', { maxlength: '2000', placeholder: '简介（可选）' });
  const cover = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp' });
  const { form, submit } = formShell('新建作品', '先建作品外壳，随后再逐话上传图片。', [
    h('div', { class: 'field' }, h('label', {}, '作品名'), name),
    h('div', { class: 'field' }, h('label', {}, '作者'), author),
    h('div', { class: 'field' }, h('label', {}, '简介'), desc),
    h('div', { class: 'field' }, h('label', {}, '封面图（可选）'), cover, h('div', { class: 'filehint' }, 'png / jpg / gif / webp，单张不超过 8MB')),
    h('div', { class: 'notice' }, '请确认你对上传内容拥有版权或已获得授权。侵权作品会被举报并下架。'),
  ], async () => {
    const fd = new FormData();
    fd.set('name', name.value.trim());
    fd.set('author', author.value.trim());
    fd.set('description', desc.value.trim());
    if (cover.files[0]) fd.set('cover', cover.files[0]);
    submit.disabled = true;
    const data = await api('/api/comics', { method: 'POST', body: fd });
    toast('作品已创建');
    go(`#/comic/${data.comic.id}`);
  }, '创建作品');
  app.replaceChildren(form);
}

async function viewEditComic(comicId) {
  renderNav('#/my');
  const comic = (await api(`/api/comics/${comicId}`)).comic;
  const name = h('input', { type: 'text', maxlength: '80', value: comic.name });
  const author = h('input', { type: 'text', maxlength: '60', value: comic.author });
  const desc = h('textarea', { maxlength: '2000' }, comic.description);
  const cover = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp' });
  const removeCover = h('input', { type: 'checkbox' });
  const { form } = formShell('编辑作品', `《${comic.name}》`, [
    h('div', { class: 'field' }, h('label', {}, '作品名'), name),
    h('div', { class: 'field' }, h('label', {}, '作者'), author),
    h('div', { class: 'field' }, h('label', {}, '简介'), desc),
    h('div', { class: 'field' }, h('label', {}, '替换封面'), cover,
      h('label', { style: 'display:flex;gap:8px;align-items:center;margin-top:8px' }, removeCover, h('span', {}, '移除现有封面'))),
  ], async () => {
    const fd = new FormData();
    fd.set('name', name.value.trim());
    fd.set('author', author.value.trim());
    fd.set('description', desc.value.trim());
    if (cover.files[0]) fd.set('cover', cover.files[0]);
    if (removeCover.checked) fd.set('removeCover', '1');
    await api(`/api/comics/${comicId}`, { method: 'PATCH', body: fd });
    toast('已保存');
    go(`#/comic/${comicId}`);
  }, '保存修改');
  app.replaceChildren(form);
}

async function viewChapterUpload(comicId) {
  renderNav('#/upload');
  const detail = await api(`/api/comics/${comicId}`);
  const title = h('input', { type: 'text', maxlength: '80', placeholder: '如：第 1 话' });
  const no = h('input', { type: 'number', min: '0.1', step: '0.1', value: String(detail.chapters.length + 1) });
  const files = h('input', { type: 'file', multiple: '', accept: 'image/png,image/jpeg,image/gif,image/webp' });
  const chips = h('div', { class: 'chips' });
  files.addEventListener('change', () => {
    const picked = [...files.files].sort((a, b) => a.name.localeCompare(b.name, 'zh', { numeric: true }));
    chips.replaceChildren(...picked.map((f, i) => h('span', { class: 'chip' }, `${i + 1}. ${f.name}`)));
  });
  const { form, submit } = formShell('上传新章节', `《${detail.comic.name}》 · 页序按文件名自然排序`, [
    h('div', { class: 'field' }, h('label', {}, '章节标题'), title),
    h('div', { class: 'field', style: 'max-width:180px' }, h('label', {}, '话数'), no),
    h('div', { class: 'field' }, h('label', {}, '页面图片'), files, chips,
      h('div', { class: 'filehint' }, '选择后按文件名排序，最多 40 张 / 单次 64MB')),
  ], async () => {
    const fd = new FormData();
    fd.set('title', title.value.trim());
    fd.set('chapter_no', no.value);
    [...files.files].sort((a, b) => a.name.localeCompare(b.name, 'zh', { numeric: true })).forEach((f) => fd.append('pages', f));
    submit.disabled = true;
    await api(`/api/comics/${comicId}/chapters`, { method: 'POST', body: fd });
    toast('章节已上传');
    go(`#/comic/${comicId}`);
  }, '上传章节');
  app.replaceChildren(form);
}

async function viewComic(comicId) {
  renderNav('');
  const { comic, chapters, canEdit } = await api(`/api/comics/${comicId}`);
  const chapterList = h('div', { class: 'list' });
  for (const ch of chapters) {
    chapterList.append(h('div', { class: 'list-item' },
      h('div', {},
        h('a', { href: `#/reader/${ch.id}`, style: 'font-weight:600' }, `第 ${ch.chapter_no} 话 · ${ch.title}`),
        h('div', { class: 'meta' }, '上传于 ' + new Date(ch.created_at).toLocaleString()),
      ),
      canEdit
        ? h('div', { class: 'actions' },
            h('button', { class: 'small', onclick: async () => {
              const t = prompt('章节标题', ch.title); if (t === null) return;
              const n = prompt('话数', ch.chapter_no); if (n === null) return;
              try { await api(`/api/chapters/${ch.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: t, chapter_no: Number(n) }) }); toast('已保存'); viewComic(comicId); } catch (e) { toast(msg(e), true); }
            } }, '编辑'),
            h('button', { class: 'small danger', onclick: async () => {
              if (!confirm('删除该章节及其图片？')) return;
              try { await api(`/api/chapters/${ch.id}`, { method: 'DELETE' }); toast('已删除'); viewComic(comicId); } catch (e) { toast(msg(e), true); }
            } }, '删除'))
        : null,
    ));
  }
  const reportBtn = h('button', { class: 'small' }, '举报侵权');
  reportBtn.addEventListener('click', async () => {
    const reason = prompt('举报类型：copyright(版权) / unauthorized_upload(未经授权使用) / porn / other', 'copyright');
    if (reason === null) return;
    const note = prompt('补充说明（可选）', '') || '';
    try { await api(`/api/comics/${comicId}/report`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason, note }) }); toast('举报已提交，等待管理员处理'); } catch (e) { toast(msg(e), true); }
  });

  const kids = [
    h('h1', {}, comic.name, comic.status !== 'published' ? h('span', { class: 'pill takedown', style: 'margin-left:10px' }, '已下架') : null),
    h('p', { class: 'sub' }, `${comic.author} · ${chapters.length} 话 · 作者 ${comic.owner_name}`),
  ];
  if (comic.description) kids.push(h('div', { class: 'panel' }, comic.description));
  kids.push(
    h('div', { class: 'row', style: 'margin-bottom:16px' },
      canEdit ? h('button', { onclick: () => go(`#/chapter/${comicId}`) }, '＋ 上传章节') : null,
      canEdit ? h('button', { onclick: () => go(`#/edit/${comicId}`) }, '编辑作品') : null,
      h('div', { class: 'grow', style: 'flex:1' }),
      reportBtn,
    ),
    chapters.length ? chapterList : h('div', { class: 'empty' }, '还没有章节。'),
  );
  if (comic.status !== 'published' && comic.takedown_reason) {
    kids.push(h('div', { class: 'notice' }, `下架理由：${comic.takedown_reason}`));
  }
  app.replaceChildren(...kids);
}

/* ---------------- reader ---------------- */

const bulletLanes = 8;
let readerState = null;

function makeWatermark(container, label) {
  container.className = 'wm';
  container.replaceChildren();
  const stamp = new Date().toLocaleString('zh-CN', { hour12: false });
  for (let i = 0; i < 18; i += 1) {
    container.append(h('span', {
      style: `position:absolute;left:${(i % 6) * 18 - 8}%;top:${Math.floor(i / 6) * 32 - 6}%;transform:rotate(-28deg);font-size:13px;white-space:nowrap;color:#fff;letter-spacing:1px`,
      text: `${label} · ${stamp}`,
    }));
  }
}

function spawnBullet(layer, item) {
  const el = h('span', { class: 'bullet', text: item.content });
  el.style.color = item.color || '#fff';
  el.style.top = `${Math.floor(Math.random() * bulletLanes) * 11 + 3}%`;
  el.style.right = '-100%';
  layer.append(el);
  const width = layer.clientWidth || 800;
  const duration = 6000 + Math.random() * 2500;
  const anim = el.animate(
    [{ transform: 'translateX(0)' }, { transform: `translateX(${width + el.offsetWidth + 40}px)` }],
    { duration, easing: 'linear', fill: 'forwards' },
  );
  anim.onfinish = () => el.remove();
  setTimeout(() => el.remove(), duration + 800);
}

function readerTick() {
  const s = readerState;
  const clockEl = document.getElementById('clock');
  if (!s || !clockEl) return;
  if (s.paused) return;
  s.clock += 100;
  const layer = document.getElementById('bullets');
  if (s.danmakuOn && layer) {
    while (s.next < s.queue.length && s.queue[s.next].time_ms <= s.clock) spawnBullet(layer, s.queue[s.next++]);
  }
  clockEl.textContent = `${(s.clock / 1000).toFixed(1)}s / ${PAGE_WINDOW_MS / 1000}s`;
  if (s.clock >= PAGE_WINDOW_MS) {
    if (s.index < s.pages.length - 1) readerGoto(s.index + 1);
    else { s.paused = true; toast('本章播放结束'); }
  }
}

function readerGoto(index) {
  const s = readerState;
  s.index = Math.max(0, Math.min(s.pages.length - 1, index));
  s.clock = 0;
  s.queue = s.danmaku.filter((d) => d.page_index === s.index).sort((a, b) => a.time_ms - b.time_ms);
  s.next = 0;
  const layer = document.getElementById('bullets');
  if (layer) layer.replaceChildren();
  const img = document.getElementById('page-img');
  img.src = `/i/${s.pages[s.index].image_id}`;
  document.getElementById('counter').textContent = `${s.index + 1} / ${s.pages.length}`;
  document.getElementById('slider').value = s.index;
  const pos = document.getElementById('danmaku-pos');
  if (pos) pos.textContent = `当前第 ${s.index + 1} 页 · `;
}

async function viewReader(chapterId) {
  renderNav('');
  app.replaceChildren(h('div', { class: 'empty' }, '加载中…'));
  let data;
  try {
    data = await api(`/api/reader/${chapterId}`);
  } catch (e) {
    app.replaceChildren(h('div', { class: 'empty' }, msg(e), h('div', {}, h('a', { href: '#/' }, '返回漫画墙'))));
    return;
  }
  if (!data.pages.length) {
    app.replaceChildren(h('div', { class: 'empty' }, '这一话还没有页面。'));
    return;
  }

  readerState = {
    chapterId, pages: data.pages, danmaku: data.danmaku, index: 0, clock: 0, queue: [], next: 0,
    paused: false, danmakuOn: true,
  };

  const img = h('img', { class: 'page', id: 'page-img', alt: '漫画页面', draggable: 'false' });
  const bullets = h('div', { class: 'bullets', id: 'bullets' });
  const wm = h('div', { id: 'wm' });
  makeWatermark(wm, data.watermark);
  const stage = h('div', { class: 'stage', oncontextmenu: (e) => e.preventDefault(), ondragstart: (e) => e.preventDefault() }, img, bullets, wm);

  const content = h('input', { type: 'text', maxlength: '60', placeholder: '发一条弹幕，回车发送' });
  const color = h('input', { type: 'color', value: '#ffe66d' });
  const pos = h('span', { id: 'danmaku-pos' });
  const send = h('button', { class: 'primary' }, '发送');
  const sendDm = async () => {
    if (!content.value.trim()) return toast('弹幕内容不能为空', true);
    try {
      const created = await api(`/api/reader/${chapterId}/danmaku`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: content.value.trim(), color: color.value, page_index: readerState.index, time_ms: readerState.clock }),
      });
      spawnBullet(bullets, created.danmaku);
      readerState.danmaku.push(created.danmaku);
      if (created.danmaku.time_ms >= readerState.clock && created.danmaku.page_index === readerState.index) {
        const at = readerState.queue.findIndex((d) => d.time_ms > created.danmaku.time_ms);
        at < 0 ? readerState.queue.push(created.danmaku) : readerState.queue.splice(at, 0, created.danmaku);
      }
      content.value = '';
    } catch (e) { toast(msg(e), true); }
  };
  send.addEventListener('click', sendDm);
  content.addEventListener('keydown', (e) => e.key === 'Enter' && sendDm());

  const counter = h('span', { class: 'counter', id: 'counter' });
  const slider = h('input', { class: 'slider', type: 'range', min: '0', max: String(data.pages.length - 1), step: '1', id: 'slider', input: (e) => readerGoto(Number(e.target.value)) });
  const clock = h('span', { class: 'counter', id: 'clock' });
  const play = h('button', { class: 'small' }, '暂停');
  play.addEventListener('click', () => { readerState.paused = !readerState.paused; play.textContent = readerState.paused ? '播放' : '暂停'; });
  const toggleDm = h('button', { class: 'small' }, '关闭弹幕');
  toggleDm.addEventListener('click', () => {
    readerState.danmakuOn = !readerState.danmakuOn;
    bullets.classList.toggle('off', !readerState.danmakuOn);
    toggleDm.textContent = readerState.danmakuOn ? '关闭弹幕' : '开启弹幕';
  });

  const chapterPick = h('select', { onchange: (e) => location.hash = `#/reader/${e.target.value}` });

  app.replaceChildren(
    h('div', { class: 'reader' },
      h('div', { class: 'reader-bar' },
        h('a', { href: `#/comic/${data.chapter.comic_id}` }, '← 作品页'),
        h('strong', {}, `${data.chapter.comic_name} · 第 ${data.chapter.chapter_no} 话`),
        h('span', { class: 'grow' }),
        clock, play, toggleDm, chapterPick,
      ),
      stage,
      h('div', { class: 'page-nav' },
        h('button', { class: 'small', onclick: () => readerGoto(readerState.index - 1) }, '上一页'),
        slider, counter,
        h('button', { class: 'small', onclick: () => readerGoto(readerState.index + 1) }, '下一页'),
      ),
      h('div', { class: 'danmaku-bar' }, pos, content, color, send),
      h('p', { class: 'filehint' }, '画面上的水印记录的是你的账号身份，用于截图外传时溯源。请勿转发未授权内容。'),
    ),
  );

  const detail = await api(`/api/comics/${data.chapter.comic_id}`);
  chapterPick.replaceChildren(...detail.chapters.map((c) => h('option', { value: c.id, selected: c.id === Number(chapterId) }, `第 ${c.chapter_no} 话 · ${c.title}`)));

  readerGoto(0);
  clearInterval(readerState.timer);
  readerState.timer = setInterval(readerTick, 100);
}

/* ---------------- admin ---------------- */

async function viewAdmin() {
  renderNav('#/admin');
  app.replaceChildren(h('div', { class: 'empty' }, '加载中…'));
  const { reports } = await api('/api/admin/reports');
  const rows = h('tbody');
  for (const r of reports) {
    rows.append(h('tr', {},
      h('td', {}, new Date(r.created_at).toLocaleString()),
      h('td', {}, h('a', { href: `#/comic/${r.comic_id}` }, r.comic_name)),
      h('td', {}, r.reporter || '已注销用户'),
      h('td', {}, r.reason),
      h('td', {}, h('span', { class: `pill ${r.status === 'pending' ? 'takedown' : 'published'}` }, r.status === 'pending' ? '待处理' : '已处理'), r.handled_note ? h('div', { class: 'meta' }, r.handled_note) : null),
      h('td', {}, h('div', { class: 'actions' },
        h('button', { class: 'small danger', onclick: () => setStatus(r.comic_id, 'takedown', r) }, '下架'),
        h('button', { class: 'small', onclick: () => setStatus(r.comic_id, 'published', r) }, '上架'),
      )),
    ));
  }
  const act = async (comicId, status, note) => {
    try { await api(`/api/admin/comics/${comicId}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status, note }) }); toast(status === 'takedown' ? '已下架' : '已上架'); viewAdmin(); } catch (e) { toast(msg(e), true); }
  };
  const setStatus = (comicId, status, r) => {
    const note = prompt(status === 'takedown' ? '下架理由（会显示给管理员记录）' : '恢复说明', r.handled_note || '');
    if (note !== null) act(comicId, status, note);
  };
  app.replaceChildren(
    h('h1', {}, '版权审核'),
    h('p', { class: 'sub' }, '处理侵权与违规举报。下架后其他读者无法再访问该作品与图片。'),
    reports.length
      ? h('div', { class: 'panel', style: 'padding:0' }, h('table', {}, h('thead', {}, h('tr', {}, ['时间', '作品', '举报人', '理由', '状态', '操作'].map((t) => h('th', {}, t)))), rows))
      : h('div', { class: 'empty' }, '没有举报。'),
  );
}

/* ---------------- router ---------------- */

const ROUTES = [
  [/^#\/$/, () => viewLibrary()],
  [/^#\/\?/, () => viewLibrary()],
  [/^#\/auth$/, () => app.replaceChildren(viewAuth())],
  [/^#\/my$/, () => viewMy()],
  [/^#\/upload$/, () => viewUpload()],
  [/^#\/admin$/, () => viewAdmin()],
  [/^#\/comic\/(\d+)$/, (m) => viewComic(m[1])],
  [/^#\/edit\/(\d+)$/, (m) => viewEditComic(m[1])],
  [/^#\/chapter\/(\d+)$/, (m) => viewChapterUpload(m[1])],
  [/^#\/reader\/(\d+)$/, (m) => viewReader(m[1])],
];

async function boot() {
  const data = await api('/api/me');
  me = data.user;
  if (me && ['#/auth'].includes(location.hash || '#/')) go('#/');
  route();
}

function route() {
  if (readerState && !/^#\/reader\//.test(location.hash || '')) {
    clearInterval(readerState.timer);
    readerState = null;
  }
  const hash = location.hash || '#/';
  if (!me && hash !== '#/auth' && hash !== '#/') return go('#/auth');
  for (const [re, fn] of ROUTES) {
    const m = re.exec(hash);
    if (m) return fn(m).catch((e) => { app.replaceChildren(h('div', { class: 'empty' }, msg(e))); });
  }
  app.replaceChildren(h('div', { class: 'empty' }, '页面不存在'));
}

searchEl.addEventListener('input', () => {
  if (!me) return;
  const q = searchEl.value.trim();
  location.hash = q ? `#/?q=${encodeURIComponent(q)}` : '#/';
});

window.addEventListener('hashchange', route);
boot();
