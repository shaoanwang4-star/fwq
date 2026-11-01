const { png, swatch } = require('./png');

const BASE = process.env.BASE || 'http://localhost:3000';
const jar = {};

async function api(path, opts = {}, who = 'author') {
  const headers = { ...(opts.headers || {}) };
  if (jar[who]) headers.cookie = `sid=${jar[who]}`;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && /sid=([^;]+)/.test(setCookie)) jar[who] = /sid=([^;]+)/.exec(setCookie)[1];
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(`${path} -> ${data.error}`);
  return data;
}

function file(buffer, name) {
  return new File([buffer], name, { type: 'image/png' });
}

(async () => {
  const stamp = Date.now();
  await api('/api/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `author_${stamp}@example.com`, password: 'authorpass1', displayName: '拾光漫画社' }),
  });
  await api('/api/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `reader_${stamp}@example.com`, password: 'readerpass1', displayName: '夜读人' }),
  }, 'reader');

  const cover = png(600, 800, swatch(1));
  const form = new FormData();
  form.set('name', '巷子里的灯塔');
  form.set('author', '拾光漫画社');
  form.set('description', '原创示例作品：一盏照不到海的灯塔，和每天给它送电的快递员。页面为程序生成的色块占位图，可整章替换成你自己的漫画。');
  form.set('cover', file(cover, 'cover.png'));
  const { comic } = await api('/api/comics', { method: 'POST', body: form });

  for (const [no, title] of [[1, '断电的灯塔'], [2, '会发光的信']]) {
    const cf = new FormData();
    cf.set('title', title);
    cf.set('chapter_no', String(no));
    for (let p = 1; p <= 5; p += 1) cf.append('pages', file(png(760, 1080, swatch(no * 3 + p)), `${no}-${String(p).padStart(2, '0')}.png`));
    const { chapter } = await api(`/api/comics/${comic.id}/chapters`, { method: 'POST', body: cf });
    const lines = ['这个色块过渡很干净', '灯塔出场那一页我喜欢', '作者加油，追更', '第 3 页构图好评'];
    for (const [i, text] of lines.entries()) {
      await api(`/api/reader/${chapter.id}/danmaku`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: text, color: i % 2 ? '#ffe66d' : '#ffffff', page_index: i, time_ms: 900 * (i + 1) }),
      }, 'reader');
    }
    console.log(`已生成 ${title}（5 页，4 条弹幕）`);
  }
  console.log(`种子作品 id=${comic.id}；作者 ${`author_${stamp}@example.com`} / authorpass1；读者 ${`reader_${stamp}@example.com`} / readerpass1`);
})().catch((e) => { console.error(e); process.exit(1); });
