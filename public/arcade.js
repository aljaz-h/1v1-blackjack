/* Degen Casino arcade games on the client: Roulette, Crash, Plinko.
   The server owns every outcome; this file only draws what the view says and sends bets.
   app.js hands over its helpers with Arcade.init(...) and calls Arcade.render(view) on every update. */
(() => {
'use strict';
let C = null;
const st = { game: '', mod: null, v: null, raf: 0, sig: {} };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};
const mine = (v) => (v.you.seat >= 0 ? v.seats[v.you.seat] : null);
const playing = (v) => { const m = mine(v); return !!(m && m.alive); };
const fmtX = (x) => (x >= 100 ? x.toFixed(0) : x.toFixed(2)) + '×';
// canvas cannot read CSS variables: resolve seat colours like var(--s0) once
const rc = {};
function cssColor(c) {
  if (!c || !c.startsWith('var(')) return c || '#94a3b8';
  if (rc[c]) return rc[c];
  const t = document.createElement('i'); t.style.color = c; document.body.appendChild(t);
  const r = getComputedStyle(t).color; t.remove();
  return (rc[c] = r);
}
const netTxt = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + C.fmt(Math.abs(n));

/* ---------- chips (shared by roulette, crash and plinko) ---------- */
// A row of denominations the player can afford; picking one stores it in `st.chip`.
function chipRow(root, v, onPick) {
  const me = mine(v), cap = me ? me.balance : 0, min = v.limits.min;
  const sig = `${cap}|${min}`;
  if (root._sig === sig) { $$('.chip', root).forEach((b) => b.classList.toggle('sel', +b.dataset.v === st.chip)); return; }
  root._sig = sig;
  const list = C.DENOMS.filter((d) => d <= Math.max(cap, 1)).slice(-8);
  if (!list.includes(st.chip)) st.chip = list.find((d) => d >= min) || list[0] || min;
  root.innerHTML = '';
  for (const d of list) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = `chip ${C.chipClass(d)}${d === st.chip ? ' sel' : ''}`; b.dataset.v = d;
    b.innerHTML = `<span>${C.short(d)}</span>`;
    b.addEventListener('click', () => { st.chip = d; C.sfx.chip(); $$('.chip', root).forEach((x) => x.classList.toggle('sel', x === b)); if (onPick) onPick(d); });
    root.appendChild(b);
  }
}

/* ---------- common frame: player strip, bar, result foot ---------- */
function buildFrame() {
  $('#arena').innerHTML = `<div class="ar-players" id="arPlayers"></div><div class="ar-bar"><i id="arBar"></i></div><div class="ar-stage" id="arStage"></div><div class="ar-foot" id="arFoot"><span id="arRes"></span><button class="btn primary" id="arNext">Next round</button></div>`;
  $('#arNext').addEventListener('click', () => C.act('next'));
}
function updatePlayers(v, statusOf) {
  const a = v.arcade, items = [];
  v.seats.forEach((s, i) => {
    if (!s) return;
    const stat = s.alive ? statusOf(i, s) : { t: 'OUT', k: 'out' };
    const r = a.res && a.res[i] && a.res[i].stake ? a.res[i] : null;
    items.push([i, s.name, s.balance, stat.t || '', stat.k || '', r ? r.net : null]);
  });
  const sig = JSON.stringify([items, v.you.seat]);
  if (st.sig.players === sig) return;
  st.sig.players = sig;
  $('#arPlayers').innerHTML = items.map(([i, name, bal, t, k, net]) => `<div class="arp${k ? ' ' + k : ''}${i === v.you.seat ? ' me' : ''}" style="--c:${C.colorOf(name, i)}">${C.avatar(name, i, 'sm')}<div class="who"><b>${C.esc(name)}</b><span><i class="coin"></i>${C.fmt(bal)}${net != null ? `<em class="${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}">${netTxt(net)}</em>` : ''}</span></div><small>${C.esc(t)}</small></div>`).join('');
}
function updateFoot(v) {
  const a = v.arcade, show = v.phase === 'settled' && playing(v) && !v.over;
  $('#arFoot').classList.toggle('on', show);
  if (!show) return;
  const me = mine(v), r = a.res && a.res[v.you.seat];
  $('#arRes').innerHTML = r && r.stake ? `<b class="${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''}">${r.net > 0 ? 'You won ' : r.net < 0 ? 'You lost ' : 'Break even '}${r.net ? C.fmt(Math.abs(r.net)) : ''}</b>${r.note ? `<small>${C.esc(r.note)}</small>` : ''}` : '<small>You sat this one out</small>';
  $('#arNext').disabled = !!me.voted;
  $('#arNext').innerHTML = me.voted ? 'Waiting for others' : `Next round${C.ic('arrow-right')}`;
}
function frameBar(v) {
  const now = C.serverNow(), on = v.timerAt && (v.timerKind === 'bet') && v.phase === 'arcade';
  const frac = on && v.timerDur ? clamp((v.timerAt - now) / v.timerDur, 0, 1) : 0;
  $('#arBar').style.transform = `scaleX(${frac})`;
  $('#arBar').parentElement.style.visibility = on ? 'visible' : 'hidden';
  if (v.phase === 'settled' && v.timerKind === 'next' && playing(v) && !mine(v).voted && !v.over) {
    const s = Math.ceil(Math.max(0, v.timerAt - now) / 1000);
    $('#arNext').innerHTML = `Next round in ${s}s${C.ic('arrow-right')}`;
  }
}

/* =====================================================================
   Roulette
   ===================================================================== */
const EU = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const US = [0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1, 37, 27, 10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2];
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const numColor = (n) => (n === 0 || n === 37 ? 'green' : REDS.has(n) ? 'red' : 'black');
const numLabel = (n) => (n === 37 ? '00' : String(n));
const CELL = 44;

