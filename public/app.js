(() => {
'use strict';

/* =====================================================================
   helpers
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
// Safari throws on storage access when cookies are blocked / in some private modes: never let that break the app.
const LS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => Number(n).toLocaleString('en-US');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (n) => (n >= 1e6 ? +(n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? +(n / 1e3).toFixed(1) + 'K' : n >= 1e3 ? +(n / 1e3).toFixed(1) + 'K' : String(n));
const SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
const DENOMS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000, 10000, 25000, 100000];
const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const NSEATS = 6;
const seatColor = (i) => (i >= 0 && i < NSEATS ? `var(--s${i})` : '');
const MODES = {
  solo: { label: 'Solo', icon: 'coins', desc: 'Just you against the dealer. Play until you are broke or the round limit hits; finish ahead of your starting stack to win.' },
  duel: { label: 'Duel', icon: 'swords', desc: 'Head to head: two players each play the dealer. Last one with chips wins.' },
  classic: { label: 'Classic', icon: 'users', desc: '2–6 players, each against the dealer. Play on until one stack is left or the round limit hits.' },
  showdown: { label: 'Showdown', icon: 'dices', desc: '2–6 players, no dealer. Best hand takes the pot (side pots for unequal bets). A natural blackjack beats 21.' },
  tournament: { label: 'Tournament', icon: 'trophy', desc: '3–6 players vs the dealer. Bet limits rise as rounds pass; run out of chips and you are eliminated.' },
  holdem: { label: "Texas Hold'em", icon: 'spade', desc: "2–6 players. Two hole cards each, five on the board, best five-card hand wins. Fold, call or raise; run out of chips and you are out." },
  roulette: { label: 'Roulette', icon: 'dices', desc: 'A shared wheel. Place chips on numbers, colours, dozens and more, lock in, and watch the ball. Play on until you are broke or the limit hits.' },
  crash: { label: 'Crash', icon: 'rocket', desc: 'A multiplier climbs until it crashes. Bet, then cash out before it goes. Set an auto cash-out if you like.' },
  plinko: { label: 'Plinko', icon: 'circle', desc: 'Drop balls down a peg board. Pick the rows and the risk; the slot it lands in sets the payout. Drop as often as you like.' },
  dice: { label: 'Dice', icon: 'dices', desc: 'Pick a target and roll over or under it. The lower the win chance, the bigger the payout.' },
  mines: { label: 'Mines', icon: 'gem', desc: 'Reveal tiles on a 5×5 board without hitting a mine. Every safe tile raises your payout; cash out any time.' },
};
const STREET = { preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River' };
const ARC = ['roulette', 'crash', 'plinko', 'dice', 'mines'];
const UNIT = { plinko: ['ball', 'balls'], dice: ['roll', 'rolls'], mines: ['game', 'games'] };
const isArc = (v) => !!(v && ARC.includes(v.game) && v.arcade);
const isPk = (v) => !!(v && v.game === 'poker' && v.poker);
const modeOf = (v) => (v && v.mode && v.mode.id) || 'duel';
const place = (n) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th');
/* Player profiles (custom color + icon), keyed by name; rebuilt from every view. */
const PROF = {};
const COLORS = ['#38bdf8', '#e879f9', '#f87171', '#fb923c', '#fbbf24', '#a3e635', '#4ade80', '#2dd4bf', '#818cf8', '#a78bfa', '#f472b6', '#e5e7eb'];
const ICONS = ['crown', 'skull', 'flame', 'ghost', 'rocket', 'zap', 'gem', 'cat', 'dog', 'bot', 'clover', 'star', 'bird', 'fish', 'spade', 'dices'];
const fgFor = (c) => { const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c || ''); if (!m) return '#111214'; const l = (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)) / 255; return l > 0.55 ? '#111214' : '#ffffff'; };
const colorOf = (name, seat) => (PROF[name] && PROF[name].color) || (seat >= 0 ? seatColor(seat) : `hsl(${hue(name)} 80% 70%)`);
const iconHtml = (id) => (id.includes(':') ? `<img src="/avatars/${id.replace(':', '-')}.svg" alt="" draggable="false" loading="lazy">` : ic(id));
const avatarInner = (name) => (PROF[name] && PROF[name].icon ? iconHtml(PROF[name].icon) : esc((name[0] || '?').toUpperCase()));
const CHAR_STYLES = [['', 'Icons'], ['lorelei', 'Lorelei'], ['openpeeps', 'Peeps'], ['pixelart', 'Pixel'], ['bottts', 'Bots']];
const styleFor = (name, seat) => { const c = colorOf(name, seat); return `--c:${c};--fg:${fgFor(c)}`; };
const avatar = (name, seat, cls = '') => `<span class="avatar ${cls}" style="${styleFor(name, seat)}">${avatarInner(name)}</span>`;
function setAvatar(el, name, seat) {
  el.setAttribute('style', styleFor(name, seat));
  el.innerHTML = avatarInner(name);
}
function loadProf() { try { return JSON.parse(LS.get('bj.prof') || 'null'); } catch { return null; } }
const chipClass = (n) => 'k' + ([...DENOMS].reverse().find((d) => d <= n) || 1);

function cardValue(c) { const r = c.slice(0, -1); return r === 'A' ? 11 : 'KQJ'.includes(r) || r === '10' ? 10 : +r; }
function handTotal(cards) {
  let t = 0, a = 0;
  for (const c of cards) { const v = cardValue(c); t += v; if (v === 11) a++; }
  while (t > 21 && a) { t -= 10; a--; }
  return { total: t, soft: a > 0 };
}
const isRed = (c) => c && (c.endsWith('H') || c.endsWith('D'));

/* =====================================================================
   sound (all synthesised, no assets)
   ===================================================================== */
// Soft, warm sound design: everything goes through a gentle low-pass, a soft limiter and a touch of room reverb.
// `getCtx()` returns the AudioContext to play into (an OfflineAudioContext in tests); `isMuted()` gates playback.
function createSfx(getCtx, isMuted) {
  let bus = null, busCtx = null, noiseBuf = null, masterNode = null, vol = 1;
  function chain(c) {
    if (bus && busCtx === c) return bus;
    busCtx = c;
    const master = c.createGain(); master.gain.value = 3.2 * vol; masterNode = master;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500; lp.Q.value = 0.4;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 20; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    master.connect(lp); lp.connect(comp); comp.connect(c.destination);
    // small generated room: decaying, darkened noise
    const len = (c.sampleRate * 1.3) | 0, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let lpv = 0; for (let i = 0; i < len; i++) { lpv += (((Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6)) - lpv) * 0.35; d[i] = lpv; } }
    const conv = c.createConvolver(); conv.buffer = ir;
    const wet = c.createGain(); wet.gain.value = 0.32; conv.connect(wet); wet.connect(master);
    // soft pink-ish noise for swishes
    const nl = c.sampleRate | 0; noiseBuf = c.createBuffer(1, nl, c.sampleRate);
    const nd = noiseBuf.getChannelData(0); let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < nl; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; nd[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
    return (bus = { master, conv });
  }
  const ready = () => { if (isMuted()) return null; const c = getCtx(); return c ? { c, b: chain(c) } : null; };
  const jit = (x, p = 0.06) => x * (1 + (Math.random() * 2 - 1) * p);
  // pitched note with soft attack and exponential decay
  function note(freq, t, dur, { type = 'sine', gain = 0.08, attack = 0.012, send = 0.5, overtone = 0 } = {}) {
    const r = ready(); if (!r) return; const { c, b } = r, t0 = c.currentTime + t;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const dry = c.createGain(); dry.gain.value = 1 - send * 0.5; const s = c.createGain(); s.gain.value = send;
    g.connect(dry); g.connect(s); dry.connect(b.master); s.connect(b.conv);
    for (const [m, gm] of overtone ? [[1, 1], [overtone, 0.25]] : [[1, 1]]) {
      const o = c.createOscillator(), og = c.createGain(); o.type = type; o.frequency.value = freq * m; og.gain.value = gm; o.connect(og); og.connect(g); o.start(t0); o.stop(t0 + dur + 0.05);
    }
  }
  // damped resonance (wood / clay click)
  function click(freq, t, decay, gain) {
    const r = ready(); if (!r) return; const { c, b } = r, t0 = c.currentTime + t;
    const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(freq, t0); o.frequency.exponentialRampToValueAtTime(freq * 0.86, t0 + decay);
    g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    o.connect(g); g.connect(b.master); o.start(t0); o.stop(t0 + decay + 0.02);
  }
  // filtered noise burst (card slide / paper)
  function swish(t, dur, { gain = 0.1, from = 1400, to = 3200, q = 0.7, hp = 500 } = {}) {
    const r = ready(); if (!r) return; const { c, b } = r, t0 = c.currentTime + t;
    const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q; bp.frequency.setValueAtTime(from, t0); bp.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const h = c.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hp;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(gain, t0 + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(bp); bp.connect(h); h.connect(g); g.connect(b.master); s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.03);
  }
  return {
    // card slid across felt: soft swish + a muted thump
    deal(t = 0) { swish(t, 0.11, { gain: 0.22, from: jit(1200, .15), to: jit(2800, .15), q: 0.6, hp: 400 }); click(jit(150, .1), t + 0.07, 0.06, 0.12); },
    // card turned over: short papery flick
    setVolume(v) { vol = v; if (masterNode) masterNode.gain.value = 3.2 * v; },
    flip(t = 0) { swish(t, 0.06, { gain: 0.2, from: 2600, to: 1500, q: 0.9, hp: 900 }); click(jit(300, .06), t + 0.03, 0.05, 0.08); },
    // clay chips: two quick damped clicks
    chip() { const f = jit(2100, .08); click(f, 0, 0.035, 0.11); click(f * 0.72, 0.012, 0.05, 0.1); click(jit(f * 1.1, .05), 0.055, 0.03, 0.08); },
    // your turn: soft two-note bell
    turn() { note(698.5, 0, 0.55, { gain: 0.055, overtone: 2, send: 0.6 }); note(880, 0.11, 0.7, { gain: 0.055, overtone: 2, send: 0.6 }); },
    // win: warm rising arpeggio with a little shimmer
    win() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(f, i * 0.09, 0.9, { type: 'triangle', gain: 0.06, attack: 0.02, overtone: 2, send: 0.7 })); note(2093, 0.36, 0.6, { gain: 0.02, send: 0.9 }); },
    // loss: two gentle falling notes, no buzz
    lose() { note(392, 0, 0.6, { gain: 0.07, attack: 0.03, send: 0.5 }); note(311.13, 0.16, 0.9, { gain: 0.07, attack: 0.03, send: 0.5 }); },
    // push: neutral double blip
    push() { note(493.88, 0, 0.35, { gain: 0.05, send: 0.5 }); note(493.88, 0.16, 0.4, { gain: 0.05, send: 0.5 }); },
  };
}
const sfx = (() => {
  let ctx = null, muted = LS.get('bj.mute') === '1', level = Math.min(100, Math.max(0, +(LS.get('bj.vol') ?? 70)));
  function ensure() {
    if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ctx = new AC(); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  const inner = createSfx(() => ensure(), () => muted);
  inner.setVolume(Math.pow(level / 100, 2)); // squared: feels linear to the ear
  return {
    ...inner,
    unlock: ensure,
    get muted() { return muted; },
    setMuted(m) { muted = m; LS.set('bj.mute', m ? '1' : '0'); },
    get level() { return level; },
    setLevel(l) { level = l; LS.set('bj.vol', String(l)); inner.setVolume(Math.pow(l / 100, 2)); },
  };
})();
['pointerdown', 'keydown'].forEach((e) => addEventListener(e, () => sfx.unlock(), { once: true, passive: true }));

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.innerHTML = ic(kind === 'bad' ? 'lm-alert-circle-loop' : kind === 'ok' ? 'lm-confirm-circle' : 'info');
  const tx = document.createElement('span'); tx.textContent = msg; t.appendChild(tx);
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2600);
}

function countTo(el, to) {
  const from = el._v ?? to;
  el._v = to;
  cancelAnimationFrame(el._r);
  if (from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 600;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(Math.round(from + (to - from) * e));
    if (k < 1) el._r = requestAnimationFrame(step);
  };
  el._r = requestAnimationFrame(step);
  const bal = el.closest('.bal');
  if (bal) { bal.classList.remove('gain', 'loss'); void bal.offsetWidth; bal.classList.add(to > from ? 'gain' : 'loss'); clearTimeout(bal._t); bal._t = setTimeout(() => bal.classList.remove('gain', 'loss'), 1100); }
}

const shoeC = new CardShoe('#shoe', { total: 312 }), discC = new DiscardTray('#discard', { total: 312 });
const centerOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
// offset of `el` from the card shoe (falls back to the top of the table when the shoe is hidden on small screens)
function shoeOffset(el) {
  const shoe = $('#shoe'), r = el.getBoundingClientRect();
  let sx, sy;
  if (shoe && shoe.offsetParent) { const s = shoe.getBoundingClientRect(); sx = s.left + s.width * 0.3; sy = s.top + s.height * 0.32; } // the shoe's mouth
  else { const f = $('#felt').getBoundingClientRect(); sx = f.right - 30; sy = f.top - 20; }
  return { x: sx - (r.left + r.width / 2), y: sy - (r.top + r.height / 2) };
}
// little coins flying between two elements (WAAPI, removed when done)
function flyCoins(fromEl, toEl, n, { onLand } = {}) {
  if (S.instant || !fromEl || !toEl) return;
  const a0 = centerOf(fromEl), b0 = centerOf(toEl);
  for (let k = 0; k < n; k++) {
    const d = document.createElement('i'); d.className = 'flycoin';
    document.body.appendChild(d);
    const jx = (Math.random() - .5) * 26, jy = (Math.random() - .5) * 18, midx = (a0.x + b0.x) / 2 + (Math.random() - .5) * 60, midy = Math.min(a0.y, b0.y) - 40 - Math.random() * 30;
    const kf = [
      { transform: `translate(${a0.x + jx - 7}px,${a0.y + jy - 7}px) scale(.6)`, opacity: 0 },
      { transform: `translate(${a0.x + jx - 7}px,${a0.y + jy - 7}px) scale(1)`, opacity: 1, offset: .12 },
      { transform: `translate(${midx - 7}px,${midy - 7}px) scale(1.15)`, opacity: 1, offset: .55 },
      { transform: `translate(${b0.x - 7}px,${b0.y - 7}px) scale(.8)`, opacity: .9 },
    ];
    const an = d.animate(kf, { duration: 650 + Math.random() * 150, delay: k * 70, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' });
    an.onfinish = () => { d.remove(); if (onLand && k === n - 1) onLand(); };
    sfx.chip && k % 2 === 0 && setTimeout(() => sfx.chip(), k * 70 + 450);
  }
}

/* =====================================================================
   state + network
   ===================================================================== */
const S = {
  token: LS.get('bj.token') || '',
  id: LS.get('bj.id') || '',
  name: LS.get('bj.name') || '',
  room: 'main',
  view: null, skew: 0, gen: 0, ac: null, conn: 'off',
  instant: true, pending: 0, betRound: -1, sig: {},
};
const serverNow = () => (S.view && S.view.paused ? S.view.paused.at : Date.now() + S.skew);

async function post(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
    body: JSON.stringify(body),
  });
  let j = {};
  try { j = await r.json(); } catch { /* ignore */ }
  if (!r.ok) { const e = new Error(j.message || j.error || 'Request failed'); e.code = j.error; e.status = r.status; throw e; }
  return j;
}

