'use strict';
// Spins up the real server, plays a full match with two bots + a spectator over the SSE stream.
const { spawn } = require('node:child_process');
const assert = require('node:assert');
const PORT = 3900 + Math.floor(Math.random() * 50);
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testpass';

let fake = null;
const extra = {};
if (process.env.E2E_REDIS) {
  fake = require('./fake-upstash').start(PORT + 100);
  Object.assign(extra, { UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${PORT + 100}`, UPSTASH_REDIS_REST_TOKEN: 'tok', POLL_MS: '150' });
}
const srv = spawn('node', ['server/main.js'], { env: { ...process.env, ...extra, PORT, SITE_PASSWORD: PW, NODE_ENV: 'production' }, stdio: 'inherit' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (path, body, token) => {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, ...(await r.json()) };
};

class Client {
  constructor(name) { this.name = name; this.view = null; }
  async login() {
    const r = await post('/api/login', { name: this.name, password: PW });
    assert.strictEqual(r.status, 200, 'login ' + this.name);
    this.token = r.token;
    await this.act('join');
    this.listen();
  }
  async act(type, extra = {}) {
    const r = await post('/api/act', { room: 'e2e', type, seq: this.view?.seq, ...extra }, this.token);
    if (r.view) this.view = r.view;
    return r;
  }
  async listen() {
    const r = await fetch(`${BASE}/api/stream?room=e2e`, { headers: { Authorization: 'Bearer ' + this.token } });
    const dec = new TextDecoder(); let buf = '';
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const part = buf.slice(0, i); buf = buf.slice(i + 2);
        if (part.startsWith('data: ')) { const v = JSON.parse(part.slice(6)); if (!this.view || v.v >= this.view.v) this.view = v; this.onview?.(v); }
      }
    }
  }
}

(async () => {
  await sleep(500);
  // auth
  assert.strictEqual((await post('/api/login', { name: 'Eve', password: 'nope' })).status, 401);
  assert.strictEqual((await post('/api/login', { name: '!', password: PW })).status, 400);
  assert.strictEqual((await post('/api/act', { room: 'e2e', type: 'join' }, 'garbage')).status, 401);
  const hz = await (await fetch(BASE + '/healthz')).json(); assert.ok(hz.ok);
  const html = await (await fetch(BASE + '/')).text(); assert.ok(html.includes('<title>'));
  assert.strictEqual((await fetch(BASE + '/../../etc/passwd')).status, 404);

  const [a, b, s] = [new Client('Alice'), new Client('Bob'), new Client('Spec')];
  for (const c of [a, b, s]) await c.login();
  await a.act('sit', { seat: 0 }); await b.act('sit', { seat: 1 });
  const bad = await s.act('sit', { seat: 0 }); assert.strictEqual(bad.status, 400, JSON.stringify(bad));
  await a.act('settings', { settings: { startingBalance: 300, minBet: 20, maxBet: 100, maxRounds: 5, betTime: 15, actionTime: 15 } });
  await a.act('ready', { value: true }); await b.act('ready', { value: true });
  await s.act('chat', { text: 'let it ride <script>' });
  await sleep(300);
  assert.strictEqual(s.view.phase, 'betting', 'spectator sees match start via stream');

  // bots play via stream pushes
  const t0 = Date.now(); let rounds = 0;
  const drive = (c) => async () => {
    const v = c.view; const me = v.you.seat;
    if (v.phase === 'betting' && v.seats[me].bet == null) c.act('bet', { amount: Math.min(v.settings.maxBet, v.seats[me].balance, 50) });
    else if (v.phase === 'playing' && v.turn?.seat === me) {
      const h = v.hands[me][v.turn.hand]; const tot = h.cards.reduce((x, y) => x + (/^[AKQJ1]/.test(y) ? 10 : parseInt(y)), 0);
      c.act(tot < 15 && v.legal ? 'hit' : 'stand_hand');
    } else if (v.phase === 'settled') c.act('next');
  };
  const da = drive(a), db = drive(b);
  a.onview = da; b.onview = db;
  while (a.view.phase !== 'over' && Date.now() - t0 < 60000) await sleep(100);
  assert.strictEqual(a.view.phase, 'over', 'match finished');
  await sleep(200);
  assert.deepStrictEqual(s.view.over, a.view.over);
  assert.ok(a.view.round <= 5 && s.view.history.length === a.view.round);
  assert.ok(s.view.chat.some((m) => m.x === 'let it ride <script>'));
  console.log(`e2e ok: ${a.view.round} rounds in ${((Date.now() - t0) / 1000).toFixed(1)}s, winner seat ${a.view.over.winner}, balances`, a.view.seats.map((x) => x.balance));
  srv.kill(); fake && fake.close(); process.exit(0);
})().catch((e) => { console.error('E2E FAIL', e); srv.kill(); fake && fake.close(); process.exit(1); });