const roulette = {
  build(v) {
    const wheel = v.arcade.wheel;
    $('#arStage').innerHTML = `<div class="rl"><div class="rl-top"><div class="rl-wheel"><svg id="rlWheel" viewBox="-104 -104 208 208"></svg><div class="rl-res" id="rlRes"></div></div><div class="rl-side"><div class="rl-hist" id="rlHist"></div><div class="rl-info" id="rlInfo"></div></div></div><svg class="rl-table" id="rlTable"></svg></div>
      <div class="ar-ctl" id="rlCtl"><div class="chips" id="rlChips"></div><div class="rl-stake"><span>Your bets</span><b id="rlStake">0</b></div><div class="mini-row"><button class="btn mini" id="rlUndo">Undo</button><button class="btn mini" id="rlClear">Clear</button><button class="btn mini" id="rlRebet">Rebet</button><button class="btn mini" id="rlDouble">2×</button></div><button class="btn primary big" id="rlLock"></button></div>`;
    this.wheel = wheel;
    this.pos = {};
    this.buildWheel(wheel);
    this.buildTable(wheel);
    $('#rlUndo').addEventListener('click', () => C.act('rl_undo'));
    $('#rlClear').addEventListener('click', () => C.act('rl_clear'));
    $('#rlRebet').addEventListener('click', () => C.act('rl_rebet'));
    $('#rlDouble').addEventListener('click', () => C.act('rl_double'));
    $('#rlLock').addEventListener('click', () => { const a = st.v.arcade; C.act('rl_lock', { value: !a.locked[st.v.you.seat] }); });
    $('#rlTable').addEventListener('click', (e) => {
      const t = e.target.closest('[data-t]'); if (!t || !st.v) return;
      const a = st.v.arcade;
      if (st.v.phase !== 'arcade' || a.stage !== 'bet' || !playing(st.v) || a.locked[st.v.you.seat]) return;
      const b = { t: t.dataset.t, a: isNaN(+t.dataset.a) ? t.dataset.a : +t.dataset.a, amt: st.chip };
      if (t.dataset.b != null && t.dataset.b !== '') b.b = +t.dataset.b;
      C.sfx.chip();
      C.act('rl_bet', b);
    });
    this.lastN = null;
  },
  buildWheel(wheel) {
    const g = $('#rlWheel'); g.innerHTML = '';
    const order = wheel === 'american' ? US : EU, N = order.length, step = 360 / N;
    svgEl('circle', { r: 102, fill: '#3b2a1c', stroke: '#c9a24b', 'stroke-width': 2 }, g);
    const rot = svgEl('g', { id: 'rlRot' }, g);
    order.forEach((n, i) => {
      const a0 = (i - 0.5) * step - 90, a1 = (i + 0.5) * step - 90, p = (r, a) => `${(r * Math.cos((a * Math.PI) / 180)).toFixed(2)},${(r * Math.sin((a * Math.PI) / 180)).toFixed(2)}`;
      svgEl('path', { d: `M${p(60, a0)} L${p(86, a0)} A86,86 0 0 1 ${p(86, a1)} L${p(60, a1)} A60,60 0 0 0 ${p(60, a0)}Z`, fill: numColor(n) === 'red' ? '#b91c1c' : numColor(n) === 'black' ? '#18181b' : '#15803d', stroke: '#d6b25a', 'stroke-width': 0.6 }, rot);
      const t = svgEl('text', { x: 0, y: -73, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': N > 37 ? 7 : 8.2, fill: '#fff', 'font-weight': 700, transform: `rotate(${i * step})` }, rot);
      t.textContent = numLabel(n);
    });
    svgEl('circle', { r: 56, fill: '#2a1d12', stroke: '#c9a24b', 'stroke-width': 1.5 }, rot);
    svgEl('circle', { r: 30, fill: '#c9a24b', opacity: 0.9 }, rot);
    svgEl('circle', { r: 10, fill: '#7c5a16' }, rot);
    this.ball = svgEl('circle', { r: 4.2, fill: '#f8fafc', stroke: '#94a3b8', 'stroke-width': 0.6, cx: 0, cy: -95, opacity: 0 }, g);
    this.rot = rot;
  },
  buildTable(wheel) {
    const T = $('#rlTable'), pos = this.pos, us = wheel === 'american';
    T.setAttribute('viewBox', '-6 -8 628 226');
    T.innerHTML = '';
    const cell = (x, y, w, h, cls, label, data, key, cx, cy) => {
      const g = svgEl('g', { class: 'rc ' + cls, ...data }, T);
      svgEl('rect', { x, y, width: w, height: h, rx: 3 }, g);
      if (label != null) { const t = svgEl('text', { x: x + w / 2, y: y + h / 2 + 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, g); t.textContent = label; }
      if (key) pos[key] = { x: cx != null ? cx : x + w / 2, y: cy != null ? cy : y + h / 2 };
      return g;
    };
    // zero(s)
    if (us) {
      cell(0, 0, CELL, CELL * 1.5, 'green', '00', { 'data-t': 'n', 'data-a': 37, 'data-n': 37 }, 'n:37');
      cell(0, CELL * 1.5, CELL, CELL * 1.5, 'green', '0', { 'data-t': 'n', 'data-a': 0, 'data-n': 0 }, 'n:0');
    } else cell(0, 0, CELL, CELL * 3, 'green', '0', { 'data-t': 'n', 'data-a': 0, 'data-n': 0 }, 'n:0');
    // numbers
    for (let c = 0; c < 12; c++) for (let r = 0; r < 3; r++) {
      const n = 3 * c + 3 - r;
      cell(CELL + c * CELL, r * CELL, CELL, CELL, numColor(n), n, { 'data-t': 'n', 'data-a': n, 'data-n': n }, 'n:' + n);
    }
    // columns 2:1 and outside bets
    for (let r = 0; r < 3; r++) cell(CELL + 12 * CELL, r * CELL, CELL, CELL, 'out', '2:1', { 'data-t': 'cl', 'data-a': 3 - r }, 'cl:' + (3 - r));
    for (let d = 0; d < 3; d++) cell(CELL + d * 4 * CELL, 3 * CELL + 4, 4 * CELL, 36, 'out', ['1st 12', '2nd 12', '3rd 12'][d], { 'data-t': 'dz', 'data-a': d + 1 }, 'dz:' + (d + 1));
    const outs = [['1–18', 'hl', 'low', ''], ['EVEN', 'oe', 'even', ''], ['', 'rb', 'red', 'red'], ['', 'rb', 'black', 'black'], ['ODD', 'oe', 'odd', ''], ['19–36', 'hl', 'high', '']];
    outs.forEach(([lbl, t, a, cls], i) => {
      const g = cell(CELL + i * 2 * CELL, 3 * CELL + 44, 2 * CELL, 36, 'out ' + cls, lbl, { 'data-t': t, 'data-a': a }, t + ':' + a);
      if (cls) svgEl('path', { d: `M${CELL + i * 2 * CELL + CELL} ${3 * CELL + 50} l14 12 l-14 12 l-14 -12z`, class: 'dia ' + cls }, g);
    });
    // hotspots: splits, streets, corners, lines (drawn last so they sit on top)
    const hs = (x, y, w, h, key, data, px, py) => {
      const r = svgEl('rect', { x, y, width: w, height: h, class: 'hot', ...data }, T);
      pos[key] = { x: px, y: py };
      return r;
    };
    for (let c = 0; c < 12; c++) for (let r = 0; r < 3; r++) {
      const n = 3 * c + 3 - r, x0 = CELL + c * CELL, y0 = r * CELL;
      if (c < 11) hs(x0 + CELL - 6, y0 + 10, 12, CELL - 20, `sp:${n}-${n + 3}`, { 'data-t': 'sp', 'data-a': n, 'data-b': n + 3 }, x0 + CELL, y0 + CELL / 2);
      if (r < 2) hs(x0 + 10, y0 + CELL - 6, CELL - 20, 12, `sp:${n - 1}-${n}`, { 'data-t': 'sp', 'data-a': n - 1, 'data-b': n }, x0 + CELL / 2, y0 + CELL);
      if (c < 11 && r < 2) { const lo = 3 * c + 2 - r; hs(x0 + CELL - 7, y0 + CELL - 7, 14, 14, `co:${lo}`, { 'data-t': 'co', 'data-a': lo }, x0 + CELL, y0 + CELL); }
      if (r === 0) {
        const lo = 3 * c + 1;
        hs(x0 + 10, -6, CELL - 20, 12, `st:${lo}`, { 'data-t': 'st', 'data-a': lo }, x0 + CELL / 2, 0);
        if (c < 11) hs(x0 + CELL - 7, -6, 14, 12, `li:${lo}`, { 'data-t': 'li', 'data-a': lo }, x0 + CELL, 0);
      }
    }
    const zs = us ? [[37, 3, 22], [37, 2, 55], [0, 2, 77], [0, 1, 110]] : [[0, 3, 22], [0, 2, 66], [0, 1, 110]];
    for (const [z, n, y] of zs) hs(CELL - 6, y - 10, 12, 20, `sp:${Math.min(z, n)}-${Math.max(z, n)}`, { 'data-t': 'sp', 'data-a': z, 'data-b': n }, CELL, y);
    if (us) hs(8, CELL * 1.5 - 6, CELL - 16, 12, 'sp:0-37', { 'data-t': 'sp', 'data-a': 0, 'data-b': 37 }, CELL / 2, CELL * 1.5);
    this.chipsG = svgEl('g', { class: 'rl-chips' }, T);
  },
  update(v) {
    const a = v.arcade, me = v.you.seat, ok = playing(v), bet = a.stage === 'bet' && v.phase === 'arcade';
    if (this.wheel !== a.wheel) { this.build(v); return this.update(v); }
    const locked = !!a.locked[me];
    const sig = JSON.stringify([a.bets, a.others, a.stage, a.n, v.seats.map((s) => s && s.color), me, locked]);
    if (st.sig.rl !== sig) {
      st.sig.rl = sig;
      this.paintChips(v);
    }
    chipRow($('#rlChips'), v);
    $('#rlStake').textContent = C.fmt(a.stake[me] || 0);
    const can = ok && bet && !locked;
    $$('#rlCtl .btn.mini, #rlChips .chip').forEach((b) => (b.disabled = !can));
    $('#rlUndo').disabled = !can || !a.bets.length;
    $('#rlClear').disabled = !can || !a.bets.length;
    $('#rlRebet').disabled = !can || !a.prev.length;
    $('#rlDouble').disabled = !can || !a.bets.length;
    const lock = $('#rlLock'), solo = a.solo;
    lock.disabled = !ok || !bet;
    lock.classList.toggle('on', locked);
    lock.innerHTML = !bet ? (a.stage === 'spin' ? 'No more bets' : 'Bets closed') : locked ? 'Unlock' : (a.stake[me] > 0 ? (solo ? 'Spin' : 'Lock in') : (solo ? 'Spin' : 'Sit out')) + (a.stake[me] > 0 ? C.ic('play') : '');
    $('#rlTable').classList.toggle('off', !can);
    // history strip
    const hsig = a.hist.join(',') + a.wheel;
    if (st.sig.rlh !== hsig) { st.sig.rlh = hsig; $('#rlHist').innerHTML = a.hist.map((n) => `<i class="n ${numColor(n)}">${numLabel(n)}</i>`).join(''); }
    const who = v.seats.map((s, i) => (s && s.alive && a.locked[i] ? s.name : null)).filter(Boolean);
    $('#rlInfo').textContent = a.stage === 'bet' ? (ok ? `${a.wheel === 'american' ? 'American' : 'European'} wheel · place your bets${who.length ? ` · ${who.length} locked in` : ''}` : 'Betting is open') : a.stage === 'spin' ? 'No more bets' : '';
    // result highlight
    const done = a.n != null && (a.stage === 'done' || (a.stage === 'spin' && C.serverNow() - a.spinAt >= a.spinMs));
    $$('#rlTable .rc.hit').forEach((e) => e.classList.remove('hit'));
    if (done) { const e = $(`#rlTable .rc[data-n="${a.n}"]`); if (e) e.classList.add('hit'); }
    const res = $('#rlRes');
    res.className = 'rl-res' + (done ? ' on ' + numColor(a.n) : '');
    res.textContent = done ? numLabel(a.n) : '';
    if (done && this.lastN !== a.round + ':' + a.n) {
      this.lastN = a.round + ':' + a.n;
      const r = a.res && a.res[me];
      if (r && r.stake) setTimeout(() => (r.net > 0 ? C.sfx.win() : r.net < 0 ? C.sfx.lose() : C.sfx.push()), 150);
    }
  },
  paintChips(v) {
    const a = v.arcade, g = this.chipsG; g.innerHTML = '';
    const stack = {};
    const put = (k, amt, color, mineChip) => {
      const p = this.pos[k]; if (!p) return;
      const i = stack[k] = (stack[k] || 0) + 1;
      const c = svgEl('g', { class: 'rl-chip' + (mineChip ? ' mine' : ''), transform: `translate(${p.x + (i - 1) * 3},${p.y - (i - 1) * 3})` }, g);
      svgEl('circle', { r: 11, fill: color, stroke: '#fff', 'stroke-width': 1.6, 'stroke-dasharray': '3 2.2' }, c);
      const t = svgEl('text', { y: 1, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, c); t.textContent = C.short(amt);
    };
    a.others.forEach((list, s) => { if (v.seats[s]) for (const b of list) put(b.k, b.amt, C.colorOf(v.seats[s].name, s), false); });
    for (const b of a.bets) put(b.k, b.amt, '#0f172a', true);
  },
  statusOf(v, i) {
    const a = v.arcade;
    if (a.stage === 'bet') return a.locked[i] ? { t: 'LOCKED IN', k: 'stand' } : { t: 'BETTING', k: 'think' };
    const r = a.res && a.res[i];
    return r && r.stake ? { t: r.note, k: r.net > 0 ? 'win' : 'lose' } : { t: a.stage === 'spin' ? 'SPINNING' : '', k: '' };
  },
  frame(v, now) {
    const a = v.arcade;
    const order = a.wheel === 'american' ? US : EU, N = order.length, step = 360 / N;
    const spinning = a.stage !== 'bet' && a.n != null;
    $('#arStage .rl').classList.toggle('big', spinning); // bigger wheel, smaller betting table while it spins
    if (!spinning) {
      // idle: the wheel turns slowly, carrying on from wherever the last spin left it
      if (this.restAt == null) { this.restAt = now; this.rest = this.W || 0; }
      this.W = this.rest + ((now - this.restAt) / 1000) * 18;
      this.rot.setAttribute('transform', `rotate(${this.W.toFixed(2)})`);
      this.ball.setAttribute('opacity', 0);
      this.spinKey = null;
      return;
    }
    this.restAt = null;
    if (this.spinKey !== a.spinAt) { this.spinKey = a.spinAt; this.w0 = this.W || 0; }
    const p = clamp((now - a.spinAt) / a.spinMs, 0, 1), target = order.indexOf(a.n) * step;
    // the wheel spins up, then eases to a stop with the winning pocket under the ball at the top
    const w1 = this.w0 + 1080 + ((((-target - this.w0 - 1080) % 360) + 360) % 360);
    this.W = this.w0 + (w1 - this.w0) * (1 - Math.pow(1 - p, 3));
    this.rot.setAttribute('transform', `rotate(${this.W.toFixed(2)})`);
    // the ball runs the other way, drops inward and settles in the pocket at the top
    const eb = 1 - Math.pow(1 - p, 2.4);
    const th = -360 * 6 * (1 - eb);
    let r = 94;
    if (p > 0.5) { const q = clamp((p - 0.5) / 0.38, 0, 1); r = 94 - 24 * (q * q * (3 - 2 * q)); }
    if (p > 0.88 && p < 1) r += 3.2 * Math.sin((p - 0.88) * 60) * (1 - p) * 8;
    const ang = ((th - 90) * Math.PI) / 180;
    this.ball.setAttribute('cx', (r * Math.cos(ang)).toFixed(2));
    this.ball.setAttribute('cy', (r * Math.sin(ang)).toFixed(2));
    this.ball.setAttribute('opacity', 1);
    const done = p >= 1, res = $('#rlRes');
    if (done && !res.classList.contains('on')) this.update(v);
  },
};

/* =====================================================================
   Crash
   ===================================================================== */
const crash = {
  build() {
    $('#arStage').innerHTML = `<div class="cr"><div class="cr-hist" id="crHist"></div><div class="cr-plot"><canvas id="crCv"></canvas><div class="cr-big" id="crBig"></div><div class="cr-sub" id="crSub"></div></div></div>
      <div class="ar-ctl cr-ctl" id="crCtl"><div class="chips" id="crChips"></div><div class="cr-fields"><label>Bet<input id="crAmt" type="number" min="1" step="1" inputmode="numeric"></label><label>Auto cash-out<input id="crAuto" type="number" min="1.01" max="100" step="0.01" inputmode="decimal" placeholder="off"></label></div><div class="mini-row"><button class="btn mini" id="crMin">Min</button><button class="btn mini" id="crHalf">½</button><button class="btn mini" id="crDbl">2×</button><button class="btn mini" id="crMax">Max</button></div><div class="cr-btns"><button class="btn primary big" id="crGo"></button><button class="btn ghost" id="crCancel">Cancel bet</button></div></div>`;
    this.cv = $('#crCv'); this.g = this.cv.getContext('2d');
    this.amt = 0; this.round = -1;
    const clampAmt = () => { const me = mine(st.v), cap = me ? Math.min(st.v.limits.max, me.balance + (this.myBet ? this.myBet.amt : 0)) : 0; this.amt = clamp(Math.floor(+$('#crAmt').value) || 0, 0, cap); $('#crAmt').value = this.amt || ''; this.refresh(); };
    $('#crAmt').addEventListener('input', () => { this.amt = Math.floor(+$('#crAmt').value) || 0; this.refresh(); });
    $('#crAmt').addEventListener('change', clampAmt);
    const setAmt = (n) => { this.amt = n; $('#crAmt').value = n; clampAmt(); };
    $('#crMin').addEventListener('click', () => setAmt(st.v.limits.min));
    $('#crHalf').addEventListener('click', () => setAmt(Math.max(st.v.limits.min, Math.floor(this.amt / 2))));
    $('#crDbl').addEventListener('click', () => setAmt((this.amt || st.v.limits.min) * 2));
    $('#crMax').addEventListener('click', () => { C.sfx.chip(); setAmt(1e12); });
    $('#crGo').addEventListener('click', () => {
      const v = st.v, a = v.arcade;
      if (a.stage === 'bet') C.act('cr_bet', { amt: this.amt, auto: $('#crAuto').value || 0 });
      else if (a.stage === 'run') C.act('cr_cash');
    });
    $('#crCancel').addEventListener('click', () => C.act('cr_cancel'));
    $('#crAuto').addEventListener('input', () => this.refresh());
    this.start = null;
  },
  refresh() {
    const v = st.v; if (!v) return;
    const a = v.arcade, ok = playing(v), me = mine(v), bet = a.bets[v.you.seat];
    const go = $('#crGo'), cancel = $('#crCancel');
    const now = C.serverNow(), el = now - a.runAt, m = a.stage === 'run' && el > 0 ? Math.exp(a.k * el) : 1;
    const inBet = a.stage === 'bet' && v.phase === 'arcade';
    $$('#crCtl .mini-row .btn, #crChips .chip, #crAmt, #crAuto').forEach((b) => (b.disabled = !(ok && inBet)));
    cancel.classList.toggle('hidden', !(ok && inBet && bet));
    const cap = me ? Math.min(v.limits.max, me.balance + (bet ? bet.amt : 0)) : 0;
    if (inBet) {
      const valid = this.amt >= v.limits.min && this.amt <= cap;
      go.disabled = !ok || !valid;
      go.innerHTML = bet ? `Update bet · ${C.fmt(this.amt)}` : `Place bet · ${C.fmt(this.amt)}`;
      go.className = 'btn primary big';
    } else if (a.stage === 'run' && ok && bet && !bet.cashed) {
      go.disabled = el < 0;
      const win = Math.floor(bet.amt * Math.floor(m * 100) / 100);
      go.innerHTML = `Cash out ${fmtX(Math.floor(m * 100) / 100)}<small>+${C.fmt(win - bet.amt)}</small>`;
      go.className = 'btn big cash';
    } else {
      go.disabled = true;
      go.className = 'btn primary big';
      go.innerHTML = a.stage === 'run' ? (bet && bet.cashed ? `Cashed out ${fmtX(bet.cashed)}` : 'Flight in progress') : 'Waiting for next flight';
    }
  },
  update(v) {
    const a = v.arcade, me = v.you.seat, bet = a.bets[me];
    this.myBet = bet;
    chipRow($('#crChips'), v, (d) => { if (v.arcade.stage === 'bet') { this.amt = Math.min(st.v.limits.max, (this.amt || 0) + d); $('#crAmt').value = this.amt; this.refresh(); } });
    if (this.round !== a.round) { // new round: start from last bet or the minimum
      this.round = a.round;
      if (a.stage === 'bet') { const m = mine(v); this.amt = clamp(this.lastAmt || v.limits.min, v.limits.min, m ? Math.min(v.limits.max, m.balance) : v.limits.min); $('#crAmt').value = this.amt; }
    }
    if (bet && a.stage === 'bet') { this.lastAmt = bet.amt; if (document.activeElement !== $('#crAmt')) { this.amt = bet.amt; $('#crAmt').value = bet.amt; } }
    if (bet && a.stage === 'bet' && document.activeElement !== $('#crAuto') && !$('#crAuto').value && bet.auto) $('#crAuto').value = bet.auto;
    const hsig = a.hist.join(',');
    if (st.sig.crh !== hsig) { st.sig.crh = hsig; $('#crHist').innerHTML = a.hist.map((x) => `<i class="${x < 2 ? 'lo' : x < 10 ? 'mid' : 'hi'}">${fmtX(x)}</i>`).join(''); }
    if (this.lastStage !== a.stage + ':' + a.round) {
      const prev = this.lastStage; this.lastStage = a.stage + ':' + a.round;
      if (a.stage === 'done' && prev && prev.startsWith('run')) {
        const r = a.res && a.res[me];
        if (r && r.stake) setTimeout(() => (r.net > 0 ? C.sfx.win() : C.sfx.lose()), 100);
      }
    }
    this.refresh();
  },
  statusOf(v, i) {
    const a = v.arcade, b = a.bets[i];
    if (a.stage === 'bet') return b ? { t: `BET ${C.short(b.amt)}`, k: 'stand' } : { t: 'BETTING', k: 'think' };
    if (!b) return { t: 'WATCHING', k: '' };
    if (b.cashed) return { t: `CASHED ${fmtX(b.cashed)}`, k: 'win' };
    return a.stage === 'done' ? { t: 'CRASHED', k: 'lose' } : { t: `IN · ${C.short(b.amt)}`, k: 'stand' };
  },
  frame(v, now) {
    const a = v.arcade, cv = this.cv, box = cv.parentElement;
    const w = box.clientWidth, h = box.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = this.g; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const run = a.stage === 'run', done = a.stage === 'done';
    const el = run ? now - a.runAt : done && a.crashAt ? Math.log(a.crashAt) / a.k : 0;
    const m = el > 0 ? Math.exp(a.k * el) : 1;
    const big = $('#crBig'), sub = $('#crSub');
    const bet = a.bets[v.you.seat];
    if (a.stage === 'bet') { big.textContent = ''; sub.textContent = v.timerAt && v.phase === 'arcade' ? `Take-off in ${Math.max(0, Math.ceil((v.timerAt - now) / 1000))}s` : ''; big.className = 'cr-big'; }
    else if (run && el < 0) { big.textContent = 'Launching…'; big.className = 'cr-big wait'; sub.textContent = ''; }
    else if (run) { big.textContent = fmtX(Math.floor(m * 100) / 100); big.className = 'cr-big run'; sub.textContent = bet && !bet.cashed ? `${C.fmt(Math.floor(bet.amt * m))} if you cash out` : bet && bet.cashed ? `Cashed out at ${fmtX(bet.cashed)}` : ''; }
    else { big.textContent = a.crashAt ? fmtX(a.crashAt) : ''; big.className = 'cr-big dead'; sub.textContent = 'CRASHED'; }
    if (run) this.refresh();
    // axes
    const padL = 36, padB = 22, pw = w - padL - 10, ph = h - padB - 10;
    const tMax = Math.max(6000, el * 1.12), mMax = Math.max(2, m * 1.2);
    const X = (t) => padL + (t / tMax) * pw, Y = (x) => 10 + ph - ((x - 1) / (mMax - 1)) * ph;
    g.font = '11px Geist, system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,.45)'; g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1;
    const ticks = [1, 1.5, 2, 3, 5, 10, 20, 50, 100].filter((x) => x <= mMax);
    for (const x of ticks) { g.beginPath(); g.moveTo(padL, Y(x)); g.lineTo(w - 10, Y(x)); g.stroke(); g.fillText(x + '×', 4, Y(x) + 4); }
    if (el > 0) {
      const col = done ? '#f87171' : '#4ade80';
      g.beginPath(); g.moveTo(X(0), Y(1));
      const n = 60; for (let i = 1; i <= n; i++) { const t = (el * i) / n; g.lineTo(X(t), Y(Math.exp(a.k * t))); }
      g.lineWidth = 3.5; g.strokeStyle = col; g.lineJoin = 'round'; g.shadowColor = col; g.shadowBlur = 14; g.stroke(); g.shadowBlur = 0;
      g.lineTo(X(el), Y(1)); g.lineTo(X(0), Y(1)); g.closePath(); const gr = g.createLinearGradient(0, 10, 0, 10 + ph); gr.addColorStop(0, done ? 'rgba(248,113,113,.28)' : 'rgba(74,222,128,.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fill();
      const px = X(el), py = Y(m);
      if (!done) { g.fillStyle = '#fff'; g.beginPath(); g.arc(px, py, 5, 0, 6.3); g.fill(); }
      else { g.strokeStyle = '#fca5a5'; g.lineWidth = 3; for (const d of [[-8, -8, 8, 8], [-8, 8, 8, -8]]) { g.beginPath(); g.moveTo(px + d[0], py + d[1]); g.lineTo(px + d[2], py + d[3]); g.stroke(); } }
    }
  },
};

/* =====================================================================
   Plinko
   ===================================================================== */
const plinko = {
  build(v) {
    $('#arStage').innerHTML = `<div class="pl"><div class="pl-recent" id="plRecent"></div><div class="pl-plot"><canvas id="plCv"></canvas></div></div>
      <div class="ar-ctl pl-ctl" id="plCtl"><div class="chips" id="plChips"></div><div class="pl-opts"><div class="seg" id="plRows"></div><div class="seg" id="plRisk"></div></div><div class="pl-fields"><label>Bet<input id="plAmt" type="number" min="1" step="1" inputmode="numeric"></label><div class="mini-row"><button class="btn mini" id="plMin">Min</button><button class="btn mini" id="plHalf">½</button><button class="btn mini" id="plDbl">2×</button><button class="btn mini" id="plMax">Max</button></div></div><button class="btn primary big" id="plDrop">Drop ball</button></div>`;
    this.cv = $('#plCv'); this.g = this.cv.getContext('2d');
    this.rows = +C.LS.get('bj.pl.rows') || 12; this.risk = C.LS.get('bj.pl.risk') || 'medium'; this.amt = 0;
    if (!v.arcade.tables[this.rows]) this.rows = 12;
    $('#plRows').innerHTML = [8, 12, 16].map((r) => `<button type="button" data-r="${r}">${r}</button>`).join('');
    $('#plRisk').innerHTML = ['low', 'medium', 'high'].map((r) => `<button type="button" data-k="${r}">${r[0].toUpperCase() + r.slice(1)}</button>`).join('');
    $('#plRows').addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) { this.rows = +b.dataset.r; C.LS.set('bj.pl.rows', this.rows); this.refresh(); } });
    $('#plRisk').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) { this.risk = b.dataset.k; C.LS.set('bj.pl.risk', this.risk); this.refresh(); } });
    const setAmt = (n) => { const me = mine(st.v), cap = me ? Math.min(st.v.limits.max, me.balance) : 0; this.amt = clamp(Math.floor(n) || 0, 0, cap); $('#plAmt').value = this.amt || ''; this.refresh(); };
    $('#plAmt').addEventListener('input', () => { this.amt = Math.floor(+$('#plAmt').value) || 0; this.refresh(); });
    $('#plAmt').addEventListener('change', () => setAmt(+$('#plAmt').value));
    $('#plMin').addEventListener('click', () => setAmt(st.v.limits.min));
    $('#plHalf').addEventListener('click', () => setAmt(Math.max(st.v.limits.min, this.amt / 2)));
    $('#plDbl').addEventListener('click', () => setAmt((this.amt || st.v.limits.min) * 2));
    $('#plMax').addEventListener('click', () => { C.sfx.chip(); setAmt(1e12); });
    $('#plDrop').addEventListener('click', () => this.drop());
    this.seen = new Map(); this.flash = []; this.lastRecent = 0; this.init = false;
  },
  drop() {
    const v = st.v; if (!v || $('#plDrop').disabled) return;
    C.act('pl_drop', { amt: this.amt, rows: this.rows, risk: this.risk });
  },
  refresh() {
    const v = st.v; if (!v) return;
    const ok = playing(v) && v.phase === 'arcade', me = mine(v), cap = me ? Math.min(v.limits.max, me.balance) : 0;
    $$('#plRows button').forEach((b) => b.classList.toggle('on', +b.dataset.r === this.rows));
    $$('#plRisk button').forEach((b) => b.classList.toggle('on', b.dataset.k === this.risk));
    $$('#plCtl .mini-row .btn, #plChips .chip, #plAmt').forEach((b) => (b.disabled = !ok));
    $('#plDrop').disabled = !ok || this.amt < v.limits.min || this.amt > cap;
    $('#plDrop').innerHTML = `${C.ic('coins')}Drop ${C.fmt(this.amt || 0)}<kbd>Space</kbd>`;
  },
  update(v) {
    const a = v.arcade, me = mine(v);
    chipRow($('#plChips'), v, (d) => { this.amt = Math.min(st.v.limits.max, (this.amt || 0) + d); $('#plAmt').value = this.amt; this.refresh(); });
    if (!this.init) { this.init = true; this.amt = clamp(v.limits.min, 0, me ? me.balance : 0); $('#plAmt').value = this.amt; this.lastRecent = a.recent.length ? a.recent[0].id : 0; }
    else if (me && this.amt > me.balance && document.activeElement !== $('#plAmt')) { this.amt = Math.min(me.balance, v.limits.max); $('#plAmt').value = this.amt || ''; }
    for (const b of a.balls) this.seen.set(b.id, b);
    // landings: flash the slot and play a sound for my own balls
    for (const r of [...a.recent].reverse()) {
      if (r.id <= this.lastRecent) continue;
      this.lastRecent = r.id;
      const b = this.seen.get(r.id);
      if (b) this.flash.push({ rows: b.rows, risk: b.risk, slot: b.slot, at: performance.now(), win: r.net >= 0 });
      if (r.seat === v.you.seat) { if (r.net > 0) C.sfx.win(); else C.sfx.chip(); }
    }
    if (this.seen.size > 80) for (const k of [...this.seen.keys()].slice(0, 40)) this.seen.delete(k);
    const rsig = JSON.stringify(a.recent.map((r) => r.id));
    if (st.sig.plr !== rsig) st.sig.plr = rsig, $('#plRecent').innerHTML = a.recent.map((r) => `<i class="${r.mult >= 10 ? 'hi' : r.mult >= 2 ? 'mid' : r.mult >= 1 ? 'ok' : 'lo'}" style="--c:${C.colorOf(r.name, r.seat)}" title="${C.esc(r.name)} ${r.net >= 0 ? '+' : '−'}${C.fmt(Math.abs(r.net))}">${r.mult}×</i>`).join('');
    this.refresh();
  },
  statusOf(v, i) {
    const n = v.arcade.balls.filter((b) => b.seat === i).length;
    return n ? { t: `${n} BALL${n > 1 ? 'S' : ''} IN PLAY`, k: 'stand' } : { t: '', k: '' };
  },
  frame(v, now) {
    const a = v.arcade, cv = this.cv, box = cv.parentElement;
    const w = box.clientWidth, h = box.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!w || !h) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = this.g; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const R = this.rows, tbl = a.tables[R][this.risk];
    const slotH = 24, top = 14;
    const sp = Math.min((w - 16) / (R + 1.2), (h - slotH - top - 12) / ((R + 1) * 0.88 + 0.6));
    const rowH = sp * 0.88, cx = w / 2, y0 = top + rowH;
    const px = (row, j) => cx + (j - row / 2) * sp, py = (row) => y0 + row * rowH;
    // pegs
    g.fillStyle = 'rgba(255,255,255,.75)';
    for (let r = 0; r < R; r++) for (let j = 0; j <= r; j++) { g.beginPath(); g.arc(px(r, j), py(r), Math.max(1.4, sp * 0.06), 0, 6.3); g.fill(); }
    // slots
    const mx = Math.max(...tbl), fl = this.flash;
    // edges red, then orange, centre yellow (like the real thing)
    const col = (m) => { const t = m < 1 ? 0 : clamp(Math.log(m) / Math.log(mx), 0, 1); return `hsl(${48 - 46 * t} 92% ${56 - 8 * t}%)`; };
    for (let j = 0; j <= R; j++) {
      const x = px(R, j) , y = py(R) + 6, bw = sp * 0.88;
      let lift = 0;
      for (const f of fl) if (f.rows === R && f.risk === this.risk && f.slot === j) { const k = (performance.now() - f.at) / 700; if (k < 1) lift = 6 * Math.sin(k * Math.PI); }
      g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.roundRect ? g.roundRect(x - bw / 2, y - lift + 3, bw, slotH, 5) : g.rect(x - bw / 2, y - lift + 3, bw, slotH); g.fill();
      g.fillStyle = col(tbl[j]); g.beginPath(); g.roundRect ? g.roundRect(x - bw / 2, y - lift, bw, slotH, 5) : g.rect(x - bw / 2, y - lift, bw, slotH); g.fill();
      g.fillStyle = '#1a1205'; g.font = `700 ${Math.max(8, Math.min(12, sp * 0.4))}px Geist, system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(tbl[j] >= 100 ? Math.round(tbl[j]) : tbl[j], x, y - lift + slotH / 2 + 1);
    }
    this.flash = fl.filter((f) => performance.now() - f.at < 800);
    // balls
    for (const b of a.balls) {
      const own = b.seat === v.you.seat, r = b.rows;
      const total = b.landAt - b.at, t = clamp(now - b.at, 0, total), segs = r + 1, d = total / segs;
      const k = Math.min(segs - 1, Math.floor(t / d)), f = t / d - k;
      // waypoints: start above the first peg, then the peg row after each decision, ending in the slot
      let x = 0; const xs = [0]; for (let i = 0; i < r; i++) { x += b.bits[i] ? 0.5 : -0.5; xs.push(x); }
      const wp = (i) => (i === 0 ? { x: 0, y: y0 - rowH } : { x: i === 1 ? 0 : xs[i - 1], y: i === r + 1 ? py(r) + 6 + slotH / 2 : py(i - 1) });
      const A = wp(k), B = k + 1 === 1 ? { x: 0, y: py(0) } : wp(k + 1);
      const sm = f * f * (3 - 2 * f);
      const bx = cx + (A.x + (B.x - A.x) * sm) * sp, by = A.y + (B.y - A.y) * (f * f * 0.7 + f * 0.3) - Math.sin(f * Math.PI) * sp * 0.12;
      const small = r !== this.rows;
      g.globalAlpha = small ? 0.45 : 1;
      g.fillStyle = cssColor(C.colorOf(b.name, b.seat));
      g.strokeStyle = own ? '#fff' : 'rgba(0,0,0,.5)'; g.lineWidth = own ? 2 : 1;
      g.beginPath(); g.arc(bx, by, Math.max(3.5, sp * (small ? 0.16 : 0.22)), 0, 6.3); g.fill(); g.stroke();
      g.globalAlpha = 1;
    }
  },
};


/* =====================================================================
   Dice
   ===================================================================== */
const diceWins = (dir, T) => (dir === 'under' ? T : 9999 - T);
const diceMult = (wins) => Math.floor((9900 / wins) * 10000) / 10000;
const dice = {
  build() {
    $('#arStage').innerHTML = `<div class="dc"><div class="pl-recent" id="dcRecent"></div><div class="dc-main"><div class="dc-big" id="dcBig">—</div><div class="dc-sub" id="dcSub"></div>
      <div class="dc-track" id="dcTrack"><div class="dc-bar" id="dcBar"></div><div class="dc-mark" id="dcMark"></div><input type="range" id="dcRange" min="1" max="98.99" step="0.01"></div>
      <div class="dc-scale"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
      <div class="dc-stats"><div><small>Multiplier</small><b id="dcMult"></b></div><div><small>Win chance</small><b id="dcChance"></b></div><div><small>Payout</small><b id="dcPay"></b></div></div></div></div>
      <div class="ar-ctl dc-ctl" id="dcCtl"><div class="chips" id="dcChips"></div><div class="pl-opts"><div class="seg" id="dcDir"><button type="button" data-d="under">Roll under</button><button type="button" data-d="over">Roll over</button></div></div><div class="pl-fields"><label>Bet<input id="dcAmt" type="number" min="1" step="1" inputmode="numeric"></label><label>Target<input id="dcTarget" type="number" min="1" max="98.99" step="0.01" inputmode="decimal"></label><div class="mini-row"><button class="btn mini" id="dcMin">Min</button><button class="btn mini" id="dcHalf">½</button><button class="btn mini" id="dcDbl">2×</button><button class="btn mini" id="dcMax">Max</button></div></div><button class="btn primary big" id="dcGo"></button></div>`;
    this.dir = C.LS.get('bj.dc.dir') === 'under' ? 'under' : 'over';
    this.target = +C.LS.get('bj.dc.t') || 50;
    this.amt = 0; this.init = false; this.lastRecent = 0; this.shown = null;
    const setAmt = (n) => { const me = mine(st.v), cap = me ? Math.min(st.v.limits.max, me.balance) : 0; this.amt = clamp(Math.floor(n) || 0, 0, cap); $('#dcAmt').value = this.amt || ''; this.refresh(); };
    $('#dcAmt').addEventListener('input', () => { this.amt = Math.floor(+$('#dcAmt').value) || 0; this.refresh(); });
    $('#dcAmt').addEventListener('change', () => setAmt(+$('#dcAmt').value));
    $('#dcMin').addEventListener('click', () => setAmt(st.v.limits.min));
    $('#dcHalf').addEventListener('click', () => setAmt(Math.max(st.v.limits.min, this.amt / 2)));
    $('#dcDbl').addEventListener('click', () => setAmt((this.amt || st.v.limits.min) * 2));
    $('#dcMax').addEventListener('click', () => { C.sfx.chip(); setAmt(1e12); });
    const setT = (t) => { this.target = this.fit(t); C.LS.set('bj.dc.t', this.target); this.refresh(); };
    $('#dcRange').addEventListener('input', () => setT(+$('#dcRange').value));
    $('#dcTarget').addEventListener('change', () => setT(+$('#dcTarget').value));
    $('#dcDir').addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (b) { this.dir = b.dataset.d; C.LS.set('bj.dc.dir', this.dir); this.target = this.fit(this.target); this.refresh(); } });
    $('#dcGo').addEventListener('click', () => this.roll());
  },
  fit(t) { return this.dir === 'under' ? clamp(Math.round(t * 100) / 100, 1, 98) : clamp(Math.round(t * 100) / 100, 1.99, 98.99); },
  roll() { const b = $('#dcGo'); if (!st.v || b.disabled) return; C.act('dc_roll', { amt: this.amt, dir: this.dir, target: this.target }); },
  refresh() {
    const v = st.v; if (!v) return;
    const ok = playing(v) && v.phase === 'arcade', me = mine(v), cap = me ? Math.min(v.limits.max, me.balance) : 0;
    this.target = this.fit(this.target);
    const T = Math.round(this.target * 100), wins = diceWins(this.dir, T), mult = diceMult(wins);
    $$('#dcDir button').forEach((b) => b.classList.toggle('on', b.dataset.d === this.dir));
    $$('#dcCtl .mini-row .btn, #dcChips .chip, #dcAmt, #dcTarget, #dcRange, #dcDir button').forEach((b) => (b.disabled = !ok));
    if (document.activeElement !== $('#dcTarget')) $('#dcTarget').value = this.target.toFixed(2);
    $('#dcRange').value = this.target;
    const pct = this.target;
    $('#dcBar').style.background = this.dir === 'under' ? `linear-gradient(90deg,#16a34a ${pct}%,#b91c1c ${pct}%)` : `linear-gradient(90deg,#b91c1c ${pct}%,#16a34a ${pct}%)`;
    $('#dcMult').textContent = mult.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') + '×';
    $('#dcChance').textContent = (wins / 100).toFixed(2) + '%';
    $('#dcPay').textContent = C.fmt(Math.floor(this.amt * mult));
    $('#dcGo').disabled = !ok || this.amt < v.limits.min || this.amt > cap;
    $('#dcGo').innerHTML = `Roll ${C.fmt(this.amt || 0)}<kbd>Space</kbd>`;
  },
  update(v) {
    const a = v.arcade, me = mine(v);
    chipRow($('#dcChips'), v, (d) => { this.amt = Math.min(st.v.limits.max, (this.amt || 0) + d); $('#dcAmt').value = this.amt; this.refresh(); });
    if (!this.init) { this.init = true; this.amt = clamp(v.limits.min, 0, me ? me.balance : 0); $('#dcAmt').value = this.amt; this.lastRecent = a.recent.length ? a.recent[0].id : 0; }
    else if (me && this.amt > me.balance && document.activeElement !== $('#dcAmt')) { this.amt = Math.min(me.balance, v.limits.max); $('#dcAmt').value = this.amt || ''; }
    for (const r of [...a.recent].reverse()) {
      if (r.id <= this.lastRecent) continue;
      this.lastRecent = r.id; this.shown = r;
      if (r.seat === v.you.seat) { if (r.win) C.sfx.win(); else C.sfx.lose(); }
    }
    const rsig = JSON.stringify(a.recent.map((r) => r.id));
    if (st.sig.dcr !== rsig) { st.sig.dcr = rsig; $('#dcRecent').innerHTML = a.recent.map((r) => `<i class="${r.win ? 'ok' : 'lo'}" style="--c:${C.colorOf(r.name, r.seat)}" title="${C.esc(r.name)} ${r.net >= 0 ? '+' : '−'}${C.fmt(Math.abs(r.net))}">${(r.roll / 100).toFixed(2)}</i>`).join(''); }
    this.refresh();
  },
  statusOf(v, i) {
    const n = v.arcade.rolls.filter((b) => b.seat === i).length;
    return n ? { t: 'ROLLING', k: 'stand' } : { t: '', k: '' };
  },
  frame(v, now) {
    const a = v.arcade, big = $('#dcBig'), sub = $('#dcSub'), mark = $('#dcMark');
    const pend = a.rolls.some((b) => b.seat === v.you.seat);
    if (pend) { big.textContent = (Math.random() * 100).toFixed(2); big.className = 'dc-big roll'; sub.textContent = 'Rolling…'; mark.style.opacity = 0; return; }
    const r = this.shown;
    if (!r) { big.textContent = '—'; big.className = 'dc-big'; sub.textContent = 'Pick a target and roll'; mark.style.opacity = 0; return; }
    big.textContent = (r.roll / 100).toFixed(2);
    big.className = 'dc-big ' + (r.win ? 'win' : 'lose');
    sub.textContent = `${r.name} · roll ${r.dir} ${(r.T / 100).toFixed(2)} · ${r.win ? '+' : '−'}${C.fmt(Math.abs(r.net))}`;
    mark.style.opacity = 1; mark.style.left = (r.roll / 100) + '%'; mark.className = 'dc-mark ' + (r.win ? 'win' : 'lose');
  },
};

