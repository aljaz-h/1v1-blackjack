'use strict';
// Standalone server for Docker / Coolify / local. Zero dependencies.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

if (!process.env.SITE_PASSWORD && process.env.NODE_ENV !== 'production') {
  process.env.SITE_PASSWORD = 'degen';
  console.warn('[dev] SITE_PASSWORD not set, using "degen". Set SITE_PASSWORD in production!');
}
const h = require('../lib/handlers');

const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
};

const cache = new Map();
function load(file) {
  const st = fs.statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtime === st.mtimeMs) return hit;
  const raw = fs.readFileSync(file);
  const ext = path.extname(file);
  const entry = {
    mtime: st.mtimeMs,
    raw,
    gz: ['.html', '.js', '.css', '.svg', '.json'].includes(ext) ? zlib.gzipSync(raw, { level: 9 }) : null,
    type: TYPES[ext] || 'application/octet-stream',
    etag: `"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"`,
  };
  cache.set(file, entry);
  return entry;
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  const e = load(file);
  const headers = { ...SECURITY, 'Content-Type': e.type, ETag: e.etag, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' };
  if (req.headers['if-none-match'] === e.etag) { res.writeHead(304, headers); return res.end(); }
  if (e.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': e.gz.length });
    return res.end(req.method === 'HEAD' ? undefined : e.gz);
  }
  res.writeHead(200, { ...headers, 'Content-Length': e.raw.length });
  res.end(req.method === 'HEAD' ? undefined : e.raw);
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  try {
    if (pathname === '/healthz') return res.writeHead(200, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(h.health()));
    if (pathname === '/api/login') return h.login(req, res);
    if (pathname === '/api/act') return h.act(req, res);
    if (pathname === '/api/state') return h.state(req, res);
    if (pathname === '/api/stream') return h.stream(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    serveStatic(req, res, pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
server.keepAliveTimeout = 65_000;
server.listen(PORT, '0.0.0.0', () => console.log(`Degen 21 listening on :${PORT} (store: ${h.store.kind})`));

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { server.close(); setTimeout(() => process.exit(0), 300).unref(); });