async function act(type, extra = {}) {
  try {
    const r = await post('/api/act', { room: S.room, type, seq: S.view ? S.view.seq : undefined, ...extra });
    if (r.view) applyView(r.view);
    return true;
  } catch (e) {
    if (e.status === 401) { logout('Session expired. Sign in again.'); return false; }
    if (e.code !== 'stale') toast(e.message, 'bad');
    return false;
  }
}

function setConn(c) {
  S.conn = c;
  $('#connDot').className = 'dot ' + (c === 'live' ? 'live' : c === 'off' ? 'off' : '');
  $('#connDot').classList.toggle('hidden', c === 'retry');
  $('#connSpin').classList.toggle('hidden', c !== 'retry');
}

async function streamLoop(gen) {
  let delay = 300;
  while (S.gen === gen) {
    const ac = new AbortController();
    S.ac = ac;
    let lastByte = Date.now(), healthy = false;
    const wd = setInterval(() => { if (Date.now() - lastByte > 30000) ac.abort(); }, 5000);
    try {
      const r = await fetch('/api/stream?room=' + encodeURIComponent(S.room), { headers: { Authorization: 'Bearer ' + S.token }, signal: ac.signal, cache: 'no-store' });
      if (r.status === 401) { logout('Session expired. Sign in again.'); return; }
      if (!r.ok) throw new Error('http ' + r.status);
      setConn('live'); healthy = true; delay = 300;
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        lastByte = Date.now();
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const part = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = part.split('\n').find((l) => l.startsWith('data: '));
          if (line) { try { applyView(JSON.parse(line.slice(6))); } catch { /* ignore */ } }
        }
      }
    } catch { /* fallthrough to retry */ }
    finally { clearInterval(wd); }
    if (S.gen !== gen) return;
    if (!healthy) {
      setConn('retry');
      // fallback: keep the table fresh by polling while the stream is down
      try {
        const r = await fetch('/api/state?room=' + encodeURIComponent(S.room), { headers: { Authorization: 'Bearer ' + S.token }, cache: 'no-store' });
        if (r.status === 401) { logout('Session expired. Sign in again.'); return; }
        if (r.ok) applyView((await r.json()).view);
      } catch { setConn('off'); }
    }
    await sleep(healthy ? 60 : delay);
    delay = Math.min(delay * 1.6, 4000);
  }
}

function applyView(v) {
  if (S.view && v.v < S.view.v) return;
  const prev = S.view;
  S.view = v;
  S.skew = v.now - Date.now();
  render(v, prev);
  S.instant = false;
}

/* =====================================================================
   login / logout
   ===================================================================== */
const loginEl = $('#login'), appEl = $('#app');
function showLogin(msg) {
  appEl.classList.add('hidden'); loginEl.classList.remove('hidden');
  $('#loginErr').textContent = msg || '';
  $('#inName').value = S.name || '';
  $('#inPass').value = '';
  seedLoginBg();
  setStep('pass');
}
// scatter of cards / blackjack hands / chip stacks / dice behind the login card, re-randomised on every visit
function seedLoginBg() {
  const bg = $('#loginBg'); bg.innerHTML = '';
  const small = innerWidth < 640, cols = small ? 3 : 6, rows = small ? 5 : 4;
  const R = (a, b) => a + Math.random() * (b - a), pick = (l) => l[Math.floor(Math.random() * l.length)];
  const ranks = ['A', 'K', 'Q', 'J', '10', '9', '7'], suits = ['♠', '♥', '♦', '♣'];
  const card = (r, s) => `<div class="fcard${'♥♦'.includes(s) ? ' red' : ''}"><span>${r}</span><i>${s}</i></div>`;
  const chipCls = ['k5', 'k10', 'k25', 'k50', 'k100', 'k500'];
  const makers = [
    () => card(pick(ranks), pick(suits)),
    () => card(pick(ranks), pick(suits)),
    () => card(pick(ranks), pick(suits)),
    () => { const s1 = pick(suits), s2 = pick(suits); return `<div class="fhand">${card('A', s1)}${card(pick(['K', 'Q', 'J', '10']), s2)}<span class="tot">BLACKJACK</span></div>`; },
    () => { const s1 = pick(suits); return `<div class="fhand">${card('10', s1)}${card('J', pick(suits))}${card('A', pick(suits))}<span class="tot">21</span></div>`; },
    () => { const n = 2 + Math.floor(Math.random() * 3); return `<div class="fstack">${Array.from({ length: n }, () => { const k = pick(chipCls); return `<div class="chip ${k}"><span>${k.slice(1)}</span></div>`; }).join('')}</div>`; },
    () => `<div class="fstack">${Array.from({ length: 3 }, () => { const k = pick(chipCls); return `<div class="chip ${k}"><span>${k.slice(1)}</span></div>`; }).join('')}</div>`,
    () => { const n = 1 + Math.floor(Math.random() * 6), on = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }[n]; return `<div class="fdice">${Array.from({ length: 9 }, (_, i) => on.includes(i) ? '<i></i>' : '<b></b>').join('')}</div>`; },
    () => { const s = pick(suits); return `<div class="fsuit" style="color:${'♥♦'.includes(s) ? '#dc2626' : '#e2e8f0'}">${s}</div>`; },
    () => '<div class="fbadge">21</div>',
  ];
  const cells = Array.from({ length: cols * rows }, (_, i) => i).sort(() => Math.random() - .5);
  cells.forEach((cell) => {
    if (Math.random() < .18) return; // leave a few gaps
    const cx = (cell % cols + R(.15, .85)) / cols * 100, cy = (Math.floor(cell / cols) + R(.15, .85)) / rows * 100;
    const el = document.createElement('div'); el.className = 'fl'; el.innerHTML = pick(makers)();
    const sc = R(.7, 1.25) * (small ? .75 : 1);
    const st = el.style;
    st.left = cx + '%'; st.top = cy + '%'; st.marginLeft = '-40px'; st.marginTop = '-55px';
    st.setProperty('--r', R(-28, 28).toFixed(1) + 'deg'); st.setProperty('--s', sc.toFixed(2));
    st.setProperty('--o', R(.1, .2).toFixed(2)); st.setProperty('--bl', (sc > 1.1 ? R(1, 2.2) : 0).toFixed(1) + 'px');
    st.setProperty('--dur', R(16, 30).toFixed(1) + 's'); st.setProperty('--dl', (-R(0, 20)).toFixed(1) + 's');
    st.setProperty('--dx', R(-14, 14).toFixed(0) + 'px'); st.setProperty('--dr', R(-8, 8).toFixed(1) + 'deg');
    bg.appendChild(el);
  });
}

// login is two steps: master password first, then name + room
function setStep(step) {
  const first = S.step === undefined, prev = S.step;
  S.step = step;
  if (!first && prev !== step) {
    const c = $('.login-card'); c.classList.remove('flip'); void c.offsetWidth; c.classList.add('flip');
    setTimeout(() => c.classList.remove('flip'), 520);
    setTimeout(() => applyStep(step), 230);
  } else applyStep(step);
}
function applyStep(step) {
  $('#stepPass').classList.toggle('hidden', step !== 'pass');
  $('#stepUser').classList.toggle('hidden', step !== 'user');
  $('#inName').required = step === 'user';
  $('#inPass').required = step === 'pass';
  $('#loginTxt').textContent = step === 'pass' ? 'Continue' : 'Enter the casino';
  $('#loginErr').textContent = '';
  setTimeout(() => (step === 'pass' ? $('#inPass') : $('#inName')).focus(), 0);
}
$('#backPass').addEventListener('click', () => { $('#inPass').value = ''; setStep('pass'); });

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#loginBtn');
  btn.disabled = true; $('#loginErr').textContent = '';
  $('#loginSpin').classList.remove('hidden'); $('#loginTxt').textContent = 'Checking…';
  try {
    if (S.step === 'pass') { await post('/api/login', { check: true, password: $('#inPass').value }); setStep('user'); return; }
    const r = await post('/api/login', { name: $('#inName').value, password: $('#inPass').value, id: S.id });
    S.token = r.token; S.id = r.id; S.name = r.name;
    LS.set('bj.token', S.token); LS.set('bj.id', S.id); LS.set('bj.name', S.name);
    sfx.unlock();
    const inv = new URLSearchParams(location.search).get('room');
    if (inv) { S.room = cleanRoomId(inv); await enter(); } else showHub();
  } catch (err) {
    $('#loginErr').textContent = err.message;
    if (S.step === 'user' && err.status === 401) setStep('pass');
    const c = $('.login-card'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake');
  } finally { btn.disabled = false; $('#loginSpin').classList.add('hidden'); $('#loginTxt').textContent = S.step === 'pass' ? 'Continue' : 'Enter the casino'; }
});

const cleanRoomId = (r) => String(r || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20);
async function enter() {
  S.gen++;
  hubStop();
  S.view = null; S.instant = true; S.sig = {};
  $('#msgs').innerHTML = ''; S.chatLast = 0;
  try {
    const r = await post('/api/act', { room: S.room, type: 'join' });
    loginEl.classList.add('hidden'); $('#hub').classList.add('hidden'); appEl.classList.remove('hidden');
    $('#meName').textContent = S.name; refreshMe();
    $('#roomName').textContent = tableName(S.room);
    soundIcon();
    history.replaceState(null, '', `?room=${S.room}`);
    applyView(r.view);
    streamLoop(S.gen);
    const sp = loadProf(); if (sp) act('profile', sp);
  } catch (e) {
    if (e.status === 401) { S.token = ''; LS.del('bj.token'); showLogin(''); throw e; }
    showHub(e.message);
    throw e;
  }
}

async function logout(msg) {
  S.gen++;
  if (S.ac) S.ac.abort();
  S.token = ''; LS.del('bj.token');
  S.view = null; setConn('off');
  hubStop();
  showLogin(msg);
}

// back to the casino lobby (the table is left, the sign-in stays)
function leaveTable() {
  S.gen++;
  if (S.ac) S.ac.abort();
  S.view = null; setConn('off');
  showHub();
}

