const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { dispatch } = require('./routes');
const cfg = require('./config');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const CSP = [
  "default-src 'self'",
  "img-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

function securityHeaders(isHtml) {
  const headers = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
  };
  if (isHtml) headers['content-security-policy'] = CSP;
  return headers;
}

function send404(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('not found');
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.resolve(cfg.WEB_DIR, rel);
  if (target !== cfg.WEB_DIR && !target.startsWith(cfg.WEB_DIR + path.sep)) return send404(res);
  let file = target;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(cfg.WEB_DIR, 'index.html'); // SPA fallback
  }
  const ext = path.extname(file);
  if (!MIME[ext]) return send404(res);
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'content-type': MIME[ext],
    'content-length': body.length,
    'cache-control': 'no-cache',
    ...securityHeaders(ext === '.html'),
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return send404(res);
  }
  const pathname = url.pathname;
  res.on('error', () => res.destroy());

  if (pathname.startsWith('/api/') || pathname.startsWith('/i/')) {
    const match = dispatch(req.method, pathname);
    if (!match) return res.writeHead(404, { 'content-type': 'application/json' }).end('{"ok":false,"error":"NO_ROUTE"}');
    Promise.resolve(match.handler(req, res, match.params, url.searchParams, url)).catch((error) => {
      const status = error && error.status ? error.status : 500;
      if (status >= 500) console.error(error);
      if (!res.headersSent) {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      }
      res.end(JSON.stringify({ ok: false, error: status >= 500 ? 'SERVER_ERROR' : error.message }));
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send404(res);
  try {
    serveStatic(req, res, pathname);
  } catch (error) {
    console.error(error);
    send404(res);
  }
});

server.listen(cfg.PORT, () => {
  console.log(`漫画站已启动: http://localhost:${cfg.PORT}`);
});