/* =====================================================================
   Mines
   ===================================================================== */
const minesMult = (m, k) => { let p = 1; for (let i = 0; i < k; i++) p *= (25 - i) / (25 - m - i); return k === 0 ? 1 : Math.floor(p * 0.99 * 10000) / 10000; };
const fmtM = (x) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)) + '×';
const GEM = '<svg viewBox="0 0 32 32" aria-hidden="true"><polygon points="16,3 27,12 16,29 5,12" fill="#16a34a"/><polygon points="16,3 27,12 5,12" fill="#4ade80"/><polygon points="16,3 21,12 16,29 11,12" fill="#22c55e"/><polygon points="9,8 14,6 12,11" fill="#fff" opacity=".55"/></svg>';
const BOMB = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M20 8c2-3 4-3 6-2" fill="none" stroke="#d6b25a" stroke-width="1.6" stroke-linecap="round"/><circle cx="27" cy="5.5" r="2" fill="#fbbf24"/><circle cx="14" cy="19" r="10" fill="#4c1d95"/><circle cx="14" cy="19" r="10" fill="none" stroke="#a78bfa" stroke-width="1"/><circle cx="10.5" cy="15.5" r="2.6" fill="#fff" opacity=".35"/><rect x="11" y="7.5" width="6" height="3.5" rx="1" fill="#6b7280"/></svg>';
const mines = {
  build() {
    $('#arStage').innerHTML = `<div class="mn"><div class="pl-recent" id="mnRecent"></div><div class="mn-main"><div class="ar-ctl mn-ctl" id="mnCtl"><div class="chips" id="mnChips"></div><div class="pl-fields"><label>Bet<input id="mnAmt" type="number" min="1" step="1" inputmode="numeric"></label><label>Mines<input id="mnCount" type="number" min="1" max="24" step="1" inputmode="numeric"></label><div class="mini-row"><button class="btn mini" id="mnMin">Min</button><button class="btn mini" id="mnHalf">½</button><button class="btn mini" id="mnDbl">2×</button><button class="btn mini" id="mnMax">Max</button></div></div><div class="seg" id="mnPre">${[1, 3, 5, 10, 24].map((n) => `<button type="button" data-n="${n}">${n}</button>`).join('')}</div><div class="cr-btns"><button class="btn primary big" id="mnGo"></button></div></div><div class="mn-board"><div class="mn-info" id="mnInfo"></div><div class="mn-wrap"><div class="mn-grid" id="mnGrid"></div><div class="mn-pop" id="mnPop"></div></div></div></div></div>`;
    const g = $('#mnGrid');
    for (let i = 0; i < 25; i++) { const b = document.createElement('button'); b.type = 'button'; b.className = 'mt'; b.dataset.i = i; g.appendChild(b); }
    this.count = Math.min(24, Math.max(1, +C.LS.get('bj.mn.m') || 3)); this.amt = 0; this.init = false; this.lastRecent = 0; this.prevK = 0; this.prevState = '';
    g.addEventListener('click', (e) => { const t = e.target.closest('.mt'); if (!t || t.disabled) return; C.act('mn_pick', { i: +t.dataset.i }); });
    const setAmt = (n) => { const me = mine(st.v), cap = me ? Math.min(st.v.limits.max, me.balance) : 0; this.amt = clamp(Math.floor(n) || 0, 0, cap); $('#mnAmt').value = this.amt || ''; this.refresh(); };
    $('#mnAmt').addEventListener('input', () => { this.amt = Math.floor(+$('#mnAmt').value) || 0; this.refresh(); });
    $('#mnAmt').addEventListener('change', () => setAmt(+$('#mnAmt').value));
    $('#mnMin').addEventListener('click', () => setAmt(st.v.limits.min));
    $('#mnHalf').addEventListener('click', () => setAmt(Math.max(st.v.limits.min, this.amt / 2)));
    $('#mnDbl').addEventListener('click', () => setAmt((this.amt || st.v.limits.min) * 2));
    $('#mnMax').addEventListener('click', () => { C.sfx.chip(); setAmt(1e12); });
    const setM = (n) => { this.count = clamp(Math.floor(n) || 1, 1, 24); C.LS.set('bj.mn.m', this.count); this.refresh(); };
    $('#mnCount').addEventListener('change', () => setM(+$('#mnCount').value));
    $('#mnPre').addEventListener('click', (e) => { const b = e.target.closest('[data-n]'); if (b) setM(+b.dataset.n); });
    $('#mnGo').addEventListener('click', () => {
      const v = st.v, gm = v.arcade.games[v.you.seat];
      if (gm && !gm.state) C.act('mn_cash'); else C.act('mn_start', { amt: this.amt, mines: this.count });
    });
  },
  refresh() {
    const v = st.v; if (!v) return;
    const a = v.arcade, ok = playing(v) && v.phase === 'arcade', me = mine(v), cap = me ? Math.min(v.limits.max, me.balance) : 0;
    const gm = a.games[v.you.seat], active = !!(gm && !gm.state);
    $$('#mnCtl .mini-row .btn, #mnChips .chip, #mnAmt, #mnCount, #mnPre button').forEach((b) => (b.disabled = !ok || active));
    $$('#mnPre button').forEach((b) => b.classList.toggle('on', +b.dataset.n === this.count));
    $('#mnCtl').classList.toggle('busy', active);
    if (document.activeElement !== $('#mnCount')) $('#mnCount').value = this.count;
    const go = $('#mnGo');
    if (active) {
      go.disabled = !ok || !gm.k;
      go.className = 'btn big cash';
      go.innerHTML = gm.k ? `Cash out ${fmtM(gm.mult)}<small>+${C.fmt(Math.floor(gm.amt * gm.mult) - gm.amt)}</small>` : 'Pick a tile';
    } else {
      go.disabled = !ok || this.amt < v.limits.min || this.amt > cap;
      go.className = 'btn primary big';
      go.innerHTML = `Start · ${C.fmt(this.amt || 0)}`;
    }
  },
  update(v) {
    const a = v.arcade, me = mine(v), gm = a.games[v.you.seat], active = !!(gm && !gm.state);
    chipRow($('#mnChips'), v, (d) => { if (!(st.v.arcade.games[st.v.you.seat] && !st.v.arcade.games[st.v.you.seat].state)) { this.amt = Math.min(st.v.limits.max, (this.amt || 0) + d); $('#mnAmt').value = this.amt; this.refresh(); } });
    if (!this.init) { this.init = true; this.amt = clamp(v.limits.min, 0, me ? me.balance : 0); $('#mnAmt').value = this.amt; this.lastRecent = a.recent.length ? a.recent[0].id : 0; }
    else if (me && this.amt > me.balance && !active && document.activeElement !== $('#mnAmt')) { this.amt = Math.min(me.balance, v.limits.max); $('#mnAmt').value = this.amt || ''; }
    // board
    const tiles = $$('#mnGrid .mt'), rev = new Set(gm && gm.rev ? gm.rev : []), mn = new Set(gm && gm.mines ? gm.mines : []);
    tiles.forEach((t, i) => {
      const isRev = rev.has(i), isMine = mn.has(i), hit = gm && gm.state === 'bust' && gm.hit === i;
      t.className = 'mt' + (isRev && !isMine ? ' gem' : '') + (isMine ? (hit ? ' bomb hit' : ' bomb') : '') + (isRev || isMine ? ' open' : '');
      const over = gm && gm.state; // game finished: show what was hidden
      if (over && !isRev && !isMine) t.classList.add('ghost');
      t.innerHTML = isMine ? BOMB : (isRev || (over && !isMine)) ? GEM : '';
      t.disabled = !(active && playing(v) && !isRev) || !!v.paused;
    });
    // sound + info
    if (gm && gm.rev) {
      if (gm.rev.length > this.prevK && active) C.sfx.chip();
      if (gm.state && gm.state !== this.prevState) { if (gm.state === 'bust') C.sfx.lose(); else C.sfx.win(); }
      this.prevK = active ? gm.rev.length : 0; this.prevState = gm.state || '';
    } else { this.prevK = 0; this.prevState = ''; }
    const info = $('#mnInfo'), pop = $('#mnPop');
    const box = (l, val, c) => `<div${c ? ` class="${c}"` : ''}><small>${l}</small><b>${val}</b></div>`;
    if (active) {
      const left = 25 - gm.m - gm.k, next = left > 0 ? minesMult(gm.m, gm.k + 1) : 0;
      info.innerHTML = box('Bet', C.fmt(gm.amt)) + box('Multiplier', fmtM(gm.mult), 'good') + box('Next tile', next ? fmtM(next) : '—') + box('Payout', C.fmt(Math.floor(gm.amt * gm.mult)));
    } else if (gm && gm.state) {
      info.innerHTML = box('Bet', C.fmt(gm.amt)) + box('Multiplier', gm.state === 'bust' ? '0×' : fmtM(gm.mult), gm.state === 'bust' ? 'bad' : 'good') + box('Mines', gm.m) + box('Payout', gm.state === 'bust' ? '0' : C.fmt(gm.pay), gm.state === 'bust' ? 'bad' : 'good');
    } else info.innerHTML = box('Bet', C.fmt(this.amt || 0)) + box('Multiplier', '1×') + box('Mines', this.count) + box('Payout', '0');
    const popSig = gm && gm.state ? gm.state + (gm.pay || 0) + gm.k : '';
    if (st.sig.mnp !== popSig) {
      st.sig.mnp = popSig;
      pop.className = 'mn-pop' + (gm && gm.state ? ' on ' + (gm.state === 'bust' ? 'bad' : 'good') : '');
      pop.innerHTML = gm && gm.state ? (gm.state === 'bust' ? `<b>BUST</b><i></i><span>−${C.fmt(gm.amt)}</span>` : `<b>${fmtM(gm.mult)}</b><i></i><span>+${C.fmt(gm.pay - gm.amt)}</span>`) : '';
    }
    for (const r of [...a.recent].reverse()) { if (r.id > this.lastRecent) this.lastRecent = r.id; }
    const rsig = JSON.stringify(a.recent.map((r) => r.id));
    if (st.sig.mnr !== rsig) { st.sig.mnr = rsig; $('#mnRecent').innerHTML = a.recent.map((r) => `<i class="${r.bust ? 'lo' : r.mult >= 5 ? 'hi' : 'ok'}" style="--c:${C.colorOf(r.name, r.seat)}" title="${C.esc(r.name)} ${r.net >= 0 ? '+' : '−'}${C.fmt(Math.abs(r.net))}">${r.bust ? '💥' : fmtM(r.mult)}</i>`).join(''); }
    this.refresh();
  },
  statusOf(v, i) {
    const g = v.arcade.games[i];
    if (!g) return { t: '', k: '' };
    if (g.state === 'bust') return { t: 'BUST', k: 'lose' };
    if (g.state === 'cash') return { t: `CASHED ${fmtM(g.mult)}`, k: 'win' };
    return { t: `${g.k} SAFE · ${fmtM(g.mult)}`, k: 'stand' };
  },
  frame() {},
};