$('#logoutBtn').addEventListener('click', async () => {
  const v = S.view;
  if (v && v.you.seat >= 0) {
    if (['betting', 'playing', 'dealer', 'settled'].includes(v.phase) && !v.over) {
      if (!confirm('Leaving mid-match forfeits it. Leave anyway?')) return;
      await act('forfeit');
    } else if (v.phase === 'lobby' || v.phase === 'over') await act('stand');
  }
  leaveTable();
});
$('#insYes').addEventListener('click', () => act('insure', S.view && S.view.insYou && S.view.insYou.even ? { take: true } : { amount: S.view && S.view.insYou ? S.view.insYou.max : 0 }));
$('#insNo').addEventListener('click', () => act('insure', { take: false, amount: 0 }));
$('#pauseBtn').addEventListener('click', () => act('pause'));
$('#resumeBtn').addEventListener('click', () => act('resume'));
$('#forfeitBtn').addEventListener('click', () => { if (confirm('Forfeit the match? Your opponent wins.')) act('forfeit'); });
$('#roomPill').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?room=${S.room}`;
  try { await navigator.clipboard.writeText(url); toast('Invite link copied', 'ok'); } catch { toast(url); }
});
function soundIcon() {
  const off = sfx.muted || sfx.level === 0;
  $('#soundBtn').innerHTML = ic(off ? 'volume-x' : 'volume-2');
  $('#volRange').value = off ? 0 : sfx.level;
  $('#volRange').style.setProperty('--p', ($('#volRange').value) + '%');
  $('#mmMute').innerHTML = ic(off ? 'volume-x' : 'volume-2');
  $('#mmVol').value = off ? 0 : sfx.level; $('#mmVol').style.setProperty('--p', $('#mmVol').value + '%');
}
const touchUI = matchMedia('(hover: none)');
$('#soundBtn').addEventListener('click', () => {
  if (touchUI.matches) { $('#vol').classList.toggle('open'); sfx.unlock(); return; } // phones: open the slider
  if (sfx.level === 0) sfx.setLevel(70);
  sfx.setMuted(!sfx.muted); soundIcon(); sfx.unlock(); sfx.chip();
});
let volTick = 0;
$('#volRange').addEventListener('input', (e) => {
  const l = +e.target.value; sfx.setLevel(l); sfx.setMuted(l === 0); soundIcon(); sfx.unlock();
  if (performance.now() - volTick > 160) { volTick = performance.now(); sfx.chip(); } // audible feedback while dragging
});
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#vol')) $('#vol').classList.remove('open'); });
/* phones: Chat / Rounds / Table open in a bottom sheet; wider stacked layouts keep the old tab bar */
const phoneUI = matchMedia('(max-width:640px)');
function sheetSync() {
  const open = document.body.classList.contains('sheet-open'), t = document.body.dataset.tab;
  $$('#sheetBar .stabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === t));
  $('#sheetBar').classList.toggle('on', open);
}
function openSheet(t) {
  document.body.dataset.tab = t; document.body.classList.add('sheet-open'); sheetSync();
  if (t === 'chat') { S.unread = 0; renderUnread(); const m = $('#msgs'); m.scrollTop = m.scrollHeight; }
}
function closeSheet() { document.body.classList.remove('sheet-open'); sheetSync(); const a = document.activeElement; if (a && a.blur && a.closest && a.closest('.chat')) a.blur(); }
$$('.mtabs button').forEach((b) => b.addEventListener('click', () => {
  if (phoneUI.matches) { openSheet(b.dataset.t); return; }
  document.body.dataset.tab = b.dataset.t;
  $$('.mtabs button').forEach((x) => x.classList.toggle('on', x === b));
}));
$$('#sheetBar .stabs button').forEach((b) => b.addEventListener('click', () => openSheet(b.dataset.t)));
$('#sheetGrab').addEventListener('click', closeSheet);
$('#felt').addEventListener('click', () => { if (document.body.classList.contains('sheet-open')) closeSheet(); });
{ // drag the handle down to dismiss
  let y0 = null;
  const bar = $('#sheetBar');
  bar.addEventListener('pointerdown', (e) => { if (e.target.closest('.stabs button')) return; y0 = e.clientY; });
  addEventListener('pointerup', (e) => { if (y0 != null && e.clientY - y0 > 40) closeSheet(); y0 = null; });
  addEventListener('pointercancel', () => { y0 = null; });
}
addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('sheet-open')) closeSheet(); });
phoneUI.addEventListener('change', () => { document.body.classList.remove('sheet-open'); sheetSync(); });

/* phone header: the ... menu holds sound, pause, forfeit and leave */
const moreMenu = $('#moreMenu'), moreBtn = $('#moreBtn');
function closeMore() { moreMenu.hidden = true; moreBtn.setAttribute('aria-expanded', 'false'); }
moreBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!moreMenu.hidden) return closeMore();
  $('#mmPause').hidden = $('#pauseBtn').classList.contains('hidden');
  $('#mmForfeit').hidden = $('#forfeitBtn').classList.contains('hidden');
  moreMenu.hidden = false; moreBtn.setAttribute('aria-expanded', 'true'); soundIcon();
});
document.addEventListener('pointerdown', (e) => { if (!moreMenu.hidden && !e.target.closest('#moreMenu, #moreBtn')) closeMore(); });
$('#mmPause').addEventListener('click', () => { closeMore(); $('#pauseBtn').click(); });
$('#mmForfeit').addEventListener('click', () => { closeMore(); $('#forfeitBtn').click(); });
$('#mmLeave').addEventListener('click', () => { closeMore(); $('#logoutBtn').click(); });
$('#mmMute').addEventListener('click', () => {
  if (sfx.level === 0) sfx.setLevel(70);
  sfx.setMuted(!sfx.muted); soundIcon(); sfx.unlock(); sfx.chip();
});
$('#mmVol').addEventListener('input', (e) => {
  const l = +e.target.value; sfx.setLevel(l); sfx.setMuted(l === 0); soundIcon(); sfx.unlock();
  if (performance.now() - volTick > 160) { volTick = performance.now(); sfx.chip(); }
});

/* =====================================================================
   cards
   ===================================================================== */
function cardFront(c) {
  const r = c.slice(0, -1), s = SYM[c.slice(-1)], face = 'JQK'.includes(r);
  return `<span class="c tl"><b>${r}</b><i>${s}</i></span><div class="mid${face ? ' face-l' : ''}">${face ? `${r}<small>${s}</small>` : s}</div><span class="c br"><b>${r}</b><i>${s}</i></span>`;
}
const DEAL_MS = 800, DEAL_GAP = 400; // flight time of one card, and the pause between cards
function makeCard(c, animate, delay) {
  const n = document.createElement('div');
  n.className = 'card' + (isRed(c) ? ' red' : '');
  n.dataset.c = c || '';
  n.innerHTML = '<div class="inner"><div class="face back">♠</div><div class="face front"></div></div>';
  if (c) n.querySelector('.front').innerHTML = cardFront(c);
  if (c && !animate) n.classList.add('up');
  if (animate) {
    n.classList.add('deal'); n.style.setProperty('--d', delay + 'ms');
    n.addEventListener('animationend', () => n.classList.remove('deal'), { once: true });
    sfx.deal(delay / 1000);
    // face cards land face-down, then turn over once they reach the felt
    if (c) setTimeout(() => { n.classList.add('up'); sfx.flip(); }, delay + DEAL_MS - 120);
  }
  return n;
}
function revealCard(n, c) {
  n.querySelector('.front').innerHTML = cardFront(c);
  n.classList.toggle('red', isRed(c));
  n.dataset.c = c;
  if (n.parentNode && !S.instant) n.parentNode._until = Math.max(n.parentNode._until || 0, performance.now() + 750);
  void n.offsetWidth;
  n.classList.add('up');
  if (!S.instant) { n.classList.add('lift'); n.addEventListener('animationend', () => n.classList.remove('lift'), { once: true }); }
  sfx.flip();
}
function syncCards(box, list, delayFn) {
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const n = box.children[i];
    if (!n) {
      const dl = delayFn(i);
      const nn = makeCard(c, !S.instant, dl); box.appendChild(nn);
      if (!S.instant) box._until = Math.max(box._until || 0, performance.now() + dl + DEAL_MS + 450); // totals wait for the cards
      if (!S.instant) { const o = shoeOffset(nn); nn.style.setProperty('--fx', o.x + 'px'); nn.style.setProperty('--fy', o.y + 'px'); nn.style.setProperty('--fr', (Math.random() * 30 - 8).toFixed(0) + 'deg'); }
      continue;
    }
    const cur = n.dataset.c;
    if (cur === (c || '')) continue;
    if (!cur && c) revealCard(n, c);
    else box.replaceChild(makeCard(c, !S.instant, 0), n);
  }
  while (box.children.length > list.length) box.lastChild.remove();
}

function setTotal(el, cards, { bj = false, hidden = false, until = 0 } = {}) {
  const real = cards.filter(Boolean);
  el.className = 'total'; el.textContent = '';
  const wait = until - performance.now();
  if (wait > 0) { // the cards are still flying in: don't give the hand away yet
    el.classList.add('pending');
    clearTimeout(el._pt); el._pt = setTimeout(() => el.classList.remove('pending'), wait);
  }
  if (!real.length) return;
  const key = hidden ? 'h' + real.length : bj ? 'bj' : handTotal(real).total + ':' + real.length;
  if (el._k !== key) { if (el._k !== undefined && !S.instant) el._tu = performance.now() + 450; el._k = key; }
  if (performance.now() < (el._tu || 0)) el.classList.add('tick');
  if (hidden) { el.textContent = handTotal([real[0]]).total; return; }
  const { total, soft } = handTotal(real);
  if (total === 21 && !bj) el.classList.add('t21');
  if (bj) { el.classList.add('bj'); el.textContent = 'BLACKJACK'; return; }
  if (total > 21) { el.classList.add('bust'); el.textContent = 'BUST ' + total; return; }
  el.textContent = total;
  if (soft && total < 21) { const s = document.createElement('small'); s.textContent = 'soft'; el.appendChild(s); }
}

/* =====================================================================
   table DOM (built once)
   ===================================================================== */
const seatsEl = $('#seats');
const seatNodes = Array.from({ length: NSEATS }, (_, i) => {
  const d = document.createElement('div');
  d.className = 'seat'; d.dataset.seat = i;
  d.innerHTML = `<div class="emptytxt"></div>
    <div class="seat-head"><span class="avawrap"><span class="avatar"></span><span class="pos"></span></span><div class="who"><div class="name"></div><div class="bal"><i class="coin"></i><b>0</b></div></div><div class="badges"></div></div>
    <div class="stag"></div><div class="timer"><i></i></div><div class="hands"></div><div class="betrow"></div><div class="float"></div>`;
  seatsEl.appendChild(d);
  return d;
});

// seats that were dealt in, in dealing order (starting with the first actor)
function dealOrder(v) {
  const out = [];
  for (let k = 0; k < NSEATS; k++) { const s = (v.first + k) % NSEATS; if (v.seats[s] && v.seats[s].alive) out.push(s); }
  return out;
}
function dealerVisible(v) {
  const cards = v.dealer.cards;
  if (v.phase !== 'dealer') return cards;
  const el = serverNow() - v.dealerAt;
  const out = [cards[0], el >= 500 ? cards[1] : null];
  for (let k = 2; k < cards.length; k++) { if (el >= 500 + 800 * (k - 1)) out.push(cards[k]); else break; }
  return out;
}
function renderBoard(v) {
  const pk = v.poker, box = $('#dealerCards');
  if (box._round !== v.round) { box.innerHTML = ''; box._round = v.round; }
  syncCards(box, pk.board, (i) => (i < 3 ? i * 240 : 0) + 120);
  $('#dealerLbl').textContent = 'POT';
  const t = $('#dealerTotal'); t.className = 'total pot'; t.textContent = pk.pot > 0 ? fmt(pk.pot) : '';
}
function renderDealer(v) {
  if (isPk(v)) return renderBoard(v);
  $('#dealerLbl').textContent = 'DEALER';
  const vis = dealerVisible(v);
  const np = dealOrder(v).length;
  syncCards($('#dealerCards'), vis, (i) => (i < 2 ? (i * (np + 1) + np) * DEAL_GAP : 0));
  const hidden = vis.length >= 2 && !vis[1];
  const t = $('#dealerTotal');
  if (!vis.length) { t.className = 'total'; t.textContent = ''; return; }
  const real = vis.filter(Boolean);
  setTotal(t, vis, { hidden, bj: real.length === 2 && handTotal(real).total === 21 && !hidden, until: $('#dealerCards')._until });
}

// state tag under a seat on phones: THINKING / WAITING / STAND / BUST ...
function seatTag(v, i, s, active) {
  if (!s.alive) return ['', ''];
  if (isPk(v)) {
    const pk = v.poker;
    if (v.phase !== 'poker' || !pk.inHand[i]) return ['', ''];
    if (pk.folded[i]) return ['FOLDED', 'bust'];
    if (active) return ['THINKING', 'think'];
    if (pk.allin[i]) return ['ALL IN', 'stand'];
    return ['WAITING', 'wait'];
  }
  if (v.phase === 'betting') return s.bet == null ? ['THINKING', 'think'] : ['BET LOCKED', 'stand'];
  if (v.phase !== 'playing' && v.phase !== 'dealer') return ['', ''];
  if (active) return ['THINKING', 'think'];
  const hs = v.hands[i] || [];
  if (!hs.length) return ['', ''];
  const tot = hs.map((h) => handTotal(h.cards.filter(Boolean)).total);
  if (hs.every((h) => h.done)) {
    if (tot.every((t) => t > 21)) return ['BUST', 'bust'];
    if (hs.length === 1 && hs[0].bj) return ['BLACKJACK', 'stand'];
    return ['STAND', 'stand'];
  }
  return ['WAITING', 'wait'];
}
function setTag(node, [txt, kind]) {
  const t = node.querySelector('.stag');
  if (t._k !== txt) { t._k = txt; t.textContent = txt; }
  t.dataset.k = kind;
  for (const k of ['think', 'wait', 'stand', 'bust']) node.classList.toggle('st-' + k, kind === k);
}

function renderSeat(i, v, prev) {
  const node = seatNodes[i], s = v.seats[i];
  node.classList.toggle('empty', !s);
  node.classList.toggle('me', v.you.seat === i);
  if (!s) {
    node.querySelector('.emptytxt').textContent = `Seat ${i + 1} is open`;
    node.style.removeProperty('--c');
    node.classList.remove('active', 'multi', 'out', 'fold', 'allin'); setTag(node, ['', '']);
    node.querySelector('.hands').innerHTML = '';
    return;
  }
  node.style.setProperty('--c', colorOf(s.name, i));
  node.classList.toggle('out', !s.alive && v.phase !== 'lobby');
  setAvatar(node.querySelector('.avatar'), s.name, i);
  node.querySelector('.name').textContent = s.name;
  countTo(node.querySelector('.bal b'), s.balance);
  const pkm = isPk(v);
  node.querySelector('.badges').innerHTML =
    (!pkm && v.first === i && s.alive && ['betting', 'playing', 'dealer', 'settled'].includes(v.phase) ? '<span class="badge first" title="Acts first this round">1ST</span>' : '') +
    (!s.online ? '<span class="badge off">OFFLINE</span>' : '');
  const active = pkm ? v.phase === 'poker' && v.poker.to === i : v.phase === 'playing' && v.turn && v.turn.seat === i;
  node.classList.toggle('active', !!active);
  node.classList.toggle('offline', !s.online);
  setTag(node, seatTag(v, i, s, !!active));
  if (pkm) return renderSeatPoker(i, v, prev, node, s);
  node.classList.remove('fold', 'allin');
  node.querySelector('.pos').textContent = '';

  // hands
  const hands = v.hands[i] || [];
  node.classList.toggle('multi', hands.length > 1);
  const box = node.querySelector('.hands');
  while (box.children.length > hands.length) box.lastChild.remove();
  const ord = dealOrder(v), np = ord.length, per = np + (modeOf(v) === 'showdown' ? 0 : 1);
  const posInDeal = Math.max(0, ord.indexOf(i));
  hands.forEach((h, k) => {
    let hn = box.children[k];
    if (!hn) {
      hn = document.createElement('div'); hn.className = 'hand';
      hn.innerHTML = '<div class="cards"></div><div class="hmeta"><span class="total"></span><span class="hbet"><i class="coin"></i><b></b></span><span class="insb"></span><span class="res"></span></div>';
      box.appendChild(hn);
    }
    syncCards(hn.querySelector('.cards'), h.cards, (ci) => (ci < 2 ? (ci * per + posInDeal) * DEAL_GAP : 0));
    setTotal(hn.querySelector('.total'), h.cards, { bj: h.bj, until: hn.querySelector('.cards')._until });
    hn.querySelector('.hbet b').textContent = fmt(h.bet) + (h.doubled ? ' ×2' : '');
    const r = v.results && v.results[i] && v.results[i][k];
    const ib = hn.querySelector('.insb');
    const insTaken = k === 0 && v.insAmt && v.insAmt[i] > 0, evenTaken = k === 0 && (h.even || (v.ins && v.ins.even[i]));
    ib.textContent = evenTaken ? 'EVEN MONEY' : insTaken ? (v.phase === 'settled' && v.insNet && v.insNet[i] ? `INS ${v.insNet[i] > 0 ? '+' : '−'}${fmt(Math.abs(v.insNet[i]))}` : `INS ${fmt(v.insAmt[i])}`) : '';
    ib.classList.toggle('on', !!ib.textContent);
    ib.classList.toggle('lost', v.phase === 'settled' && insTaken && v.insNet && v.insNet[i] < 0);
    const rs = hn.querySelector('.res');
    rs.className = 'res' + (r ? ' ' + r.out : '');
    rs.textContent = r ? (r.out === 'bust' ? '' : (r.even ? 'EVEN MONEY' : { win: 'WIN', lose: 'LOSE', push: 'PUSH', blackjack: 'BLACKJACK' }[r.out]) + ' ') + (r.net ? `${r.net > 0 ? '+' : '−'}${fmt(Math.abs(r.net))}` : '') : '';
    rs.textContent = rs.textContent.trim();
    hn.className = 'hand' + (r ? ' ' + r.out : '') + (active && v.turn.hand === k ? ' cur' : '');
  });

  // bet row (betting phase only)
  const br = node.querySelector('.betrow');
  const sig = v.phase === 'betting' ? `${s.bet}` : '';
  if (br._sig !== sig) {
    br._sig = sig;
    if (v.phase !== 'betting') br.innerHTML = '';
    else if (s.bet == null) br.innerHTML = `<span class="txt">${ic('sp-3-dots-bounce', 'dots')}Thinking</span>`;
    else {
      br.innerHTML = `<div class="chip big ${chipClass(s.bet)} drop"><span>${short(s.bet)}</span></div><span class="txt">Bet locked</span>`;
      if (!S.instant && (!prev || prev.seats[i]?.bet == null)) {
        sfx.chip();
        const ch = br.firstElementChild, src = centerOf(node.querySelector('.bal .coin')), dst = centerOf(ch);
        ch.style.setProperty('--cx', (src.x - dst.x) + 'px'); ch.style.setProperty('--cy', (src.y - dst.y) + 'px');
      }
    }
  }

  // floating net
  if (v.phase === 'settled' && v.results && (!prev || prev.phase !== 'settled')) {
    const net = (v.results[i] || []).reduce((a, r) => a + r.net, 0);
    const f = node.querySelector('.float');
    f.className = 'float'; void f.offsetWidth;
    f.textContent = net === 0 ? 'PUSH' : (net > 0 ? '+' : '−') + fmt(Math.abs(net));
    f.classList.add(net > 0 ? 'up' : net < 0 ? 'down' : 'up', 'go');
    if (net !== 0) {
      const stake = (v.hands[i] || []).reduce((q, h) => q + h.bet, 0) || 1;
      const n = Math.max(3, Math.min(8, Math.round(Math.abs(net) / stake * 3) + 2));
      const pot = modeOf(v) === 'showdown' ? $('#felt') : $('#dealerCards');
      const coin = node.querySelector('.bal .coin');
      if (net > 0) flyCoins(pot, coin, n); else flyCoins(coin, pot, Math.min(n, 4));
    }
  }
}

function renderSeatPoker(i, v, prev, node, s) {
  const pk = v.poker, inHand = !!pk.inHand[i], folded = !!pk.folded[i];
  node.classList.remove('multi');
  node.classList.toggle('fold', inHand && folded);
  node.classList.toggle('allin', inHand && !folded && !!pk.allin[i]);
  const tags = [];
  if (inHand) { if (pk.button === i) tags.push('D'); if (pk.sbSeat === i) tags.push('SB'); else if (pk.bbSeat === i) tags.push('BB'); }
  const pos = node.querySelector('.pos');
  pos.textContent = tags.join('·'); pos.dataset.k = tags[0] || '';

  // hole cards
  const box = node.querySelector('.hands');
  while (box.children.length > 1) box.lastChild.remove();
  let hn = box.children[0];
  if (!hn) {
    hn = document.createElement('div'); hn.className = 'hand';
    hn.innerHTML = '<div class="cards"></div><div class="hmeta"><span class="total"></span><span class="hbet"><i class="coin"></i><b></b></span><span class="insb"></span><span class="res"></span></div>';
    box.appendChild(hn);
  }
  const cards = hn.querySelector('.cards');
  if (node._round !== v.round) { cards.innerHTML = ''; node._round = v.round; }
  const ord = []; for (let k = 1; k <= NSEATS; k++) { const x = (pk.button + k) % NSEATS; if (pk.inHand[x]) ord.push(x); }
  const np = Math.max(1, ord.length), posIdx = Math.max(0, ord.indexOf(i));
  syncCards(cards, inHand ? pk.hole[i] || [] : [], (ci) => (ci * np + posIdx) * DEAL_GAP * 0.7);
  const r = v.phase === 'settled' && pk.res ? pk.res[i] : null;
  const rs = hn.querySelector('.res');
  const cls = r ? (r.folded ? 'lose' : r.net > 0 ? 'win' : r.net < 0 ? 'lose' : 'push') : '';
  rs.className = 'res' + (cls ? ' ' + cls : '');
  rs.textContent = r && inHand ? ((r.hand ? r.hand.toUpperCase() : r.folded ? 'FOLDED' : '') + (r.net ? ` ${r.net > 0 ? '+' : '−'}${fmt(Math.abs(r.net))}` : '')).trim() : '';
  hn.className = 'hand' + (cls ? ' ' + cls : '');

  // street bet + last action
  const br = node.querySelector('.betrow');
  const b = inHand && v.phase === 'poker' ? pk.bet[i] : 0;
  const last = inHand && v.phase === 'poker' ? pk.last[i] || '' : '';
  const sig = `p|${v.round}|${b}|${last}`;
  if (br._sig !== sig) {
    const had = br._pb || 0;
    if (!S.instant && had > 0 && b === 0 && prev && prev.round === v.round && v.phase === 'poker' && !folded) flyCoins(br, $('#dealerCards'), 3);
    br._sig = sig; br._pb = b;
    br.innerHTML = (b > 0 ? `<span class="pkbet"><i class="coin"></i>${fmt(b)}</span>` : '') + (last ? `<span class="pklast ${last.toLowerCase().replace(/[^a-z]/g, '')}">${last.toUpperCase()}</span>` : '');
    if (!S.instant && b > had) { sfx.chip(); flyCoins(node.querySelector('.bal .coin'), br, 2); }
  }

  // floating net + coins to the winner
  if (v.phase === 'settled' && r && inHand && !(r.folded && !r.net) && (!prev || prev.phase !== 'settled')) {
    const net = r.net, f = node.querySelector('.float');
    f.className = 'float'; void f.offsetWidth;
    f.textContent = net === 0 ? 'SPLIT' : (net > 0 ? '+' : '−') + fmt(Math.abs(net));
    f.classList.add(net < 0 ? 'down' : 'up', 'go');
    const coin = node.querySelector('.bal .coin'), potEl = $('#dealerCards');
    if (net > 0) flyCoins(potEl, coin, 6); else if (net < 0) flyCoins(coin, potEl, 3);
  }
}

function renderBanner(v) {
  if (isPk(v)) return renderBannerPoker(v);
  const showdown = modeOf(v) === 'showdown';
  const nameOf = (i) => (v.seats[i] ? v.seats[i].name : '—');
  const me = v.you.seat >= 0 ? v.seats[v.you.seat] : null;
  const inRound = !!(me && me.alive);
  let t = '', sub = '', cls = '', icon = '';
  if (v.phase === 'betting') {
    t = 'PLACE YOUR BETS'; icon = 'coins';
    if (modeOf(v) === 'tournament') sub = `Level ${v.limits.level + 1} · bets ${fmt(v.limits.min)}–${fmtMax(v.limits.max)}`;
  } else if (v.phase === 'playing' && v.turn) {
    const mine = v.turn.seat === v.you.seat;
    t = mine ? 'YOUR MOVE' : `${nameOf(v.turn.seat).toUpperCase()}'S MOVE`;
    if (mine) cls = 'mine';
    if (v.hands[v.turn.seat].length > 1) sub = `Hand ${v.turn.hand + 1} of ${v.hands[v.turn.seat].length}`;
    else if (!mine && inRound && !(v.hands[v.you.seat] || []).every((h) => h.done)) { // how many players until it is your turn
      const ord = dealOrder(v), k = ord.indexOf(v.you.seat) - ord.indexOf(v.turn.seat);
      if (k > 0) sub = `You're ${k + 1}${['', '', 'nd', 'rd'][k + 1] || 'th'}`;
    }
  } else if (v.phase === 'playing') t = showdown ? 'SHOWDOWN…' : 'DEALER CHECKS…';
  else if (v.phase === 'dealer') { t = 'DEALER PLAYS'; icon = 'sp-bars-scale-middle'; }
  else if (v.phase === 'settled' && v.results) {
    const idx = [...Array(NSEATS).keys()].filter((i) => (v.results[i] || []).length);
    const nets = {}; for (const i of idx) nets[i] = v.results[i].reduce((a, r) => a + r.net, 0);
    const f = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
    if (inRound && nets[v.you.seat] != null) { const n = nets[v.you.seat]; t = n > 0 ? `YOU WIN ${f(n)}` : n < 0 ? `YOU LOSE ${f(n)}` : 'PUSH'; cls = n > 0 ? 'pos' : n < 0 ? 'neg' : ''; icon = n > 0 ? 'trophy' : n < 0 ? 'trending-down' : 'equal'; }
    else if (idx.length <= 2) t = idx.map((i) => `${nameOf(i)} ${f(nets[i])}`).join('  ·  ');
    else t = `ROUND ${v.round} COMPLETE`;
    if (v.over) sub = 'Final round';
  }
  const b = $('#banner'), key = t + '|' + sub + '|' + icon;
  if (b._k !== key) {
    b._k = key; b.className = 'banner ' + cls; b.textContent = t;
    if (icon) b.insertAdjacentHTML('afterbegin', ic(icon, 'bn-ic'));
    if (sub) { const s = document.createElement('small'); s.textContent = sub; b.appendChild(s); }
    void b.offsetWidth; b.classList.add('pop');
  }
}

