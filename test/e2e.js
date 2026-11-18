'use strict';
// Spins up the real server, plays a full match with two bots + a spectator over the SSE stream.
const { spawn } = require('node:child_process');
const assert = require('node:assert');
const PORT = 3900 + Math.floor(Math.random() * 50);
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testpass';

let fake = null;
const extra = { MAX_ROOMS: '11' };
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
  assert.strictEqual((await b.act('sit', { seat: 1 })).status, 400, 'table not open yet');
  assert.strictEqual((await b.act('settings', { settings: { minBet: 5 } })).status, 403, 'only the host edits settings');
  assert.strictEqual((await a.act('open')).status, 200);
  assert.strictEqual(a.view.you.host, true);
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
    } else if (v.phase === 'playing' && v.insYou && !v.insYou.done) c.act('insure', v.insYou.even ? { take: true } : { amount: v.insYou.max });
    else if (v.phase === 'settled') c.act('next');
  };
  const da = drive(a), db = drive(b);
  a.onview = da; b.onview = db;
  while (a.view.phase !== 'over' && Date.now() - t0 < 60000) await sleep(100);
  assert.strictEqual(a.view.phase, 'over', 'match finished');
  await sleep(200);
  assert.deepStrictEqual(s.view.over, a.view.over);
  assert.ok(a.view.round <= 5 && s.view.history.length === a.view.round);
  assert.ok(s.view.chat.some((m) => m.x === 'let it ride <script>'));
  console.log(`e2e ok: ${a.view.round} rounds in ${((Date.now() - t0) / 1000).toFixed(1)}s, winner seat ${a.view.over.winner}, balances`, a.view.seats.filter(Boolean).map((x) => x.balance));

  /* ---- second match: three bots in a Blitz tournament, same room ---- */
  a.onview = b.onview = null;
  await a.act('lobby');
  const c = new Client('Cara'); await c.login();
  assert.strictEqual((await c.act('sit', { seat: 2 })).status, 400, 'duel has no third seat');
  const sr = await a.act('settings', { settings: { mode: 'tournament', blitz: true, startingBalance: 300, minBet: 20, maxBet: 100, maxRounds: 5, blindEvery: 3 } });
  assert.strictEqual(sr.status, 200, JSON.stringify(sr));
  assert.strictEqual((await c.act('sit', { seat: 2 })).status, 200);
  await sleep(400);
  assert.strictEqual(s.view.settings.blitz, true);
  for (const x of [a, b, c]) await x.act('ready', { value: true });
  await sleep(300);
  assert.strictEqual(a.view.phase, 'betting', 'tournament started');
  assert.strictEqual(a.view.timerDur, 8000, 'blitz timers');
  const bots = [a, b, c];
  const driveN = (x) => async () => {
    const v = x.view; const me = v.you.seat; const mine = v.seats[me];
    if (!mine || !mine.alive) return;
    if (v.phase === 'betting' && mine.bet == null) x.act('bet', { amount: Math.max(v.limits.min, Math.min(v.limits.max, mine.balance, 50)) });
    else if (v.phase === 'playing' && v.turn?.seat === me) {
      const h = v.hands[me][v.turn.hand]; const tot = h.cards.reduce((q, y) => q + (/^[AKQJ1]/.test(y) ? 10 : parseInt(y)), 0);
      x.act(tot < 15 && v.legal ? 'hit' : 'stand_hand');
    } else if (v.phase === 'playing' && v.insYou && !v.insYou.done) x.act('insure', v.insYou.even ? { take: true } : { amount: v.insYou.max });
    else if (v.phase === 'settled') x.act('next');
  };
  bots.forEach((x) => (x.onview = driveN(x)));
  const t1 = Date.now();
  while (a.view.phase !== 'over' && Date.now() - t1 < 90000) await sleep(100);
  assert.strictEqual(a.view.phase, 'over', 'tournament finished');
  await sleep(200);
  const rk = a.view.over.ranking;
  assert.strictEqual(rk.length, 3);
  assert.strictEqual(rk[0].place, 1);
  assert.deepStrictEqual(s.view.over, a.view.over);
  console.log(`e2e tournament ok: ${a.view.round} rounds in ${((Date.now() - t1) / 1000).toFixed(1)}s, ranking`, rk.map((r) => `${r.place}.${r.name}:${r.balance}`).join(' '));
  /* ---- same room, now a Texas Hold'em match ---- */
  for (const x of bots) await x.act('lobby');
  await sleep(200);
  assert.strictEqual(a.view.phase, 'lobby');
  const pr = await a.act('settings', { settings: { game: 'poker', blitz: true, startingBalance: 400, sb: 10, maxRounds: 8 } });
  assert.strictEqual(pr.status, 200, JSON.stringify(pr));
  assert.strictEqual(a.view.settings.mode, 'holdem');
  for (const x of bots) await x.act('ready', { value: true });
  await sleep(300);
  assert.strictEqual(a.view.phase, 'poker', 'poker started');
  const pkBot = (x) => () => {
    const v = x.view, me = v.you.seat;
    if (!v.poker) return;
    // nobody may ever see another player's hole cards before showdown
    if (v.phase === 'poker') for (let i = 0; i < 6; i++) if (i !== me && v.poker.hole[i] && v.poker.hole[i].some(Boolean)) throw new Error('hole card leak');
    if (v.phase === 'poker' && v.poker.legal && v.poker.to === me) {
      const lg = v.poker.legal, r = Math.random();
      if (lg.raise && r < 0.25) x.act('raise', { to: lg.raise.min });
      else if (!lg.check && r > 0.9) x.act('fold');
      else x.act(lg.check ? 'check' : 'call');
    } else if (v.phase === 'settled') x.act('next');
  };
  bots.forEach((x) => (x.onview = pkBot(x)));
  const t2 = Date.now();
  while (a.view.phase !== 'over' && Date.now() - t2 < 90000) await sleep(100);
  assert.strictEqual(a.view.phase, 'over', 'poker match finished');
  await sleep(200);
  const total = a.view.over.ranking.reduce((q, r) => q + r.balance, 0);
  assert.strictEqual(total, 1200, 'chips conserved');
  console.log(`e2e poker ok: ${a.view.round} hands in ${((Date.now() - t2) / 1000).toFixed(1)}s`, a.view.over.ranking.map((r) => `${r.place}.${r.name}:${r.balance}`).join(' '));
  bots.forEach((x) => (x.onview = null));
  /* ---- lobby: house tables are listed, created lazily with the game locked to the table ---- */
  const tl = async () => (await (await fetch(BASE + '/api/tables', { headers: { Authorization: 'Bearer ' + a.token } })).json()).tables;
  let tb = await tl();
  assert.strictEqual(tb.length, 21);
  assert.ok(tb.every((t) => !t.active), 'all house tables start empty');
  assert.strictEqual((await fetch(BASE + '/api/tables')).status, 401);
  const j = await post('/api/act', { room: 'poker-2', type: 'join' }, a.token);
  assert.strictEqual(j.status, 200);
  assert.strictEqual(j.view.settings.game, 'poker', 'game locked to the table');
  const st2 = await post('/api/act', { room: 'poker-2', type: 'settings', settings: { game: 'roulette' } }, a.token);
  assert.strictEqual(st2.view.settings.game, 'poker', 'host cannot change the game of a house table');
  tb = await tl();
  const p2 = tb.find((t) => t.id === 'poker-2');
  assert.ok(p2.active && p2.game === 'poker' && p2.phase === 'lobby' && p2.max === 6, JSON.stringify(p2));
  assert.strictEqual(tb.find((t) => t.id === 'poker-1').active, false);
  console.log('e2e lobby ok');
  /* ---- room cap: 'e2e' already exists, so 9 more fit and the 10th new one is refused ---- */
  const cap = [];
  for (let i = 0; i < 10; i++) cap.push((await post('/api/act', { room: 'cap' + i, type: 'join' }, a.token)).status);
  assert.deepStrictEqual(cap, [200, 200, 200, 200, 200, 200, 200, 200, 200, 409], JSON.stringify(cap));
  assert.strictEqual((await post('/api/act', { room: 'e2e', type: 'chat', text: 'still alive' }, a.token)).status, 200, 'existing room unaffected');
  console.log('e2e room cap ok');
  srv.kill(); fake && fake.close(); process.exit(0);
})().catch((e) => { console.error('E2E FAIL', e); srv.kill(); fake && fake.close(); process.exit(1); });
