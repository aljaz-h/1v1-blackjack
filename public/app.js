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
  duel: { label: 'Duel', icon: 'swords', desc: 'Head to head: two players each play the dealer. Last one with chips wins.' },
  classic: { label: 'Classic', icon: 'users', desc: '2–6 players, each against the dealer. Play on until one stack is left or the round limit hits.' },
  showdown: { label: 'Showdown', icon: 'dices', desc: '2–6 players, no dealer. Best hand takes the pot (side pots for unequal bets). A natural blackjack beats 21.' },
  tournament: { label: 'Tournament', icon: 'trophy', desc: '3–6 players vs the dealer. Bet limits rise as rounds pass; run out of chips and you are eliminated.' },
};
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
  let bus = null, busCtx = null, noiseBuf = null;
  function chain(c) {
    if (bus && busCtx === c) return bus;
    busCtx = c;
    const master = c.createGain(); master.gain.value = 3.2;
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
  let ctx = null, muted = LS.get('bj.mute') === '1';
  function ensure() {
    if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ctx = new AC(); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  const inner = createSfx(() => ensure(), () => muted);
  return {
    ...inner,
    unlock: ensure,
    get muted() { return muted; },
    setMuted(m) { muted = m; LS.set('bj.mute', m ? '1' : '0'); },
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

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const centerOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
// offset of `el` from the card shoe (falls back to the top of the table when the shoe is hidden on small screens)
function shoeOffset(el) {
  const shoe = $('#shoe'), r = el.getBoundingClientRect();
  let sx, sy;
  if (shoe && shoe.offsetParent) { const s = centerOf(shoe); sx = s.x; sy = s.y; }
  else { const f = $('#felt').getBoundingClientRect(); sx = f.right - 30; sy = f.top - 20; }
  return { x: sx - (r.left + r.width / 2), y: sy - (r.top + r.height / 2) };
}
// little coins flying between two elements (WAAPI, removed when done)
function flyCoins(fromEl, toEl, n, { onLand } = {}) {
  if (S.instant || REDUCED.matches || !fromEl || !toEl) return;
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
  $('#inRoom').value = new URLSearchParams(location.search).get('room') || LS.get('bj.room') || '';
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
  if (!first && prev !== step && !REDUCED.matches) {
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
    S.room = ($('#inRoom').value || 'main').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || 'main';
    LS.set('bj.token', S.token); LS.set('bj.id', S.id); LS.set('bj.name', S.name); LS.set('bj.room', S.room === 'main' ? '' : S.room);
    sfx.unlock();
    await enter();
  } catch (err) {
    $('#loginErr').textContent = err.message;
    if (S.step === 'user' && err.status === 401) setStep('pass');
    const c = $('.login-card'); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake');
  } finally { btn.disabled = false; $('#loginSpin').classList.add('hidden'); $('#loginTxt').textContent = S.step === 'pass' ? 'Continue' : 'Enter the casino'; }
});

async function enter() {
  S.gen++;
  S.view = null; S.instant = true; S.sig = {};
  $('#msgs').innerHTML = ''; S.chatLast = 0;
  try {
    const r = await post('/api/act', { room: S.room, type: 'join' });
    loginEl.classList.add('hidden'); appEl.classList.remove('hidden');
    $('#meName').textContent = S.name; refreshMe();
    $('#roomName').textContent = S.room;
    soundIcon();
    history.replaceState(null, '', S.room === 'main' ? location.pathname : `?room=${S.room}`);
    applyView(r.view);
    streamLoop(S.gen);
    const sp = loadProf(); if (sp) act('profile', sp);
  } catch (e) {
    if (e.status === 401) { S.token = ''; LS.del('bj.token'); }
    showLogin(e.status === 401 ? '' : e.message);
    throw e;
  }
}

async function logout(msg) {
  S.gen++;
  if (S.ac) S.ac.abort();
  S.token = ''; LS.del('bj.token');
  S.view = null; setConn('off');
  showLogin(msg);
}

$('#logoutBtn').addEventListener('click', async () => {
  const v = S.view;
  if (v && v.you.seat >= 0) {
    if (['betting', 'playing', 'dealer', 'settled'].includes(v.phase) && !v.over) {
      if (!confirm('Leaving mid-match forfeits it. Leave anyway?')) return;
      await act('forfeit');
    } else if (v.phase === 'lobby' || v.phase === 'over') await act('stand');
  }
  logout('');
});
$('#pauseBtn').addEventListener('click', () => act('pause'));
$('#resumeBtn').addEventListener('click', () => act('resume'));
$('#forfeitBtn').addEventListener('click', () => { if (confirm('Forfeit the match? Your opponent wins.')) act('forfeit'); });
$('#roomPill').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?room=${S.room}`;
  try { await navigator.clipboard.writeText(url); toast('Invite link copied', 'ok'); } catch { toast(url); }
});
function soundIcon() { $('#soundBtn').innerHTML = ic(sfx.muted ? 'volume-x' : 'volume-2'); }
$('#soundBtn').addEventListener('click', () => { sfx.setMuted(!sfx.muted); soundIcon(); sfx.unlock(); sfx.chip(); });
$$('.mtabs button').forEach((b) => b.addEventListener('click', () => {
  document.body.dataset.tab = b.dataset.t;
  $$('.mtabs button').forEach((x) => x.classList.toggle('on', x === b));
}));

/* =====================================================================
   cards
   ===================================================================== */
function cardFront(c) {
  const r = c.slice(0, -1), s = SYM[c.slice(-1)], face = 'JQK'.includes(r);
  return `<span class="c tl"><b>${r}</b><i>${s}</i></span><div class="mid${face ? ' face-l' : ''}">${face ? `${r}<small>${s}</small>` : s}</div><span class="c br"><b>${r}</b><i>${s}</i></span>`;
}
const DEAL_MS = 620, DEAL_GAP = 280; // flight time of one card, and the pause between cards
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
      const nn = makeCard(c, !S.instant, delayFn(i)); box.appendChild(nn);
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

function setTotal(el, cards, { bj = false, hidden = false } = {}) {
  const real = cards.filter(Boolean);
  el.className = 'total'; el.textContent = '';
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
    <div class="seat-head"><span class="avawrap"><span class="avatar"></span></span><div class="who"><div class="name"></div><div class="bal"><i class="coin"></i><b>0</b></div></div><div class="badges"></div></div>
    <div class="timer"><i></i></div><div class="hands"></div><div class="betrow"></div><div class="float"></div>`;
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
function renderDealer(v) {
  const vis = dealerVisible(v);
  const np = dealOrder(v).length;
  syncCards($('#dealerCards'), vis, (i) => (i < 2 ? (i * (np + 1) + np) * DEAL_GAP : 0));
  const hidden = vis.length >= 2 && !vis[1];
  const t = $('#dealerTotal');
  if (!vis.length) { t.className = 'total'; t.textContent = ''; return; }
  const real = vis.filter(Boolean);
  setTotal(t, vis, { hidden, bj: real.length === 2 && handTotal(real).total === 21 && !hidden });
}

function renderSeat(i, v, prev) {
  const node = seatNodes[i], s = v.seats[i];
  node.classList.toggle('empty', !s);
  node.classList.toggle('me', v.you.seat === i);
  if (!s) {
    node.querySelector('.emptytxt').textContent = `Seat ${i + 1} is open`;
    node.style.removeProperty('--c');
    node.classList.remove('active', 'multi', 'out');
    node.querySelector('.hands').innerHTML = '';
    return;
  }
  node.style.setProperty('--c', colorOf(s.name, i));
  node.classList.toggle('out', !s.alive && v.phase !== 'lobby');
  setAvatar(node.querySelector('.avatar'), s.name, i);
  node.querySelector('.name').textContent = s.name;
  countTo(node.querySelector('.bal b'), s.balance);
  node.querySelector('.badges').innerHTML =
    (v.first === i && s.alive && ['betting', 'playing', 'dealer', 'settled'].includes(v.phase) ? '<span class="badge first" title="Acts first this round">1ST</span>' : '') +
    (!s.online ? '<span class="badge off">OFFLINE</span>' : '');
  const active = v.phase === 'playing' && v.turn && v.turn.seat === i;
  node.classList.toggle('active', !!active);

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
      hn.innerHTML = '<div class="cards"></div><div class="hmeta"><span class="total"></span><span class="hbet"><i class="coin"></i><b></b></span><span class="res"></span></div>';
      box.appendChild(hn);
    }
    syncCards(hn.querySelector('.cards'), h.cards, (ci) => (ci < 2 ? (ci * per + posInDeal) * DEAL_GAP : 0));
    setTotal(hn.querySelector('.total'), h.cards, { bj: h.bj });
    hn.querySelector('.hbet b').textContent = fmt(h.bet) + (h.doubled ? ' ×2' : '');
    const r = v.results && v.results[i] && v.results[i][k];
    const rs = hn.querySelector('.res');
    rs.className = 'res' + (r ? ' ' + r.out : '');
    rs.textContent = r ? (r.out === 'bust' ? '' : { win: 'WIN', lose: 'LOSE', push: 'PUSH', blackjack: 'BLACKJACK' }[r.out] + ' ') + (r.net ? `${r.net > 0 ? '+' : '−'}${fmt(Math.abs(r.net))}` : '') : '';
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

function renderBanner(v) {
  const showdown = modeOf(v) === 'showdown';
  const nameOf = (i) => (v.seats[i] ? v.seats[i].name : '—');
  const me = v.you.seat >= 0 ? v.seats[v.you.seat] : null;
  const inRound = !!(me && me.alive);
  let t = '', sub = '', cls = '', icon = '';
  if (v.phase === 'betting') {
    t = 'PLACE YOUR BETS'; icon = 'coins';
    if (modeOf(v) === 'tournament') sub = `Level ${v.limits.level + 1} · bets ${fmt(v.limits.min)}–${fmt(v.limits.max)}`;
  } else if (v.phase === 'playing' && v.turn) {
    const mine = v.turn.seat === v.you.seat;
    t = mine ? 'YOUR MOVE' : `${nameOf(v.turn.seat).toUpperCase()}'S MOVE`;
    if (v.hands[v.turn.seat].length > 1) sub = `Hand ${v.turn.hand + 1} of ${v.hands[v.turn.seat].length}`;
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

/* =====================================================================
   dock (bets / actions)
   ===================================================================== */
const dock = {
  bet: $('#dockBet'), play: $('#dockPlay'), wait: $('#dockWait'), next: $('#dockNext'), spec: $('#dockSpec'),
};
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

function setDock(which, text) {
  for (const k of Object.keys(dock)) dock[k].classList.toggle('on', k === which);
  if (which === 'wait') $('#waitTxt').textContent = text || '';
  if (which === 'spec') $('#specTxt').textContent = text || '';
}

function renderDock(v) {
  const me = v.you.seat, seated = me >= 0, mine = seated ? v.seats[me] : null;
  const playing = !!(mine && mine.alive); // seated and still in the match
  const live = ['betting', 'playing', 'dealer', 'settled'].includes(v.phase);
  $('#dock').classList.toggle('hidden', v.phase === 'lobby' || v.phase === 'over');
  $('#forfeitBtn').classList.toggle('hidden', !(playing && ['betting', 'playing', 'dealer'].includes(v.phase)));
  $('#dock').classList.toggle('frozen', !!v.paused);
  $('#pauseBtn').classList.toggle('hidden', !(v.you.host && live && !v.over && !v.paused));
  $('#pauseOv').classList.toggle('hidden', !v.paused);
  if (v.paused) {
    $('#pauseTxt').textContent = v.you.host ? 'Timers are stopped. Resume when everyone is ready.' : `${v.paused.name} paused the match. Waiting for the host to resume.`;
    $('#resumeBtn').classList.toggle('hidden', !v.you.host);
  }
  if (!live) return;
  const specTxt = seated ? 'You are out of chips. Spectating.' : 'You are spectating.';

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
    if (v.legal) {
      setDock('play');
      playBtn.hit.disabled = acting; playBtn.stand_hand.disabled = acting;
      playBtn.double.disabled = acting || !v.legal.double; playBtn.split.disabled = acting || !v.legal.split;
      playBtn.split.classList.toggle('hidden', modeOf(v) === 'showdown');
    } else if (v.turn) {
      const nm = v.seats[v.turn.seat] ? v.seats[v.turn.seat].name : '…';
      if (playing) setDock('wait', `${nm} is playing…`); else setDock('spec', `${nm} is playing. ${specTxt}`);
    } else setDock(playing ? 'wait' : 'spec', modeOf(v) === 'showdown' ? 'Showdown…' : 'Dealer is checking for blackjack…');
  } else if (v.phase === 'dealer') setDock(playing ? 'wait' : 'spec', 'Dealer plays…');
  else if (v.phase === 'settled') {
    if (playing) {
      setDock('next');
      const voted = mine.voted;
      $('#nextBtn').disabled = voted || !!v.over;
      $('#nextBtn').innerHTML = voted ? ic('sp-3-dots-fade') + 'Waiting for others' : 'Next round' + ic('arrow-right') + '<kbd>↵</kbd>';
      $('#nextBtn').classList.toggle('hidden', !!v.over);
    } else setDock('spec', v.over ? 'Match is ending…' : 'Next round starting soon…');
  }
}

/* =====================================================================
   lobby + settings + over
   ===================================================================== */
const setIds = { startingBalance: '#sBalance', minBet: '#sMin', maxBet: '#sMax', decks: '#sDecks', payout: '#sPayout', maxRounds: '#sRounds', blindEvery: '#sBlind', betTime: '#sBetTime', actionTime: '#sActTime' };
function collectSettings(over = {}) {
  return {
    mode: S.view ? S.view.settings.mode : 'duel', blitz: $('#sBlitz').checked,
    startingBalance: +$('#sBalance').value, minBet: +$('#sMin').value, maxBet: +$('#sMax').value,
    decks: +$('#sDecks').value, payout: +$('#sPayout').value, h17: $('#sH17').value === '1',
    maxRounds: +$('#sRounds').value, blindEvery: +$('#sBlind').value, betTime: +$('#sBetTime').value, actionTime: +$('#sActTime').value,
    ...over,
  };
}
$$('#settings input, #settings select').forEach((el) => el.addEventListener('change', () => act('settings', { settings: collectSettings() })));
$$('#balPresets button').forEach((b) => b.addEventListener('click', () => { $('#sBalance').value = b.dataset.v; act('settings', { settings: collectSettings() }); }));
$('#modeSel').innerHTML = Object.entries(MODES).map(([id, m]) => `<button type="button" data-mode="${id}">${ic(m.icon)}<span>${m.label}</span></button>`).join('');
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
    $('#sBlitz').checked = !!st.blitz;
    $$('#modeSel button').forEach((b) => b.classList.toggle('on', b.dataset.mode === st.mode));
    $('#modeDesc').textContent = (MODES[st.mode] || MODES.duel).desc;
    $('#settings').dataset.mode = st.mode;
    $('#sRounds').options[0].textContent = st.mode === 'duel' ? 'Until broke' : 'Until one left';
  }
  $$('#settings input, #settings select, #balPresets button, #modeSel button').forEach((el) => (el.disabled = !isHost));
  $('#sBetTime').disabled = $('#sActTime').disabled = !isHost || st.blitz;
  // seats
  const lsig = JSON.stringify([v.seats.map((s) => s && [s.id, s.ready, s.online]), v.you.seat, md.max, st.mode]);
  if (S.sig.lobby !== lsig) {
    S.sig.lobby = lsig;
    const n = md.max, spread = [1, 1, .55, .7, .85, 1][n] ?? 1;
    const at = (i) => { const t = Math.PI * (i + .5) / n; return `--x:${(50 - 44 * spread * Math.cos(t)).toFixed(1)}%;--y:${(2 + 56 * Math.sin(t)).toFixed(1)}%;`; };
    $('#lobbySeats').dataset.n = n;
    $('#lobbySeats').innerHTML = `<div class="arc-dealer">${st.mode === 'showdown' ? 'SHOWDOWN · NO DEALER' : 'DEALER'}</div>` + Array.from({ length: n }, (_, i) => {
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
  const need = md.min - seatedN;
  if (!open) { $('#lobbyFoot').textContent = isHost ? 'Pick the game mode and rules, then open the table. Players choose their seats once it is open.' : `Waiting for ${v.host ? v.host.name : 'the host'} to set up the table…`; return; }
  const range = md.min === md.max ? `${md.min}` : `${md.min}–${md.max}`;
  $('#lobbyFoot').textContent = need > 0 ? `${md.label} needs ${range} players. Waiting for ${need} more to take a seat. Everyone else spectates.` :
    v.canStart ? 'Starting…' :
    seated ? `${readyN}/${seatedN} ready. Everyone hits Ready to start. Changing a setting un-readies everyone.` :
    seatedN >= md.max ? 'Table is full. You are watching.' : `${readyN}/${seatedN} ready. Take a seat to play, or just watch.`;
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
  const mode = modeOf(v), duel = mode === 'duel';
  const top = o.winner >= 0 ? rk.find((r) => r.seat === o.winner) : null;
  const title = top ? (mode === 'tournament' ? `${esc(top.name)} wins the tournament` : duel || mode === 'showdown' || mode === 'classic' ? `${esc(top.name)} takes the pot` : '') : 'Dead heat';
  const reason = { broke: duel ? 'Opponent is out of chips' : 'Last player standing', rounds: 'Round limit reached. Highest stack wins', forfeit: duel ? 'Opponent forfeited' : 'Everyone else left', disconnect: duel ? 'Opponent disconnected' : 'Everyone else left' }[o.reason] || '';
  const start = v.settings.startingBalance;
  const stat = (r) => { const sx = v.seats[r.seat]; return sx && sx.name === r.name ? `${v.stats.w[r.seat]}W · ${v.stats.l[r.seat]}L · ${v.stats.p[r.seat]}P · ${v.stats.bj[r.seat]} BJ` : ''; };
  const body = rk.length <= 2
    ? `<div class="over-stats">${rk.map((r) => { const net = r.balance - start; return `<div class="d${r.place === 1 && o.winner >= 0 ? ' w' : ''}">${avatar(r.name, r.seat, 'sm')} <b style="display:inline">${esc(r.name)}</b><b>${fmt(r.balance)}</b><span class="${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))}</span><div style="color:var(--dim);font-size:12px;margin-top:4px">${stat(r)}</div></div>`; }).join('')}</div>`
    : `<div class="rank-list">${rk.map((r) => { const net = r.balance - start; return `<div class="rk${r.place === 1 && o.winner >= 0 ? ' w' : ''}"><span class="pl">${r.place === 1 ? ic('crown') : place(r.place)}</span>${avatar(r.name, r.seat, 'sm')}<span class="nm"><b>${esc(r.name)}</b><small>${stat(r)}</small></span><span class="bl"><i class="coin"></i>${fmt(r.balance)}</span><span class="nt ${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))}</span></div>`; }).join('')}</div>`;
  const seated = v.you.seat >= 0;
  const open = Array.from({ length: v.mode.max }, (_, i) => i).filter((i) => !v.seats[i]);
  $('#overCard').innerHTML = `<div class="trophy">${ic(o.winner >= 0 ? 'trophy' : 'handshake')}</div><h2>${title || 'Match over'}</h2><div style="color:var(--dim)">${reason} · ${v.round} round${v.round === 1 ? '' : 's'}</div>
    ${body}
    ${seated ? '<button class="btn primary big" id="backLobby">Back to lobby (rematch)</button>' : open.length ? '<div class="row" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">' + open.map((i) => `<button class="btn primary" data-sit="${i}">Take seat ${i + 1}</button>`).join('') + '</div>' : '<div style="color:var(--dim)">Waiting for the players…</div>'}`;
  const bl = $('#backLobby'); if (bl) bl.addEventListener('click', () => act('lobby'));
  $$('#overCard [data-sit]').forEach((b) => b.addEventListener('click', () => act('sit', { seat: +b.dataset.sit })));
}

/* =====================================================================
   side panel, rounds, chat
   ===================================================================== */
function renderSide(v) {
  const sig = JSON.stringify([v.seats.map((s) => s && [s.id, s.online, s.balance, s.alive]), v.members.map((m) => m.id), v.you.seat, v.phase, v.settings, v.limits, v.stats, v.series.length, v.open]);
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
  rules.push(`${st.decks} deck${st.decks > 1 ? 's' : ''}`);
  if (mode !== 'showdown') rules.push(`BJ ${st.payout === 1.5 ? '3:2' : st.payout === 1.2 ? '6:5' : '1:1'}`, st.h17 ? 'H17' : 'S17');
  rules.push(`Bet ${fmt(lim.min)}–${fmt(lim.max)}`);
  if (mode === 'tournament') rules.push(`Level ${lim.level + 1}`, `Blinds ×1.5 / ${st.blindEvery} rds`);
  rules.push(st.maxRounds ? `${st.maxRounds} rounds` : mode === 'duel' ? 'Until broke' : 'Until one left');
  $('#rules').innerHTML = rules.map((t) => (t.startsWith('<span') ? t : `<span>${t}</span>`)).join('');
  $('#ftPay2').textContent = $('#ftPay').textContent = mode === 'showdown' ? 'SHOWDOWN · BEST HAND TAKES THE POT' : `BLACKJACK PAYS ${st.payout === 1.5 ? '3 TO 2' : st.payout === 1.2 ? '6 TO 5' : '1 TO 1'}`;
  $('#ftRule2').textContent = $('#ftRule').textContent = mode === 'showdown' ? 'NO DEALER · NATURAL BLACKJACK BEATS 21' : st.h17 ? 'DEALER HITS SOFT 17' : 'DEALER STANDS ON ALL 17s';
  const seatedIdx = v.seats.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
  $('#duel').classList.toggle('cols3', seatedIdx.length > 4);
  $('#duel').innerHTML = (seatedIdx.length ? seatedIdx : [0, 1]).map((i) => { const x = v.seats[i]; return `<div class="d"><small>${x ? esc(x.name) : 'Seat ' + (i + 1)}</small><b style="color:${x ? colorOf(x.name, i) : seatColor(i)}">${v.stats.w[i]} – ${v.stats.l[i]}</b><small>W–L · ${v.stats.p[i]} push · ${v.stats.bj[i]} BJ</small></div>`; }).join('');
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
  const sig = v.history.length ? `${v.history.length}:${v.history[v.history.length - 1].r}:${v.history[0].r}` : '0';
  if (S.sig.rounds === sig) return;
  S.sig.rounds = sig;
  $('#rempty').classList.toggle('hidden', v.history.length > 0);
  const label = { win: 'WIN', lose: 'LOSE', push: 'PUSH', bust: 'BUST', blackjack: 'BJ' };
  $('#rbody').innerHTML = [...v.history].reverse().map((h) =>
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
    case 'timeout': return pill('timer', `${nm(D.n)} timed out, auto-stand`);
    case 'forfeit': return pill('flag', `${nm(D.n)} forfeited`);
    case 'dc': return pill('wifi-off', `${nm(D.n)} disconnected`);
    case 'draw': return pill('handshake', D.names ? `Draw between ${D.names.map((n) => nm(n)).join(', ')}` : 'The match ends in a draw');
    case 'out': return pill('skull', D.tourney ? `${nm(D.n)} eliminated · ${place(D.place)}` : `${nm(D.n)} is out of chips`);
    case 'level': return pill('trending-up', `Blinds up: bets ${fmt(D.min)}–${fmt(D.max)}`);
    case 'start': {
      const names = D.names || [D.a, D.b], seats = D.seats || [0, 1], md = MODES[D.mode] || MODES.duel;
      const chips = names.map((n, k) => `<span class="pc">${avatar(n, seats[k], 'sm')}<b>${esc(n)}</b></span>`);
      return card('ev-start', `<div class="ev-h">${ic(md.icon)}<span>${md.label} started${D.blitz ? ' · Blitz' : ''}</span></div>
        <div class="vs">${names.length === 2 ? `${chips[0]}<em>vs</em>${chips[1]}` : chips.join('')}</div>
        <div class="ev-sub"><i class="coin"></i>Starting stack <b>${fmt(D.stack)}</b></div>`);
    }
    case 'round':
      return card('ev-round', `<div class="ev-h">${ic('spade')}<span>Round ${D.r}</span></div>` + D.p.map((p, i) => {
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
  if (last !== 0 && desktop() && document.body.classList.contains('chat-collapsed')) {
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
  $('#roomName').textContent = v.room;
  // transitions
  if (prev && !S.instant) {
    if (v.legal && !prev.legal) { sfx.turn(); if (document.hidden) document.title = '🔔 Your move · Degen 21'; }
    if (v.phase === 'settled' && prev.phase !== 'settled' && v.you.seat >= 0 && v.results) {
      const n = (v.results[v.you.seat] || []).reduce((a, r) => a + r.net, 0);
      setTimeout(() => (n > 0 ? sfx.win() : n < 0 ? sfx.lose() : sfx.push()), 120);
    }
    if (v.phase === 'betting' && prev.phase !== 'betting') $('#felt').classList.remove('flash');
  }
  renderDealer(v);
  const nSeated = v.seats.filter(Boolean).length;
  const sEl = $('#seats'); sEl.dataset.m = v.mode.max; sEl.dataset.n = nSeated; sEl.classList.toggle('dense', nSeated >= 3);
  $('#felt').classList.toggle('showdown', modeOf(v) === 'showdown');
  $('#tablebox').classList.toggle('tall', nSeated >= 5);
  // seats keep the slot they chose on the curved table (wide screens); positions follow the mode's seat count
  { const n = v.mode.max, sp = [1, 1, .55, .7, .85, 1][n] ?? 1;
    for (let i = 0; i < NSEATS; i++) { const t = Math.PI * (i + .5) / n; seatNodes[i].style.setProperty('--x', (50 - 41 * sp * Math.cos(t)).toFixed(1) + '%'); seatNodes[i].style.setProperty('--y', (27 + 46 * Math.sin(t)).toFixed(1) + '%'); } }
  for (let i = 0; i < NSEATS; i++) renderSeat(i, v, prev);
  renderBanner(v);
  renderDock(v);
  $('#tablebox').classList.toggle('setup', v.phase === 'lobby' || v.phase === 'over');
  renderLobby(v); renderOver(v);
  renderSide(v); renderRounds(v); renderChat(v);
  $('#shoeCount').textContent = v.phase === 'lobby' ? '' : `SHOE ${v.shoeLeft}`;
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
    const on = v.timerAt && ((v.timerKind === 'action' && v.turn && v.turn.seat === i) || (v.timerKind === 'bet' && v.seats[i] && v.seats[i].alive && v.seats[i].bet == null));
    const t = n.querySelector('.timer');
    t.classList.toggle('on', !!on); t.classList.toggle('low', !!on && low);
    if (on) t.firstElementChild.style.transform = `scaleX(${frac})`;
    const ring = n.querySelector('.avawrap');
    ring.classList.toggle('ticking', !!on); ring.classList.toggle('low', !!on && low);
    if (on) ring.style.setProperty('--p', frac.toFixed(3));
  });
  const showBar = v.timerAt && (v.timerKind === 'bet' || v.timerKind === 'action');
  $('#waitBar').parentElement.style.visibility = showBar ? 'visible' : 'hidden';
  $('#waitBar').style.transform = `scaleX(${frac})`;
  if (v.phase === 'settled' && v.timerKind === 'next' && v.you.seat >= 0)
    $('#nextTxt').textContent = v.over ? 'Final round' : `Next round in ${Math.ceil(remain / 1000)}s`;
}
setInterval(tickUI, 100);

/* keep presence alive */
setInterval(() => { if (S.token && S.view) post('/api/act', { room: S.room, type: 'ping' }).catch((e) => { if (e.status === 401) logout('Session expired. Sign in again.'); }); }, 10000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  document.title = 'Degen 21 · Blackjack';
  if (S.token && S.view) { post('/api/act', { room: S.room, type: 'ping' }).catch(() => {}); if (S.conn !== 'live' && S.ac) S.ac.abort(); }
});

/* hotkeys */
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
  if (e.key === '/' && !typing && S.view) { e.preventDefault(); if (!desktop()) document.body.dataset.tab = 'chat'; else if (document.body.classList.contains('chat-collapsed')) setChat(false); $('#chatInput').focus(); return; }
  if (typing || !S.view || appEl.classList.contains('hidden')) return;
  if (S.view.paused) return;
  const k = e.key.toLowerCase();
  if (k === 'h') doAction('hit');
  else if (k === 's') doAction('stand_hand');
  else if (k === 'd') doAction('double');
  else if (k === 'p') doAction('split');
  else if (e.key === 'Enter') {
    if (dock.bet.classList.contains('on')) placeBet();
    else if (dock.next.classList.contains('on') && !$('#nextBtn').disabled) act('next');
  }
});

/* boot */
hydrateIcons();
soundIcon();
(async () => {
  const q = new URLSearchParams(location.search).get('room');
  S.room = (q || LS.get('bj.room') || 'main').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || 'main';
  if (S.token) { try { await enter(); return; } catch { /* fall through to login */ } }
  showLogin('');
})();
})();