function renderBannerPoker(v) {
  const pk = v.poker, nameOf = (i) => (v.seats[i] ? v.seats[i].name : '—');
  const me = v.you.seat, f = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
  let t = '', sub = '', cls = '', icon = '';
  if (v.phase === 'poker') {
    if (pk.to >= 0) { t = pk.to === me ? 'YOUR MOVE' : `${nameOf(pk.to).toUpperCase()}'S MOVE`; sub = STREET[pk.street] || ''; }
    else { t = 'ALL IN'; icon = 'sp-bars-scale-middle'; sub = 'Running it out'; }
  } else if (v.phase === 'settled' && pk.res) {
    const ids = [...Array(NSEATS).keys()].filter((i) => pk.res[i]);
    const winners = ids.filter((i) => pk.res[i].net > 0).sort((a, b) => pk.res[b].net - pk.res[a].net);
    const mine = me >= 0 && pk.res[me] ? pk.res[me] : null;
    if (mine && mine.net > 0) { t = `YOU WIN ${f(mine.net)}`; cls = 'pos'; icon = 'trophy'; sub = mine.hand || 'Everyone folded'; }
    else if (winners.length) { const w = winners[0]; t = `${nameOf(w).toUpperCase()} WINS ${fmt(pk.res[w].net)}`; sub = pk.res[w].hand || 'Everyone folded'; if (mine && mine.net < 0) cls = 'neg'; }
    else t = `HAND ${v.round} COMPLETE`;
    if (v.over) sub += (sub ? ' · ' : '') + 'Final hand';
  }
  const b = $('#banner'), key = t + '|' + sub + '|' + icon;
  if (b._k !== key) {
    b._k = key; b.className = 'banner ' + cls; b.textContent = t;
    if (icon) b.insertAdjacentHTML('afterbegin', ic(icon, 'bn-ic'));
    if (sub) { const s2 = document.createElement('small'); s2.textContent = sub; b.appendChild(s2); }
    void b.offsetWidth; b.classList.add('pop');
  }
}

/* =====================================================================
   dock (bets / actions)
   ===================================================================== */
const dock = {
  bet: $('#dockBet'), play: $('#dockPlay'), poker: $('#dockPoker'), ins: $('#dockIns'), wait: $('#dockWait'), next: $('#dockNext'), spec: $('#dockSpec'),
};
const fmtMax = (n) => (n >= 1e9 ? '∞' : fmt(n));
const betCap = (v) => { const me = v.seats[v.you.seat]; return me && me.alive ? Math.min(v.limits.max, me.balance) : 0; };

function renderChips(v) {
  const cap = betCap(v), min = v.limits.min;
  const sig = `${cap}|${min}`;
  if (S.sig.chips === sig) { updateChipState(v); return; }
  S.sig.chips = sig;
  const list = DENOMS.filter((d) => d <= cap && d >= min / 2).slice(0, 7);
  const row = $('#chipRow'); row.innerHTML = '';
  for (const d of list) {
    const b = document.createElement('button');
    b.className = `chip ${chipClass(d)}`; b.dataset.v = d; b.innerHTML = `<span>${short(d)}</span>`;
    b.addEventListener('click', () => { S.allIn = false; S.pending = Math.min(cap, S.pending + d); sfx.chip(); updateChipState(S.view); });
    row.appendChild(b);
  }
  updateChipState(v);
}
function updateChipState(v) {
  const cap = betCap(v), min = v.limits.min, me = v.seats[v.you.seat];
  if (S.allIn && me && me.alive && me.balance > 0) S.pending = me.balance; // all in ignores the table max
  else { S.allIn = false; S.pending = Math.max(0, Math.min(cap, S.pending)); }
  $('#betAmt').textContent = S.allIn ? `${fmt(S.pending)} · ALL IN` : fmt(S.pending);
  $('#bAllIn').classList.toggle('on', !!S.allIn);
  $('#bAllIn').disabled = !(me && me.alive && me.balance > 0);
  $$('#chipRow .chip').forEach((c) => (c.disabled = S.allIn || S.pending + +c.dataset.v > cap));
  $('#placeBet').disabled = S.allIn ? false : S.pending < min || S.pending > cap;
  $('#bLast').disabled = !(v.seats[v.you.seat] && v.seats[v.you.seat].lastBet);
}
function placeBet() {
  const v = S.view;
  if (!v || $('#placeBet').disabled || !dock.bet.classList.contains('on')) return;
  act('bet', { amount: S.pending });
  S.allIn = false;
}
$('#placeBet').addEventListener('click', placeBet);
$('#bClear').addEventListener('click', () => { S.allIn = false; S.pending = 0; updateChipState(S.view); });
$('#bHalf').addEventListener('click', () => { S.allIn = false; S.pending = Math.max(S.view.limits.min, Math.floor(S.pending / 2)); updateChipState(S.view); });
$('#bDouble').addEventListener('click', () => { S.allIn = false; S.pending = S.pending * 2 || S.view.limits.min; updateChipState(S.view); });
$('#bMax').addEventListener('click', () => { S.allIn = false; S.pending = betCap(S.view); sfx.chip(); updateChipState(S.view); });
$('#bAllIn').addEventListener('click', () => { S.allIn = !S.allIn; if (S.allIn) sfx.chip(); updateChipState(S.view); });
$('#bLast').addEventListener('click', () => { S.allIn = false; const me = S.view.seats[S.view.you.seat]; S.pending = me.lastBet; updateChipState(S.view); });

const playBtn = { hit: $('#aHit'), stand_hand: $('#aStand'), double: $('#aDouble'), split: $('#aSplit') };
let acting = false;
async function doAction(type) {
  if (acting) return;
  const v = S.view;
  if (!v || !v.legal) return;
  const key = type === 'stand_hand' ? 'stand' : type;
  if (!v.legal[key]) return;
  acting = true;
  Object.values(playBtn).forEach((b) => (b.disabled = true));
  try { await act(type); } finally { acting = false; if (S.view) renderDock(S.view); }
}
playBtn.hit.addEventListener('click', () => doAction('hit'));
playBtn.stand_hand.addEventListener('click', () => doAction('stand_hand'));
playBtn.double.addEventListener('click', () => doAction('double'));
playBtn.split.addEventListener('click', () => doAction('split'));
$('#nextBtn').addEventListener('click', () => act('next'));