/* ---------- plumbing ---------- */
const MODS = { roulette, crash, plinko, dice, mines };
function loop() {
  st.raf = 0;
  const v = st.v;
  if (!v || !st.mod || document.hidden || !v.arcade) return;
  const now = C.serverNow();
  try { st.mod.frame(v, now); frameBar(v); } catch (e) { /* a drawing glitch must never take the app down */ }
  st.raf = requestAnimationFrame(loop);
}
const Arcade = {
  init(ctx) {
    C = ctx;
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !st.raf && st.mod) st.raf = requestAnimationFrame(loop); });
    addEventListener('keydown', (e) => {
      if (!st.mod || !st.v || e.code !== 'Space' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') return;
      if (st.game === 'plinko') { e.preventDefault(); plinko.drop(); }
      else if (st.game === 'dice') { e.preventDefault(); dice.roll(); }
      else if (st.game === 'crash' && st.v.arcade.stage === 'run') { e.preventDefault(); const b = $('#crGo'); if (b && !b.disabled) b.click(); }
    });
  },
  render(v) {
    const on = !!v.arcade && (v.phase === 'arcade' || v.phase === 'settled');
    $('#felt').dataset.arc = on ? '1' : '';
    if (!on) { if (st.raf) cancelAnimationFrame(st.raf); st.raf = 0; if (v.phase === 'lobby') { st.game = ''; st.mod = null; $('#arena').innerHTML = ''; } return; }
    if (st.game !== v.game) {
      st.game = v.game; st.mod = MODS[v.game]; st.sig = {}; st.v = v;
      buildFrame(); st.mod.build(v);
    }
    st.v = v;
    updatePlayers(v, (i) => st.mod.statusOf(v, i));
    st.mod.update(v);
    updateFoot(v);
    if (!st.raf) st.raf = requestAnimationFrame(loop);
  },
};
window.Arcade = Arcade;
})();
