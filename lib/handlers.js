'use strict';
const engine = require('./engine');
const auth = require('./auth');
const { createStore, MAX_ROOMS } = require('./store');

const { ApiError } = engine;
const store = createStore();
const ON_VERCEL = !!process.env.VERCEL;
const POLL_MS = Number(process.env.POLL_MS) || 700;
const STREAM_MAX_MS = Number(process.env.STREAM_MAX_MS) || (ON_VERCEL ? 270_000 : 0);

/* ---------- helpers ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function fail(res, e) {
  if (e instanceof ApiError) return send(res, e.status, { error: e.code, message: e.message });
  console.error(e);
  send(res, 500, { error: 'server_error', message: 'Server error' });
}
async function readJson(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
    if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString() || '{}');
    return req.body;
  }
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw new ApiError('too_large', 'Body too large', 413);
    chunks.push(c);
  }
  const s = Buffer.concat(chunks).toString();
  return s ? JSON.parse(s) : {};
}
function query(req) {
  return new URL(req.url, 'http://x').searchParams;
}
function cleanRoom(r) {
  r = String(r || 'main').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20);
  return r || 'main';
}
function authed(req) {
  const h = req.headers.authorization || '';
  const user = auth.verifyToken(h.startsWith('Bearer ') ? h.slice(7) : '');
  if (!user) throw new ApiError('unauthorized', 'Please sign in again', 401);
  return user;
}
function preflight() {
  if (!auth.sitePassword()) throw new ApiError('not_configured', 'Server is missing the SITE_PASSWORD environment variable', 503);
  if (ON_VERCEL && store.kind === 'memory')
    throw new ApiError('no_store', 'On Vercel you must connect Upstash Redis (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)', 503);
}

/* ---------- read-modify-write with optimistic concurrency ---------- */
async function mutate(room, fn, { force = false } = {}) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const now = Date.now();
    const rec = await store.get(room);
    // rooms saved by an older version (no game mode) are reset instead of migrated
    const st = rec && rec.state.settings && rec.state.settings.mode ? rec.state : engine.newRoom(room, now);
    const sv = rec ? rec.sv : 0;
    const v0 = st.v;
    engine.tick(st, now);
    const out = fn ? fn(st, now) : undefined;
    if (!force && st.v === v0) return { state: st, out, now };
    const ok = await store.cas(room, sv, st);
    if (ok === 'full') throw new ApiError('rooms_full', `All ${MAX_ROOMS} rooms are in use. Join an existing room, or wait for an inactive one to close (rooms close after an hour of inactivity).`, 409);
    if (ok) return { state: st, out, now };
    await sleep(5 + Math.random() * 25);
  }
  throw new ApiError('busy', 'Table is busy, try again', 503);
}

/* ---------- login (with simple brute-force throttle) ---------- */
const attempts = new Map();
function throttle(ip) {
  const now = Date.now();
  const a = attempts.get(ip) || { n: 0, t: now };
  if (now - a.t > 5 * 60_000) { a.n = 0; a.t = now; }
  attempts.set(ip, a);
  if (attempts.size > 5000) attempts.clear();
  return a;
}
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();

async function login(req, res) {
  try {
    if (req.method !== 'POST') throw new ApiError('method', 'POST only', 405);
    preflight();
    const body = await readJson(req);
    const a = throttle(clientIp(req));
    if (a.n >= 8) throw new ApiError('rate_limited', 'Too many attempts. Wait a few minutes.', 429);
    if (body.check) { // step 1 of the login form: verify the master password only
      if (!auth.checkPassword(body.password)) { a.n++; throw new ApiError('bad_password', 'Wrong password', 401); }
      a.n = 0;
      return send(res, 200, { ok: true });
    }
    const name = engine.cleanName(body.name);
    if (!name) throw new ApiError('bad_name', 'Name must be 2–16 characters (letters, numbers, space . _ -)');
    if (!auth.checkPassword(body.password)) {
      a.n++;
      throw new ApiError('bad_password', 'Wrong password', 401);
    }
    a.n = 0;
    const id = /^[A-Za-z0-9_-]{8,24}$/.test(body.id || '') ? body.id : auth.newId();
    const user = { id, name };
    send(res, 200, { token: auth.issueToken(user), id, name });
  } catch (e) { fail(res, e); }
}

/* ---------- act / state ---------- */
async function act(req, res) {
  try {
    if (req.method !== 'POST') throw new ApiError('method', 'POST only', 405);
    preflight();
    const user = authed(req);
    const body = await readJson(req);
    const room = cleanRoom(body.room);
    const { state, now } = await mutate(room, (st, n) => engine.applyAction(st, user, body, n), { force: true });
    send(res, 200, { ok: true, view: engine.buildView(state, user.id, now) });
  } catch (e) { fail(res, e); }
}

async function state(req, res) {
  try {
    preflight();
    const user = authed(req);
    const room = cleanRoom(query(req).get('room'));
    const { state: st, now } = await mutate(room, null);
    send(res, 200, { view: engine.buildView(st, user.id, now) });
  } catch (e) { fail(res, e); }
}

/* ---------- live stream (SSE) ---------- */
async function stream(req, res) {
  let user, room;
  try {
    preflight();
    user = authed(req);
    room = cleanRoom(query(req).get('room'));
  } catch (e) { return fail(res, e); }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 1000\n\n');

  let closed = false;
  let wake = null;
  const waitFor = (ms) =>
    new Promise((resolve) => {
      const t = setTimeout(done, ms);
      function done() { clearTimeout(t); wake = null; resolve(); }
      wake = done;
    });
  const unsub = store.subscribe ? store.subscribe(room, () => wake && wake()) : null;
  req.on('close', () => { closed = true; unsub && unsub(); wake && wake(); });

  const started = Date.now();
  let lastV = -1, lastSig = '', lastFull = 0, lastWrite = Date.now(), errors = 0, phase = 'lobby';

  while (!closed && (!STREAM_MAX_MS || Date.now() - started < STREAM_MAX_MS)) {
    let interval = store.kind === 'memory' ? 1000 : phase === 'lobby' || phase === 'over' ? POLL_MS * 2 : POLL_MS;
    try {
      const pk = await store.peek(room);
      const now = Date.now();
      const due = pk && pk.t && now >= pk.t;
      if (!pk ? lastV === -1 : pk.v !== lastV || due || now - lastFull > 8000) {
        const { state: st, now: n2 } = await mutate(room, null);
        lastV = st.v; lastFull = n2; phase = st.phase;
        const sig = st.v + '|' + engine.onlineSig(st, n2);
        if (sig !== lastSig) {
          lastSig = sig;
          res.write('data: ' + JSON.stringify(engine.buildView(st, user.id, n2)) + '\n\n');
          lastWrite = Date.now();
        }
        if (st.timerAt) interval = Math.min(interval, Math.max(20, st.timerAt - Date.now() + 8));
      } else if (pk && pk.t) interval = Math.min(interval, Math.max(20, pk.t - now + 8));
      if (Date.now() - lastWrite > 12_000) { res.write(': ping\n\n'); lastWrite = Date.now(); }
      errors = 0;
    } catch (e) {
      if (++errors > 5) break;
      interval = 1000;
    }
    if (!closed) await waitFor(interval);
  }
  unsub && unsub();
  if (!closed) res.end();
}

module.exports = { login, act, state, stream, store, health: () => ({ ok: true, store: store.kind }) };