/* poker controls */
const pkEl = { fold: $('#pkFold'), call: $('#pkCall'), go: $('#pkGo'), range: $('#pkRange'), amt: $('#pkAmt'), raise: $('#pkRaise'), presets: $('#pkPresets') };
const pkState = { key: '', to: 0 };
const pkClamp = (lg, n) => (lg.raise ? Math.max(lg.raise.min, Math.min(lg.raise.max, Math.round(n) || 0)) : 0);
function pkSetTo(v, n) {
  const lg = v.poker.legal; if (!lg || !lg.raise) return;
  pkState.to = pkClamp(lg, n);
  pkEl.amt.value = pkState.to; pkEl.range.value = pkState.to;
  const all = pkState.to >= lg.raise.max;
  pkEl.go.innerHTML = all ? `${ic('chevrons-up')}All in <b>${fmt(pkState.to)}</b>` : `${ic('chevrons-up')}${v.poker.cur > 0 ? 'Raise to' : 'Bet'} <b>${fmt(pkState.to)}</b><kbd>R</kbd>`;
  pkEl.go.classList.toggle('allin', all);
}
function renderPokerDock(v) {
  const pk = v.poker, lg = pk.legal, me = v.you.seat;
  const cd = v.seats[me];
  pkEl.fold.disabled = pkEl.call.disabled = pkEl.go.disabled = acting;
  pkEl.call.innerHTML = lg.check ? `${ic('check')}Check <kbd>C</kbd>` : lg.call >= cd.balance ? `${ic('check')}Call all-in <b>${fmt(lg.call)}</b><kbd>C</kbd>` : `${ic('check')}Call <b>${fmt(lg.call)}</b><kbd>C</kbd>`;
  pkEl.raise.classList.toggle('hidden', !lg.raise);
  if (!lg.raise) return;
  const key = `${v.round}|${pk.street}|${pk.cur}|${pk.bet[me]}`;
  pkEl.range.min = lg.raise.min; pkEl.range.max = lg.raise.max;
  pkEl.range.disabled = pkEl.amt.disabled = lg.raise.min >= lg.raise.max;
  pkEl.amt.min = lg.raise.min; pkEl.amt.max = lg.raise.max;
  if (pkState.key !== key) { pkState.key = key; pkSetTo(v, lg.raise.min); } else pkSetTo(v, pkState.to);
}
pkEl.range.addEventListener('input', () => S.view && pkSetTo(S.view, +pkEl.range.value));
pkEl.amt.addEventListener('change', () => S.view && pkSetTo(S.view, +pkEl.amt.value));
pkEl.presets.addEventListener('click', (e) => {
  const b = e.target.closest('[data-p]'); const v = S.view;
  if (!b || !v || !isPk(v) || !v.poker.legal || !v.poker.legal.raise) return;
  const lg = v.poker.legal, me = v.you.seat, pk = v.poker, p = b.dataset.p;
  if (p === 'min') return pkSetTo(v, lg.raise.min);
  if (p === 'max') return pkSetTo(v, lg.raise.max);
  const toCall = pk.cur - pk.bet[me];
  pkSetTo(v, pk.cur + (pk.pot + toCall) * +p);
});
async function pkAct(type, extra) {
  if (acting) return;
  const v = S.view;
  if (!v || !isPk(v) || !v.poker.legal) return;
  const lg = v.poker.legal;
  if (type === 'check' && !lg.check) type = 'call';
  if (type === 'call' && lg.check) type = 'check';
  if (type === 'raise' && !lg.raise) return;
  acting = true; pkEl.fold.disabled = pkEl.call.disabled = pkEl.go.disabled = true;
  try { await act(type, extra); } finally { acting = false; if (S.view) renderDock(S.view); }
}
pkEl.fold.addEventListener('click', () => pkAct('fold'));
pkEl.call.addEventListener('click', () => pkAct('call'));
pkEl.go.addEventListener('click', () => pkAct('raise', { to: pkState.to }));

function setDock(which, text) {
  document.body.dataset.dock = which;
  for (const k of Object.keys(dock)) dock[k].classList.toggle('on', k === which);
  if (which === 'wait') $('#waitTxt').textContent = text || '';
  if (which === 'spec') $('#specTxt').textContent = text || '';
}

function renderDock(v) {
  const me = v.you.seat, seated = me >= 0, mine = seated ? v.seats[me] : null;
  const playing = !!(mine && mine.alive); // seated and still in the match
  const live = ['betting', 'playing', 'dealer', 'poker', 'arcade', 'settled'].includes(v.phase);
  $('#dock').classList.toggle('hidden', v.phase === 'lobby' || v.phase === 'over' || isArc(v));
  if (isArc(v)) document.body.dataset.dock = 'none';
  $('#arena').classList.toggle('frozen', !!v.paused);
  $('#forfeitBtn').classList.toggle('hidden', !(playing && ['betting', 'playing', 'dealer', 'poker', 'arcade'].includes(v.phase)));
  $('#dock').classList.toggle('frozen', !!v.paused);
  $('#dock').classList.toggle('idle', v.phase === 'playing' && !v.legal && playing);
  $('#pauseBtn').classList.toggle('hidden', !(v.you.host && live && !v.over && !v.paused));
  $('#pauseOv').classList.toggle('hidden', !v.paused);
  if (v.paused) {
    $('#pauseTxt').textContent = v.you.host ? 'Timers are stopped. Resume when everyone is ready.' : `${v.paused.name} paused the match. Waiting for the host to resume.`;
    $('#resumeBtn').classList.toggle('hidden', !v.you.host);
  }
  if (!live || isArc(v)) return;
  const specTxt = seated ? 'You are out of chips. Spectating.' : 'You are spectating.';

  if (v.phase === 'poker') {
    const pk = v.poker, nm = (i) => (v.seats[i] ? v.seats[i].name : '…');
    if (pk.legal && pk.to === me) { setDock('poker'); renderPokerDock(v); }
    else if (playing && pk.folded[me]) setDock('wait', pk.to >= 0 ? `You folded. ${nm(pk.to)} is acting…` : 'You folded. Waiting for the hand to finish…');
    else if (playing && pk.allin[me] && pk.to < 0) setDock('wait', 'You are all in. Running it out…');
    else if (pk.to >= 0) setDock(playing ? 'wait' : 'spec', playing ? `${nm(pk.to)} is thinking…` : `${nm(pk.to)} is thinking. ${specTxt}`);
    else setDock(playing ? 'wait' : 'spec', 'Running out the board…');
    return;
  }

  if (v.phase === 'betting') {
    if (playing && mine.bet == null) {
      if (S.betRound !== v.round) {
        S.betRound = v.round; S.sig.chips = '';
        const cap = betCap(v);
        S.allIn = false; S.pending = Math.min(cap, Math.max(v.limits.min, mine.lastBet || v.limits.min));
      }
      renderChips(v);
      setDock('bet');
    } else if (playing) {
      const n = v.seats.filter((s) => s && s.alive && s.bet == null).length;
      setDock('wait', n ? `Bet locked. Waiting for ${n} more player${n > 1 ? 's' : ''}…` : 'Dealing…');
    } else setDock('spec', 'Betting is open. ' + specTxt);
  } else if (v.phase === 'playing') {
    if (v.insYou && !v.insYou.done) {
      const bet = (v.hands[me] && v.hands[me][0] && v.hands[me][0].bet) || 0;
      $('#insTitle').textContent = v.insYou.even ? 'Even money?' : 'Insurance?';
      $('#insSub').textContent = v.insYou.even ? 'You have blackjack and the dealer shows an Ace. Take a sure 1:1 instead of risking a push.' : 'Dealer shows an Ace. Insure up to half your bet, pays 2:1 on a dealer blackjack.';
      $('#insYes').innerHTML = v.insYou.even ? `${ic('check')}Even money <b>+${fmt(bet)}</b>` : `${ic('shield')}Insure <b>${fmt(v.insYou.max)}</b>`;
      setDock('ins');
    } else if (v.ins) {
      setDock(playing ? 'wait' : 'spec', 'Waiting for insurance decisions…');
    } else if (v.legal) {
      setDock('play');
      playBtn.hit.disabled = acting; playBtn.stand_hand.disabled = acting;
      playBtn.double.disabled = acting || !v.legal.double; playBtn.split.disabled = acting || !v.legal.split;
      playBtn.split.classList.toggle('hidden', modeOf(v) === 'showdown');
    } else if (v.turn) {
      const nm = v.seats[v.turn.seat] ? v.seats[v.turn.seat].name : '…';
      if (playing && phoneUI.matches) { // phones: keep the action buttons in place, dimmed, until it is your turn
        setDock('play'); Object.values(playBtn).forEach((b) => (b.disabled = true));
        playBtn.split.classList.toggle('hidden', modeOf(v) === 'showdown');
      } else if (playing) setDock('wait', `${nm} is playing…`); else setDock('spec', `${nm} is playing. ${specTxt}`);
    } else setDock(playing ? 'wait' : 'spec', modeOf(v) === 'showdown' ? 'Showdown…' : 'Dealer is checking for blackjack…');
  } else if (v.phase === 'dealer') setDock(playing ? 'wait' : 'spec', 'Dealer plays…');
  else if (v.phase === 'settled') {
    if (playing) {
      setDock('next');
      const voted = mine.voted;
      $('#nextBtn').disabled = voted || !!v.over;
      $('#nextBtn').innerHTML = voted ? ic('sp-3-dots-fade') + 'Waiting for others' : (isPk(v) ? 'Next hand' : 'Next round') + ic('arrow-right') + '<kbd>↵</kbd>';
      $('#nextBtn').classList.toggle('hidden', !!v.over);
    } else setDock('spec', v.over ? 'Match is ending…' : isPk(v) ? 'Next hand starting soon…' : 'Next round starting soon…');
  }
}

/* =====================================================================
   lobby + settings + over
   ===================================================================== */
const setIds = { wheel: '#sWheel', bots: '#sBots', sb: '#sSb', levelEvery: '#sLevel', startingBalance: '#sBalance', minBet: '#sMin', maxBet: '#sMax', decks: '#sDecks', payout: '#sPayout', maxRounds: '#sRounds', blindEvery: '#sBlind', betTime: '#sBetTime', actionTime: '#sActTime' };
function collectSettings(over = {}) {
  return {
    game: S.view ? S.view.settings.game || 'blackjack' : 'blackjack', wheel: $('#sWheel').value, sb: +$('#sSb').value, bots: +$('#sBots').value, levelEvery: +$('#sLevel').value,
    mode: S.view && !['poker', ...ARC].includes(S.view.settings.game) ? S.view.settings.mode : 'duel', blitz: $('#sBlitz').checked,
    startingBalance: +$('#sBalance').value, minBet: +$('#sMin').value, maxBet: +$('#sMax').value, maxBetMode: (S.view && S.view.settings.maxBetMode) || 'auto',
    decks: +$('#sDecks').value, payout: +$('#sPayout').value, h17: $('#sH17').value === '1',
    maxRounds: +$('#sRounds').value, blindEvery: +$('#sBlind').value, betTime: +$('#sBetTime').value, actionTime: +$('#sActTime').value,
    ...over,
  };
}
// typing your own max bet switches to Custom
$('#sMax').addEventListener('change', () => act('settings', { settings: collectSettings({ maxBetMode: 'manual' }) }));
$('#maxSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b && !b.disabled && S.view && S.view.settings.maxBetMode !== b.dataset.m) act('settings', { settings: collectSettings({ maxBetMode: b.dataset.m }) }); });
$$('#settings input:not(#sMax), #settings select').forEach((el) => el.addEventListener('change', () => act('settings', { settings: collectSettings() })));
$$('#balPresets button').forEach((b) => b.addEventListener('click', () => { $('#sBalance').value = b.dataset.v; act('settings', { settings: collectSettings() }); }));
$('#gameSel').addEventListener('click', (e) => { const b = e.target.closest('[data-game]'); if (b && !b.disabled && S.view && (S.view.settings.game || 'blackjack') !== b.dataset.game) act('settings', { settings: collectSettings({ game: b.dataset.game }) }); });
$('#modeSel').innerHTML = Object.entries(MODES).filter(([id]) => id !== 'holdem' && !ARC.includes(id)).map(([id, m]) => `<button type="button" data-mode="${id}">${ic(m.icon)}<span>${m.label}</span></button>`).join('');
$('#modeSel').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b && !b.disabled && S.view && S.view.settings.mode !== b.dataset.mode) act('settings', { settings: collectSettings({ mode: b.dataset.mode }) }); });

function renderLobby(v) {
  const on = v.phase === 'lobby';
  $('#lobby').classList.toggle('on', on);
  if (!on) return;
  const seated = v.you.seat >= 0, md = v.mode, st = v.settings, isHost = v.you.host, open = v.open;
  // the host sets the table up first, then opens it; only then can anyone pick a seat
  $('#lobbyTitle').textContent = !open && isHost ? 'Set up your table' : 'Table setup';
  $('#hostLine').innerHTML = v.host ? `${ic('crown')}<span>Host: <b>${esc(v.host.name)}</b>${isHost ? ' (you)' : ''}${open ? '' : isHost ? '' : ' is setting up the table…'}</span>` : '';
  $('#lobbySeats').classList.toggle('hidden', !open);
  $('#settings').classList.toggle('hidden', !open && !isHost);
  $('#openRow').classList.toggle('hidden', open || !isHost);
  $('#openBtn').innerHTML = `${ic('armchair')}Open the table for seating`;
  $('#settings').classList.toggle('readonly', !isHost);
  // settings values
  const sig = JSON.stringify(st);
  if (S.sig.settings !== sig) {
    S.sig.settings = sig;
    const set = (sel, val) => { const el = $(sel); if (document.activeElement !== el) el.value = String(val); };
    for (const [k, sel] of Object.entries(setIds)) set(sel, st[k]);
    set('#sH17', st.h17 ? '1' : '0');
    $$('#maxSeg button').forEach((b) => b.classList.toggle('on', b.dataset.m === st.maxBetMode));
    $('#sMax').classList.toggle('hidden', st.maxBetMode === 'unlimited');
    $('#maxNote').classList.toggle('hidden', st.maxBetMode !== 'unlimited');
    $('#sBlitz').checked = !!st.blitz;
    $$('#modeSel button').forEach((b) => b.classList.toggle('on', b.dataset.mode === st.mode));
    $('#modeDesc').textContent = (MODES[st.mode] || MODES.duel).desc;
    $('#settings').dataset.mode = st.mode;
    $$('#gameSel button').forEach((b) => b.classList.toggle('on', b.dataset.game === (st.game || 'blackjack')));
    $('#lblRounds').textContent = st.game === 'poker' ? 'Hands' : UNIT[st.game] ? UNIT[st.game][1][0].toUpperCase() + UNIT[st.game][1].slice(1) : 'Rounds';
    $('#sRounds').options[0].textContent = st.mode === 'duel' || st.mode === 'solo' ? 'Until broke' : 'Until one left';
  }
  $$('#settings input, #settings select, #balPresets button, #modeSel button, #gameSel button').forEach((el) => (el.disabled = !isHost));
  $('#sMax').disabled = !isHost || st.maxBetMode !== 'manual';
  $$('#maxSeg button').forEach((b) => (b.disabled = !isHost));
  $('#sBetTime').disabled = $('#sActTime').disabled = !isHost || st.blitz;
  // seats
  const lsig = JSON.stringify([v.seats.map((s) => s && [s.id, s.ready, s.online]), v.you.seat, md.max, st.mode, st.game]);
  if (S.sig.lobby !== lsig) {
    S.sig.lobby = lsig;
    const n = md.max, spread = [1, 1, .55, .7, .85, 1][n] ?? 1;
    const at = (i) => { const t = Math.PI * (i + .5) / n; return `--x:${(50 - 44 * spread * Math.cos(t)).toFixed(1)}%;--y:${(2 + 56 * Math.sin(t)).toFixed(1)}%;`; };
    $('#lobbySeats').dataset.n = n;
    $('#lobbySeats').innerHTML = `<div class="arc-dealer">${st.game === 'poker' ? "TEXAS HOLD'EM" : ARC.includes(st.game) ? MODES[st.game].label.toUpperCase() : st.mode === 'showdown' ? 'SHOWDOWN · NO DEALER' : 'DEALER'}</div>` + Array.from({ length: n }, (_, i) => {
      const s = v.seats[i];
      if (!s) return `<div class="lseat" data-s="${i}" style="${at(i)}--c:var(--s${i})"><span class="avatar" style="opacity:.3;--c:var(--dim)">?</span><div class="st">Seat ${i + 1}</div><button class="btn primary sm" data-act="sit" data-seat="${i}">${ic('armchair')}${seated ? 'Move here' : 'Take seat'}</button></div>`;
      const mine = v.you.seat === i;
      return `<div class="lseat${s.ready ? ' ready' : ''}" data-s="${i}" style="${at(i)}--c:${colorOf(s.name, i)}">${avatar(s.name, i)}<b>${esc(s.name)}${mine ? ' (you)' : ''}</b>
        <div class="st">${!s.online ? 'Offline' : s.ready ? 'Ready ✓' : 'Not ready'}</div>
        </div>`;
    }).join('');
  }
  // my own controls live under the table (keeps the seats on the curve compact)
  const me = v.seats[v.you.seat];
  $('#lobbyMine').classList.toggle('hidden', !(open && me));
  if (open && me) $('#lobbyMine').innerHTML = `<button class="btn ${me.ready ? '' : 'primary'}" data-act="ready" data-val="${me.ready ? 0 : 1}">${me.ready ? 'Cancel ready' : ic('check') + 'Ready up'}</button><button class="btn ghost" data-act="stand">Stand up</button><button class="btn ghost" data-act="profile">${ic('palette')}Avatar</button>`;
  const seatedN = v.seats.filter(Boolean).length, readyN = v.seats.filter((s) => s && s.ready).length;
  const nBots = st.game === 'poker' ? Math.max(0, Math.min(st.bots || 0, md.max - seatedN)) : 0;
  const need = md.min - seatedN - nBots;
  if (!open) { $('#lobbyFoot').textContent = isHost ? 'Pick the game and rules, then open the table. Players choose their seats once it is open.' : `Waiting for ${v.host ? v.host.name : 'the host'} to set up the table…`; return; }
  const range = md.min === md.max ? `${md.min}` : `${md.min}–${md.max}`;
  const botNote = nBots ? ` ${nBots} computer player${nBots > 1 ? 's' : ''} will fill the empty seats.` : '';
  const foot = need > 0 ? `${md.label} needs ${range} players. Waiting for ${need} more to take a seat. Everyone else spectates.` :
    v.canStart ? 'Starting…' :
    seated ? `${readyN}/${seatedN} ready. Everyone hits Ready to start. Changing a setting un-readies everyone.` :
    seatedN >= md.max ? 'Table is full. You are watching.' : `${readyN}/${seatedN} ready. Take a seat to play, or just watch.`;
  $('#lobbyFoot').textContent = foot + (need <= 0 && !v.canStart ? botNote : '');
}
$('#openBtn').addEventListener('click', () => act('open'));
const lobbyClick = (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'sit') act('sit', { seat: +b.dataset.seat });
  else if (b.dataset.act === 'ready') act('ready', { value: b.dataset.val === '1' });
  else if (b.dataset.act === 'stand') act('stand');
  else if (b.dataset.act === 'profile') openProfile();
};
$('#lobbySeats').addEventListener('click', lobbyClick);
$('#lobbyMine').addEventListener('click', lobbyClick);

/* ---- avatar editor ---- */
const PF = { color: null, icon: null };
function openProfile() {
  const cur = PROF[S.name] || {};
  PF.color = cur.color || null; PF.icon = cur.icon || null; S.pfTab = null;
  $('#pfColors').innerHTML = COLORS.map((c) => `<button type="button" class="sw" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('') +
    `<label class="sw custom" title="Custom color">${ic('plus')}<input type="color" id="pfCustom" value="${PF.color || '#38bdf8'}"></label>`;
  PF.tab = PF.icon && PF.icon.includes(':') ? PF.icon.split(':')[0] : '';
  $('#pfTabs').innerHTML = CHAR_STYLES.map(([k, l]) => `<button type="button" class="tab" data-t="${k}">${l}</button>`).join('');
  $('#profile').classList.add('on');
  paintProfile();
}
function paintIcons() {
  const t = PF.tab;
  $('#pfIcons').className = 'icons' + (t ? ' chars' : '');
  $('#pfIcons').innerHTML = t
    ? Array.from({ length: 16 }, (_, n) => `<button type="button" class="ib" data-i="${t}:${n}">${iconHtml(t + ':' + n)}</button>`).join('')
    : `<button type="button" class="ib" data-i="">${esc((S.name[0] || '?').toUpperCase())}</button>` + ICONS.map((n) => `<button type="button" class="ib" data-i="${n}">${ic(n)}</button>`).join('');
}
function paintProfile() {
  const c = PF.color || colorOf(S.name, S.view && S.view.you.seat);
  $('#pfPrev').setAttribute('style', `--c:${c};--fg:${fgFor(c)}`); $('#pfIcons').style.setProperty('--pfc', c);
  $('#pfPrev').innerHTML = PF.icon ? iconHtml(PF.icon) : esc((S.name[0] || '?').toUpperCase());
  $$('#pfTabs .tab').forEach((b) => b.classList.toggle('sel', b.dataset.t === PF.tab));
  if (S.pfTab !== PF.tab) { S.pfTab = PF.tab; paintIcons(); }
  $$('#pfColors .sw[data-c]').forEach((b) => b.classList.toggle('sel', b.dataset.c === PF.color));
  $$('#pfIcons .ib').forEach((b) => b.classList.toggle('sel', (b.dataset.i || null) === PF.icon));
  const v = S.view, me = v ? v.you.seat : -1;
  const clash = PF.color && v && v.seats.some((x, i) => x && i !== me && PROF[x.name] && PROF[x.name].color === PF.color);
  $('#pfWarn').textContent = clash ? 'Another player already uses this color; whoever sits later falls back to a default color.' : '';
}
$('#profile').addEventListener('click', (e) => {
  if (e.target === $('#profile') || e.target.closest('#pfCancel')) { $('#profile').classList.remove('on'); return; }
  const sw = e.target.closest('.sw[data-c]'), ib = e.target.closest('.ib'), tb = e.target.closest('.tab');
  if (tb) PF.tab = tb.dataset.t;
  else if (sw) PF.color = sw.dataset.c;
  else if (ib) PF.icon = ib.dataset.i || null;
  else if (e.target.closest('#pfReset')) { PF.color = null; PF.icon = null; }
  else if (e.target.closest('#pfSave')) {
    const val = { color: PF.color, icon: PF.icon };
    LS.set('bj.prof', JSON.stringify(val));
    $('#profile').classList.remove('on');
    act('profile', val);
    return;
  } else return;
  paintProfile();
});
$('#profile').addEventListener('input', (e) => { if (e.target.id === 'pfCustom') { PF.color = e.target.value; paintProfile(); } });
$('#meBtn').addEventListener('click', openProfile);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#profile').classList.remove('on'); });

function renderOver(v) {
  const on = v.phase === 'over';
  $('#over').classList.toggle('on', on);
  if (!on) { S.sig.over = ''; return; }
  const o = v.over || { winner: -1, winners: [], ranking: [], reason: '' };
  const rk = o.ranking || [];
  const sig = JSON.stringify([o, v.seats.map((s) => s && [s.id]), v.you.seat, v.round]);
  if (S.sig.over === sig) return;
  S.sig.over = sig;
  const mode = modeOf(v), duel = mode === 'duel', arc = ARC.includes(mode), solo = mode === 'solo' || !!(v.arcade && v.arcade.solo);
  const top = o.winner >= 0 ? rk.find((r) => r.seat === o.winner) : null;
  const title = solo ? (o.winner >= 0 ? 'You finished ahead' : o.reason === 'broke' ? 'Busted out' : o.reason === 'rounds' ? 'Session over' : 'You left the table') : top ? (mode === 'holdem' ? `${esc(top.name)} wins the table` : mode === 'tournament' ? `${esc(top.name)} wins the tournament` : duel || mode === 'showdown' || mode === 'classic' ? `${esc(top.name)} takes the pot` : arc ? `${esc(top.name)} wins the table` : '') : 'Dead heat';
  const reason = solo ? { broke: 'You ran out of chips', rounds: o.winner >= 0 ? 'Round limit reached with a profit' : 'Round limit reached below your starting stack', forfeit: 'You left the table', disconnect: 'You disconnected' }[o.reason] || '' : { broke: duel ? 'Opponent is out of chips' : 'Last player standing', rounds: 'Round limit reached. Highest stack wins', forfeit: duel ? 'Opponent forfeited' : 'Everyone else left', disconnect: duel ? 'Opponent disconnected' : 'Everyone else left' }[o.reason] || '';
  const start = v.settings.startingBalance;
  const stat = (r) => { const sx = v.seats[r.seat]; return sx && sx.name === r.name ? (mode === 'holdem' ? `${v.stats.w[r.seat]} hands won · ${v.stats.l[r.seat]} lost` : arc ? `${v.stats.w[r.seat]} won · ${v.stats.l[r.seat]} lost` : `${v.stats.w[r.seat]}W · ${v.stats.l[r.seat]}L · ${v.stats.p[r.seat]}P · ${v.stats.bj[r.seat]} BJ`) : ''; };
  const body = rk.length <= 2
    ? `<div class="over-stats">${rk.map((r) => { const net = r.balance - start; return `<div class="d${r.place === 1 && o.winner >= 0 ? ' w' : ''}">${avatar(r.name, r.seat, 'sm')} <b style="display:inline">${esc(r.name)}</b><b>${fmt(r.balance)}</b><span class="${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))}</span><div style="color:var(--dim);font-size:12px;margin-top:4px">${stat(r)}</div></div>`; }).join('')}</div>`
    : `<div class="rank-list">${rk.map((r) => { const net = r.balance - start; return `<div class="rk${r.place === 1 && o.winner >= 0 ? ' w' : ''}"><span class="pl">${r.place === 1 ? ic('crown') : place(r.place)}</span>${avatar(r.name, r.seat, 'sm')}<span class="nm"><b>${esc(r.name)}</b><small>${stat(r)}</small></span><span class="bl"><i class="coin"></i>${fmt(r.balance)}</span><span class="nt ${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))}</span></div>`; }).join('')}</div>`;
  const seated = v.you.seat >= 0;
  const open = Array.from({ length: v.mode.max }, (_, i) => i).filter((i) => !v.seats[i]);
  $('#overCard').innerHTML = `<div class="trophy">${ic(o.winner >= 0 ? 'trophy' : 'handshake')}</div><h2>${title || 'Match over'}</h2><div style="color:var(--dim)">${reason} · ${v.round} ${mode === 'holdem' ? 'hand' : UNIT[mode] ? UNIT[mode][0] : 'round'}${v.round === 1 ? '' : 's'}</div>
    ${body}
    ${seated ? '<button class="btn primary big" id="backLobby">Back to lobby (rematch)</button>' : open.length ? '<div class="row" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">' + open.map((i) => `<button class="btn primary" data-sit="${i}">Take seat ${i + 1}</button>`).join('') + '</div>' : '<div style="color:var(--dim)">Waiting for the players…</div>'}`;
  const bl = $('#backLobby'); if (bl) bl.addEventListener('click', () => act('lobby'));
  $$('#overCard [data-sit]').forEach((b) => b.addEventListener('click', () => act('sit', { seat: +b.dataset.sit })));
}

/* =====================================================================
   side panel, rounds, chat
   ===================================================================== */
function renderSide(v) {
  const sig = JSON.stringify([v.seats.map((s) => s && [s.id, s.online, s.balance, s.alive]), v.members.map((m) => m.id), v.you.seat, v.phase, v.settings, v.limits, v.stats, v.series.length, v.open, v.poker && [v.poker.sb, v.poker.bb, v.poker.level]]);
  if (S.sig.side === sig) return;
  S.sig.side = sig;
  const lobbyish = ['lobby', 'over'].includes(v.phase), cap = lobbyish ? v.mode.max : NSEATS;
  const idx = Array.from({ length: cap }, (_, i) => i).filter((i) => v.seats[i] || (lobbyish && v.open));
  $('#sideSeats').innerHTML = !idx.length ? '<div style="color:var(--dim);font-size:12px">Table not open yet</div>' : idx.map((i) => {
    const s = v.seats[i];
    if (!s) return `<div class="sseat empty"><span class="avatar" style="--c:#2a3558;opacity:.5">?</span><div><div class="n">Seat ${i + 1}</div><div class="s">Open</div></div><button class="btn mini primary" data-sit="${i}">Sit</button></div>`;
    const out = !s.alive && v.phase !== 'lobby';
    return `<div class="sseat${out ? ' out' : ''}">${avatar(s.name, i)}<div><div class="n">${esc(s.name)}${v.you.seat === i ? ' <span style="color:var(--dim);font-weight:500">(you)</span>' : ''}</div><div class="s">${out ? '<b class="outtag">OUT</b> · ' : ''}${s.online ? 'Online' : 'Offline'} · ${fmt(s.balance)}</div></div></div>`;
  }).join('');
  $$('#sideSeats [data-sit]').forEach((b) => b.addEventListener('click', () => act('sit', { seat: +b.dataset.sit })));
  const specs = v.members.filter((m) => m.seat < 0);
  $('#specCount').textContent = specs.length;
  $('#specList').innerHTML = specs.length ? specs.map((m) => `<span>${esc(m.name)}</span>`).join('') : '<span style="border-style:dashed">nobody yet</span>';
  $('#onlineCount').textContent = `${v.members.length} online`;
  const st = v.settings, mode = st.mode, lim = v.limits;
  const rules = [`<span class="mode-chip">${ic(MODES[mode].icon)}${MODES[mode].label}</span>`];
  if (st.blitz) rules.push(`<span class="mode-chip blitz">${ic('zap')}Blitz</span>`);
  if (ARC.includes(mode)) {
    if (mode === 'roulette') rules.push(st.wheel === 'american' ? 'American wheel' : 'European wheel');
    if (mode === 'crash') rules.push('1% house edge');
    rules.push(`Bet ${fmt(lim.min)}–${fmtMax(lim.max)}`);
    rules.push(st.maxRounds ? `${st.maxRounds} ${UNIT[mode] ? UNIT[mode][1] : 'rounds'}` : 'Until broke');
  } else if (mode === 'holdem') {
    const sb = v.poker ? v.poker.sb : st.sb, bb = v.poker ? v.poker.bb : st.sb * 2;
    rules.push(`Blinds ${fmt(sb)}/${fmt(bb)}`);
    if (st.levelEvery) rules.push(`Up ×1.5 / ${st.levelEvery} hands`, `Level ${(v.poker ? v.poker.level : 0) + 1}`);
    rules.push(st.maxRounds ? `${st.maxRounds} hands` : 'Until one left');
  } else {
    rules.push(`${st.decks} deck${st.decks > 1 ? 's' : ''}`);
    if (mode !== 'showdown') rules.push(`BJ ${st.payout === 1.5 ? '3:2' : st.payout === 1.2 ? '6:5' : '1:1'}`, st.h17 ? 'H17' : 'S17');
    rules.push(`Bet ${fmt(lim.min)}–${fmtMax(lim.max)}`);
    if (mode === 'tournament') rules.push(`Level ${lim.level + 1}`, `Blinds ×1.5 / ${st.blindEvery} rds`);
    rules.push(st.maxRounds ? `${st.maxRounds} rounds` : mode === 'duel' || mode === 'solo' ? 'Until broke' : 'Until one left');
  }
  $('#rules').innerHTML = rules.map((t) => (t.startsWith('<span') ? t : `<span>${t}</span>`)).join('');
  if (ARC.includes(mode)) { /* the arena replaces the felt text */ } else if (mode === 'holdem') {
    const sb = v.poker ? v.poker.sb : st.sb, bb = v.poker ? v.poker.bb : st.sb * 2;
    $('#ftPay2').textContent = $('#ftPay').textContent = "TEXAS HOLD'EM";
    $('#ftRule2').textContent = $('#ftRule').textContent = `BLINDS ${fmt(sb)} / ${fmt(bb)} · NO LIMIT`;
  } else {
  $('#ftPay2').textContent = $('#ftPay').textContent = mode === 'showdown' ? 'SHOWDOWN · BEST HAND TAKES THE POT' : `BLACKJACK PAYS ${st.payout === 1.5 ? '3 TO 2' : st.payout === 1.2 ? '6 TO 5' : '1 TO 1'}`;
  $('#ftRule2').textContent = $('#ftRule').textContent = mode === 'showdown' ? 'NO DEALER · NATURAL BLACKJACK BEATS 21' : st.h17 ? 'DEALER HITS SOFT 17' : 'DEALER STANDS ON ALL 17s';
  }
  const seatedIdx = v.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
  $('#duel').classList.toggle('cols3', seatedIdx.length > 4);
  $('#duel').innerHTML = (seatedIdx.length ? seatedIdx : [0, 1]).map((i) => { const x = v.seats[i]; return `<div class="d"><small>${x ? esc(x.name) : 'Seat ' + (i + 1)}</small><b style="color:${x ? colorOf(x.name, i) : seatColor(i)}">${v.stats.w[i]} – ${v.stats.l[i]}</b><small>${ARC.includes(mode) ? 'won–lost' : mode === 'holdem' ? `hands won–lost · ${v.stats.p[i]} split` : `W–L · ${v.stats.p[i]} push · ${v.stats.bj[i]} BJ`}</small></div>`; }).join('');
  drawSpark(v);
}
function drawSpark(v) {
  const svg = $('#spark'), ser = v.series;
  if (ser.length < 2) { svg.innerHTML = '<text x="120" y="40" fill="#6e737b" font-size="11" text-anchor="middle">Balance chart appears after round 1</text>'; return; }
  const seatedIdx = v.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
  const all = ser.flatMap((r) => seatedIdx.map((i) => r[i])), lo = Math.min(...all), hi = Math.max(...all), span = Math.max(1, hi - lo);
  const pt = (i, val) => `${(i / (ser.length - 1)) * 228 + 6},${62 - ((val - lo) / span) * 54}`;
  svg.innerHTML = seatedIdx.map((s) => `<polyline fill="none" stroke="${colorOf(v.seats[s].name, s)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${ser.map((r, i) => pt(i, r[s])).join(' ')}"/>`).join('');
}

const mc = (c) => `<span class="mc${isRed(c) ? ' r' : ''}">${c.slice(0, -1)}${SYM[c.slice(-1)]}</span>`;
function renderRounds(v) {
  const sig = (v.game || '') + (v.history.length ? `${v.history.length}:${v.history[v.history.length - 1].r}:${v.history[0].r}` : '0');
  if (S.sig.rounds === sig) return;
  S.sig.rounds = sig;
  $('#rempty').classList.toggle('hidden', v.history.length > 0);
  const label = { win: 'WIN', lose: 'LOSE', push: 'PUSH', bust: 'BUST', blackjack: 'BJ' };
  const pkG = v.game === 'poker', arG = ARC.includes(v.game);
  $('#rhDealer').textContent = arG ? 'Result' : pkG ? 'Board' : 'Dealer'; $('#rhBet').textContent = pkG ? 'Pot' : 'Bet';
  $('#rempty').textContent = pkG ? 'No hands yet. Deal in.' : UNIT[v.game] ? `No ${UNIT[v.game][1]} yet.` : 'No rounds yet. Place a bet.';
  $('#rbody').innerHTML = [...v.history].reverse().map((h) =>
    h.ar ? h.seats.map((s, i) => `<div class="rrow"><span>${i === 0 ? '#' + h.r : ''}</span><span class="pl">${avatar(s.name, s.seat, 'sm')}<span>${esc(s.name)}</span></span>
      <span><span class="o ${s.net > 0 ? 'pos' : s.net < 0 ? 'neg' : ''}">${esc(s.note || '')}</span></span>
      <span>${i === 0 ? `<span class="o">${esc(h.outcome || '')}</span>` : ''}</span>
      <span>${fmt(s.stake)}</span><span class="${s.net > 0 ? 'pos' : s.net < 0 ? 'neg' : ''}"><b>${s.net > 0 ? '+' : s.net < 0 ? '−' : ''}${fmt(Math.abs(s.net))}</b></span></div>`).join('') :
    h.poker ? h.seats.map((s, i) => `<div class="rrow"><span>${i === 0 ? '#' + h.r : ''}</span><span class="pl">${avatar(s.name, s.seat, 'sm')}<span>${esc(s.name)}</span></span>
      <span>${s.folded ? '<span class="o">FOLDED</span>' : (s.cards ? s.cards.map((c) => (c ? mc(c) : '')).join('') : '') + (s.hand ? `<span class="o ${s.net > 0 ? 'pos' : ''}">${esc(s.hand)}</span>` : '')}</span>
      <span>${i === 0 ? (h.board && h.board.length ? h.board.map(mc).join('') : '<span class="o">No flop</span>') : ''}</span>
      <span>${i === 0 ? fmt(h.pot) : ''}</span><span class="${s.net > 0 ? 'pos' : s.net < 0 ? 'neg' : ''}"><b>${s.net > 0 ? '+' : s.net < 0 ? '−' : ''}${fmt(Math.abs(s.net))}</b></span></div>`).join('') :
    h.seats.map((s, i) => {
      const bet = s.hands.reduce((a, x) => a + x.bet, 0);
      return `<div class="rrow"><span>${i === 0 ? '#' + h.r : ''}</span><span class="pl">${avatar(s.name, s.seat, 'sm')}<span>${esc(s.name)}</span></span>
      <span>${s.hands.map((x) => x.cards.map(mc).join('') + `<span class="o ${x.net > 0 ? 'pos' : x.net < 0 ? 'neg' : ''}">${label[x.out]}</span>`).join('<span class="hsep">|</span>')}</span>
      <span>${i === 0 ? (h.dealer ? h.dealer.cards.map(mc).join('') + `<span class="o">${h.dealer.bust ? 'BUST' : h.dealer.total}</span>` : '<span class="o">No dealer</span>') : ''}</span>
      <span>${fmt(bet)}</span><span class="${s.net > 0 ? 'pos' : s.net < 0 ? 'neg' : ''}"><b>${s.net > 0 ? '+' : s.net < 0 ? '−' : ''}${fmt(Math.abs(s.net))}</b></span></div>`;
    }).join('')
  ).join('');
}

/* system events in chat: small pills for presence, cards for matches and rounds */
const WHY = { broke: 'Last one standing', rounds: 'Highest stack after the round limit', forfeit: 'Everyone else left', disconnect: 'Everyone else left' };
const WHY_DUEL = { broke: 'Opponent ran out of chips', rounds: 'Highest stack after the round limit', forfeit: 'Opponent forfeited', disconnect: 'Opponent disconnected' };
function sysNode(m) {
  const d = document.createElement('div'), D = m.d || {}, k = m.k || '';
  d.className = 'msg sys' + (k ? ' k-' + k : '');
  const nm = (n) => `<b class="ev-n">${esc(n)}</b>`;
  const pill = (icon, html) => { d.innerHTML = `<span class="ev-pill">${ic(icon)}<span>${html}</span></span>`; return d; };
  const card = (cls, html) => { d.innerHTML = `<div class="ev-card ${cls}">${html}</div>`; return d; };
  switch (k) {
    case 'join': return pill('user-plus', `${nm(D.n)} joined`);
    case 'open': return pill('armchair', `${nm(D.n)} opened the table`);
    case 'host': return pill('crown', `${nm(D.n)} is now the host`);
    case 'seat': return pill('armchair', `${nm(D.n)} took seat ${D.s + 1}`);
    case 'unseat': return pill('user-minus', `${nm(D.n)} left ${D.s != null ? 'seat ' + (D.s + 1) : 'their seat'}`);
    case 'shuffle': return pill('shuffle', 'Shoe reshuffled');
    case 'pause': return pill('pause', `${nm(D.n)} paused the game`);
    case 'resume': return pill('play', D.auto ? 'Game resumed automatically' : `${nm(D.n)} resumed the game`);
    case 'ins': return pill('shield', D.win ? `${nm(D.n)}'s insurance pays ${fmt(D.amt * 2)}` : `${nm(D.n)} loses the ${fmt(D.amt)} insurance`);
    case 'even': return pill('shield', `${nm(D.n)} takes even money`);
    case 'timeout': return pill('timer', `${nm(D.n)} timed out, auto-${D.poker || 'stand'}`);
    case 'phand': return pill('trophy', `${nm(D.n)} wins ${fmt(D.amt)} with ${esc(D.hand)}`);
    case 'forfeit': return pill('flag', `${nm(D.n)} forfeited`);
    case 'dc': return pill('wifi-off', `${nm(D.n)} disconnected`);
    case 'draw': return pill('handshake', D.names ? `Draw between ${D.names.map((n) => nm(n)).join(', ')}` : 'The match ends in a draw');
    case 'out': return pill('skull', D.tourney ? `${nm(D.n)} eliminated · ${place(D.place)}` : `${nm(D.n)} is out of chips`);
    case 'level': return pill('trending-up', D.poker ? `Blinds up: ${fmt(D.sb)}/${fmt(D.bb)}` : `Blinds up: bets ${fmt(D.min)}–${fmtMax(D.max)}`);
    case 'start': {
      const names = D.names || [D.a, D.b], seats = D.seats || [0, 1], md = MODES[D.mode] || MODES.duel;
      const chips = names.map((n, k) => `<span class="pc">${avatar(n, seats[k], 'sm')}<b>${esc(n)}</b></span>`);
      return card('ev-start', `<div class="ev-h">${ic(md.icon)}<span>${md.label} started${D.blitz ? ' · Blitz' : ''}</span></div>
        <div class="vs">${names.length === 2 ? `${chips[0]}<em>vs</em>${chips[1]}` : chips.join('')}</div>
        <div class="ev-sub"><i class="coin"></i>Starting stack <b>${fmt(D.stack)}</b></div>`);
    }
    case 'round':
      return card('ev-round', `<div class="ev-h">${ic(D.ar ? MODES[D.ar].icon : 'spade')}<span>${D.ar === 'plinko' ? 'Ball' : D.poker ? 'Hand' : D.ar ? MODES[D.ar].label + ' ·' : 'Round'} ${D.ar === 'plinko' ? '' : D.ar ? 'round ' : ''}${D.r}${D.o ? ' · ' + esc(D.o) : ''}</span></div>` + D.p.map((p, i) => {
        const up = p.net > 0, dn = p.net < 0;
        return `<div class="rr ${up ? 'up' : dn ? 'dn' : 'eq'}">${avatar(p.n, p.s != null ? p.s : i, 'sm')}<span class="rn">${esc(p.n)}</span>
          <span class="rv">${ic(up ? 'trending-up' : dn ? 'trending-down' : 'equal')}${up ? '+' : dn ? '−' : ''}${fmt(Math.abs(p.net))}</span>
          <span class="rb"><i class="coin"></i>${fmt(p.bal)}</span></div>`;
      }).join(''));
    case 'win':
      return card('ev-win', `<span class="tro">${ic('trophy')}</span><div><div class="wt">${nm(D.n)} wins the match</div><div class="ev-sub">${((S.view && modeOf(S.view) === 'duel') ? WHY_DUEL : WHY)[D.why] || ''}</div></div>`);
    default:
      return pill('info', esc(m.x || ''));
  }
}

function renderChat(v) {
  const box = $('#msgs');
  const last = S.chatLast || 0;
  const fresh = v.chat.filter((m) => m.id > last);
  if (!fresh.length) return;
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  for (const m of fresh) {
    if (m.s) { box.appendChild(sysNode(m)); continue; }
    const d = document.createElement('div');
    d.className = 'msg' + (m.u === v.you.id ? ' mine' : '');
    const b = document.createElement('b'); b.textContent = m.n; b.style.color = m.u === v.you.id ? '' : `hsl(${hue(m.n)} 85% 72%)`;
    d.append(b, document.createTextNode(m.x));
    box.appendChild(d);
  }
  const hiddenChat = desktop() ? document.body.classList.contains('chat-collapsed') : phoneUI.matches && !(document.body.classList.contains('sheet-open') && document.body.dataset.tab === 'chat');
  if (last !== 0 && hiddenChat) {
    S.unread = (S.unread || 0) + fresh.filter((m) => !m.s && m.u !== v.you.id).length;
    renderUnread();
  }
  S.chatLast = v.chat[v.chat.length - 1].id;
  while (box.children.length > 120) box.firstChild.remove();
  if (near || last === 0) box.scrollTop = box.scrollHeight;
}
const desktop = () => matchMedia('(min-width:1181px)').matches;
// desktop: "Recent rounds" lives in the right panel next to Chat (tabs); narrow screens keep it as its own tab below the table
function placeRounds() {
  const r = document.querySelector('section.rounds'), chat = $('aside.chat'), main = $('.main');
  if (desktop()) { if (r.parentNode !== chat) chat.insertBefore(r, $('#msgs')); }
  else { chat.dataset.pane = 'chat'; if (r.parentNode !== main) main.appendChild(r); }
}
function setPane(p) {
  const chat = $('aside.chat'); chat.dataset.pane = p;
  $$('.ptabs button').forEach((b) => b.classList.toggle('on', b.dataset.pane === p));
  if (p === 'chat') { S.unread = 0; renderUnread(); const m = $('#msgs'); m.scrollTop = m.scrollHeight; }
}
$('.ptabs').addEventListener('click', (e) => { const b = e.target.closest('[data-pane]'); if (b) setPane(b.dataset.pane); });
matchMedia('(min-width:1181px)').addEventListener('change', placeRounds);
placeRounds();
function renderUnread() {
  const txt = S.unread > 99 ? '99+' : S.unread || '';
  const u = $('#unread'); u.textContent = txt; u.classList.toggle('on', S.unread > 0);
  for (const id of ['#mUnread', '#sUnread']) { const m = $(id); m.textContent = txt; m.classList.toggle('on', S.unread > 0); }
  const t = $('#tabUnread'); t.textContent = txt; t.classList.toggle('on', S.unread > 0 && $('aside.chat').dataset.pane === 'rounds');
}
function setChat(collapsed) {
  document.body.classList.toggle('chat-collapsed', collapsed);
  try { LS.set('bj.chatc', collapsed ? '1' : ''); } catch { /* ignore */ }
  if (!collapsed) { S.unread = 0; renderUnread(); const m = $('#msgs'); m.scrollTop = m.scrollHeight; }
}
$('#chatToggle').addEventListener('click', () => setChat(true));
$('#chatRail').addEventListener('click', () => { setChat(false); $('#chatInput').focus(); });
if (LS.get('bj.chatc') === '1') document.body.classList.add('chat-collapsed');
$('#chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const i = $('#chatInput'), t = i.value.trim();
  if (!t) return;
  i.value = '';
  act('chat', { text: t });
});
$$('.emotes button').forEach((b) => b.addEventListener('click', () => act('chat', { text: b.textContent })));

/* =====================================================================
   main render + sound/transition triggers
   ===================================================================== */
function syncProfiles(v) {
  const next = {};
  for (const m of v.members) if (m.color || m.icon) next[m.name] = { color: m.color, icon: m.icon };
  for (const x of v.seats) if (x) next[x.name] = { color: x.color, icon: x.icon };
  const sig = JSON.stringify(next);
  if (sig === S.profSig) return;
  S.profSig = sig;
  for (const k of Object.keys(PROF)) delete PROF[k];
  Object.assign(PROF, next);
  S.sig = {}; // force avatar-bearing panels to redraw
  refreshMe();
}
function refreshMe() { const el = $('#meAvatar'); if (el) setAvatar(el, S.name, -1); }

function render(v, prev) {
  syncProfiles(v);
  $('#roomName').textContent = tableName(v.room);
  // transitions
  if (prev && !S.instant) {
    if ((isPk(v) ? v.poker.legal && !(prev.poker && prev.poker.legal) : v.legal && !prev.legal)) { sfx.turn(); if (document.hidden) document.title = '🔔 Your move · Degen Casino'; }
    if (v.phase === 'settled' && prev.phase !== 'settled' && v.you.seat >= 0 && (isPk(v) ? v.poker.res : v.results)) {
      const n = isPk(v) ? (v.poker.res[v.you.seat] ? v.poker.res[v.you.seat].net : 0) : (v.results[v.you.seat] || []).reduce((a, r) => a + r.net, 0);
      setTimeout(() => (n > 0 ? sfx.win() : n < 0 ? sfx.lose() : sfx.push()), 120);
    }
    if (v.phase === 'betting' && prev.phase !== 'betting') $('#felt').classList.remove('flash');
  }
  document.body.dataset.game = v.game || 'blackjack';
  $('#felt').dataset.game = v.game || 'blackjack';
  renderDealer(v);
  const nSeated = v.seats.filter(Boolean).length;
  const pkLayout = isPk(v), seatedIdx = v.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
  const nPos = pkLayout ? Math.max(2, seatedIdx.length) : v.mode.max; // poker seats are spread evenly around the rail
  const sEl = $('#seats'); sEl.dataset.m = nPos; sEl.dataset.n = nSeated; sEl.classList.toggle('dense', nSeated >= 3);
  $('#felt').classList.toggle('showdown', modeOf(v) === 'showdown' && !isPk(v));
  $('#tablebox').classList.toggle('tall', nSeated >= 5);
  // seats keep the slot they chose on the curved table (wide screens); positions follow the mode's seat count
  { const n = nPos, sp = [1, 1, .55, .7, .85, 1][n] ?? 1;
    const fw = $('#felt').clientWidth || 1000, fh = $('#felt').clientHeight || 600;
    for (let i = 0; i < NSEATS; i++) {
      const t = Math.PI * ((pkLayout ? Math.max(0, seatedIdx.indexOf(i)) : i) + .5) / n, x = 50 - 41 * sp * Math.cos(t), y = n === 1 && !pkLayout ? 60 : 27 + 46 * Math.sin(t);
      seatNodes[i].style.setProperty('--x', x.toFixed(1) + '%'); seatNodes[i].style.setProperty('--y', y.toFixed(1) + '%');
      // poker: slide each seat's street bet toward the middle of the table
      const dx = (50 - x) * fw / 100, dy = (40 - y) * fh / 100, d = Math.hypot(dx, dy) || 1, k = Math.min(86, d * 0.45) / d;
      seatNodes[i].style.setProperty('--bdx', (dx * k).toFixed(0) + 'px'); seatNodes[i].style.setProperty('--bdy', (dy * k).toFixed(0) + 'px');
    } }
  { // phone layout: opponents get compact seats in order, your own seat is the big one
    const opp = v.seats.map((x, i) => (x && i !== v.you.seat ? i : -1)).filter((i) => i >= 0);
    $('#felt').dataset.opp = opp.length; sEl.dataset.opp = opp.length; sEl.dataset.size = opp.length >= 3 ? 'compact' : 'roomy';
    seatNodes.forEach((n, i) => { const k = opp.indexOf(i); if (k >= 0) n.dataset.o = k + 1; else delete n.dataset.o; });
  }
  for (let i = 0; i < NSEATS; i++) renderSeat(i, v, prev);
  renderBanner(v);
  renderDock(v);
  if (window.Arcade) Arcade.render(v);
  $('#tablebox').classList.toggle('setup', v.phase === 'lobby' || v.phase === 'over');
  renderLobby(v); renderOver(v);
  renderSide(v); renderRounds(v); renderChat(v);
  if (v.phase !== 'lobby' && !isPk(v) && !isArc(v)) {
    // purely visual: the engine owns the shoe, we derive what sits in the tray from its numbers
    const total = (v.settings.decks || 6) * 52;
    const onTable = v.dealer.cards.length + v.hands.reduce((q, hs) => q + (hs || []).reduce((a, h) => a + h.cards.length, 0), 0);
    shoeC.setRemaining(v.shoeLeft, total);
    discC.setCount(Math.max(0, total - v.shoeLeft - onTable), total);
  } else if (shoeC.remaining !== shoeC.total) { shoeC.setRemaining(shoeC.total); discC.setCount(0); }
  tickUI();
}

/* 100ms ticker: timers + dealer timeline */
function tickUI() {
  const v = S.view; if (!v) return;
  if (v.phase === 'dealer') renderDealer(v);
  const now = serverNow();
  const remain = v.timerAt ? Math.max(0, v.timerAt - now) : 0;
  const frac = v.timerDur ? Math.min(1, remain / v.timerDur) : 0;
  const low = remain > 0 && remain < 6000;
  seatNodes.forEach((n, i) => {
    const on = v.timerAt && ((v.timerKind === 'action' && (isPk(v) ? v.poker.to === i : v.turn && v.turn.seat === i)) || (v.timerKind === 'bet' && v.seats[i] && v.seats[i].alive && v.seats[i].bet == null));
    const t = n.querySelector('.timer');
    t.classList.toggle('on', !!on); t.classList.toggle('low', !!on && low);
    if (on) t.firstElementChild.style.transform = `scaleX(${frac})`;
    const tg = n.querySelector('.stag');
    if (tg._k === 'THINKING') { const sec = on ? Math.ceil(remain / 1000) : 0; tg.textContent = sec ? `THINKING ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : 'THINKING'; }
    const ring = n.querySelector('.avawrap');
    ring.classList.toggle('ticking', !!on); ring.classList.toggle('low', !!on && low);
    if (on) ring.style.setProperty('--p', frac.toFixed(3));
  });
  const showBar = v.timerAt && (v.timerKind === 'bet' || v.timerKind === 'action' || v.timerKind === 'ins');
  $('#insBar').style.transform = `scaleX(${frac})`;
  $('#pkBar').parentElement.style.visibility = showBar ? 'visible' : 'hidden';
  $('#pkBar').style.transform = `scaleX(${frac})`;
  $('#waitBar').parentElement.style.visibility = showBar ? 'visible' : 'hidden';
  $('#waitBar').style.transform = `scaleX(${frac})`;
  if (v.phase === 'settled' && v.timerKind === 'next' && v.you.seat >= 0)
    $('#nextTxt').textContent = v.over ? (isPk(v) ? 'Final hand' : 'Final round') : `Next ${isPk(v) ? 'hand' : 'round'} in ${Math.ceil(remain / 1000)}s`;
}
setInterval(tickUI, 100);
if (window.Arcade) Arcade.init({ act, fmt, esc, short, avatar, colorOf, serverNow, sfx, ic, DENOMS, chipClass, LS });

/* keep presence alive */
setInterval(() => { if (S.token && S.view) post('/api/act', { room: S.room, type: 'ping' }).catch((e) => { if (e.status === 401) logout('Session expired. Sign in again.'); }); }, 10000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  document.title = 'Degen Casino';
  if (S.token && S.view) { post('/api/act', { room: S.room, type: 'ping' }).catch(() => {}); if (S.conn !== 'live' && S.ac) S.ac.abort(); }
});

/* hotkeys */
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
  if (e.key === '/' && !typing && S.view) { e.preventDefault(); if (!desktop()) { if (phoneUI.matches) openSheet('chat'); else document.body.dataset.tab = 'chat'; } else if (document.body.classList.contains('chat-collapsed')) setChat(false); $('#chatInput').focus(); return; }
  if (typing || !S.view || appEl.classList.contains('hidden')) return;
  if (S.view.paused) return;
  const k = e.key.toLowerCase();
  if (isPk(S.view)) {
    if (k === 'f') pkAct('fold');
    else if (k === 'c') pkAct('call');
    else if (k === 'r') pkAct('raise', { to: pkState.to });
    else if (e.key === 'Enter' && dock.next.classList.contains('on') && !$('#nextBtn').disabled) act('next');
    return;
  }
  if (k === 'h') doAction('hit');
  else if (k === 's') doAction('stand_hand');
  else if (k === 'd') doAction('double');
  else if (k === 'p') doAction('split');
  else if (e.key === 'Enter') {
    if (dock.bet.classList.contains('on')) placeBet();
    else if (dock.next.classList.contains('on') && !$('#nextBtn').disabled) act('next');
  }
});

/* =====================================================================
   casino lobby: house tables per game, private tables, join by code
   ===================================================================== */
const HUB_GAMES = [
  { id: 'blackjack', name: 'Degen 21', icon: 'spade', blurb: 'Blackjack against the dealer, duel or up to six seats.' },
  { id: 'poker', name: 'Degen Poker', icon: 'crown', blurb: "Texas Hold'em, with bots to fill the table." },
  { id: 'roulette', name: 'Roulette', icon: 'dices', blurb: 'One shared wheel, every bet on the table.' },
  { id: 'crash', name: 'Crash', icon: 'rocket', blurb: 'Cash out before the multiplier crashes.' },
  { id: 'plinko', name: 'Plinko', icon: 'circle', blurb: 'Drop balls down the pegs, pick your risk.' },
  { id: 'dice', name: 'Dice', icon: 'dices', blurb: 'Roll over or under your target.' },
  { id: 'mines', name: 'Mines', icon: 'gem', blurb: 'Clear tiles, dodge the mines, cash out.' },
];
const tableName = (room) => {
  const m = /^([a-z]+)-(\d)$/.exec(room || '');
  const g = m && HUB_GAMES.find((x) => x.id === m[1]);
  return g ? `${g.name} · Table ${m[2]}` : room;
};
let hubTimer = 0, hubGen = 0;
function hubStop() { clearTimeout(hubTimer); hubTimer = 0; hubGen++; }
function showHub(msg) {
  hubStop();
  loginEl.classList.add('hidden'); appEl.classList.add('hidden'); $('#hub').classList.remove('hidden');
  $('#hubMe').textContent = S.name;
  $('#hubErr').textContent = msg || '';
  history.replaceState(null, '', location.pathname);
  document.title = 'Degen Casino';
  hydrateIcons();
  const gen = hubGen;
  const poll = async () => {
    try {
      const r = await fetch('/api/tables', { headers: { Authorization: 'Bearer ' + S.token }, cache: 'no-store' });
      if (r.status === 401) return logout('Session expired. Sign in again.');
      if (gen !== hubGen) return;
      if (r.ok) renderHub((await r.json()).tables);
    } catch { /* offline: try again */ }
    if (gen === hubGen) hubTimer = setTimeout(poll, 3000);
  };
  poll();
}
function renderHub(tables) {
  const sig = JSON.stringify(tables.map((t) => [t.id, t.active, t.phase, t.seated, t.open, t.over]));
  if (S.hubSig === sig) return;
  S.hubSig = sig;
  $('#hubGrid').innerHTML = HUB_GAMES.map((g) => {
    const rows = tables.filter((t) => t.game === g.id).sort((a, b) => a.n - b.n).map((t) => {
      const seated = t.seated || [], full = t.active && seated.length >= t.max;
      const status = !t.active ? 'Empty' : t.over || t.phase === 'over' ? 'Finished' : t.phase !== 'lobby' ? 'In play' : t.open ? 'Waiting for players' : 'Being set up';
      const who = seated.length ? esc(seated.slice(0, 3).join(', ')) + (seated.length > 3 ? ` +${seated.length - 3}` : '') : '';
      return `<div class="ht${t.active ? ' on' : ''}"><div class="ht-n">Table ${t.n}</div><div class="ht-i"><span class="ht-s">${status}${t.active && t.label && g.id === 'blackjack' ? ' · ' + esc(t.label) : ''}</span>${who ? `<small>${who}</small>` : '<small>Be the first to sit down</small>'}</div><div class="ht-c">${t.active ? `${seated.length}/${t.max}` : ''}</div><button class="btn sm${t.active ? '' : ' primary'}" data-room="${t.id}">${!t.active ? 'Open' : full ? 'Watch' : 'Join'}</button></div>`;
    }).join('');
    return `<section class="hg"><div class="hg-h"><span class="hg-ic">${ic(g.icon)}</span><div><b>${g.name}</b><small>${g.blurb}</small></div></div>${rows}</section>`;
  }).join('');
}
async function joinRoom(room) {
  S.room = cleanRoomId(room);
  if (!S.room) return;
  hubStop();
  try { await enter(); } catch { /* enter() already returned to the lobby with the reason */ }
}
$('#hubGrid').addEventListener('click', (e) => { const b = e.target.closest('[data-room]'); if (b) joinRoom(b.dataset.room); });
$('#hubCreate').addEventListener('click', () => {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  joinRoom(Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''));
});
const hubJoinCode = () => { const c = cleanRoomId($('#hubCode').value); if (c) joinRoom(c); else $('#hubCode').focus(); };
$('#hubJoin').addEventListener('click', hubJoinCode);
$('#hubCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') hubJoinCode(); });
$('#hubOut').addEventListener('click', () => logout(''));

/* boot */
hydrateIcons();
soundIcon();
(async () => {
  const q = new URLSearchParams(location.search).get('room');
  if (S.token) {
    if (q) { S.room = cleanRoomId(q); try { await enter(); return; } catch { return; } }
    showHub(); return;
  }
  showLogin('');
})();
})();
