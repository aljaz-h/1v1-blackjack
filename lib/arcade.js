'use strict';
// Arcade games for the casino: Roulette, Crash and Plinko. Like poker.js this is a plugin for the room
// engine: lobby, seats, chat, host, pause and the match flow live in engine.js, this file owns the games.
// It is created with the engine's helpers:
//   const arcade = require('./arcade')(helpers)
//
// Everything that decides an outcome (the wheel number, the crash point, the plinko path) is rolled on
// the server with crypto.randomInt. Clients only animate what the view tells them.
const crypto = require('node:crypto');

const GAMES = ['roulette', 'crash', 'plinko', 'dice', 'mines'];
const CONT = ['plinko', 'dice', 'mines']; // no rounds: every seat plays whenever it likes

/* =====================================================================
   Roulette
   ===================================================================== */
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const DOUBLE_ZERO = 37; // "00" on an American wheel
const colorOfNumber = (n) => (n === 0 || n === DOUBLE_ZERO ? 'green' : REDS.has(n) ? 'red' : 'black');
const wheelSize = (wheel) => (wheel === 'american' ? 38 : 37);
const ZERO_SPLITS = {
  european: [[0, 1], [0, 2], [0, 3]],
  american: [[0, 1], [0, 2], [DOUBLE_ZERO, 2], [DOUBLE_ZERO, 3], [0, DOUBLE_ZERO]],
};
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// A bet is { t, a, b }: t = type, a/b = the number(s) or option it covers. Returns the covered numbers and
// the payout odds (to 1), or null when the bet does not exist on the table.
function rouletteBet(wheel, t, a, b) {
  const num = (x) => Number.isInteger(x) && x >= 0 && x < wheelSize(wheel);
  switch (t) {
    case 'n': return num(a) ? { nums: [a], pay: 35 } : null;
    case 'sp': {
      if (!num(a) || !num(b)) return null;
      const [x, y] = a < b ? [a, b] : [b, a];
      const zero = (ZERO_SPLITS[wheel] || ZERO_SPLITS.european).some(([p, q]) => (p === x && q === y) || (p === y && q === x));
      if (zero) return { nums: [x, y], pay: 17 };
      if (x < 1 || y > 36) return null;
      const sameRow = Math.ceil(x / 3) === Math.ceil(y / 3) && y - x === 1;
      return sameRow || y - x === 3 ? { nums: [x, y], pay: 17 } : null;
    }
    case 'st': return Number.isInteger(a) && a >= 1 && a <= 34 && a % 3 === 1 ? { nums: [a, a + 1, a + 2], pay: 11 } : null;
    case 'co': return Number.isInteger(a) && a >= 1 && a <= 32 && a % 3 !== 0 ? { nums: [a, a + 1, a + 3, a + 4], pay: 8 } : null;
    case 'li': return Number.isInteger(a) && a >= 1 && a <= 31 && a % 3 === 1 ? { nums: range(a, a + 5), pay: 5 } : null;
    case 'dz': return a >= 1 && a <= 3 && Number.isInteger(a) ? { nums: range((a - 1) * 12 + 1, a * 12), pay: 2 } : null;
    case 'cl': return a >= 1 && a <= 3 && Number.isInteger(a) ? { nums: range(1, 36).filter((n) => n % 3 === a % 3), pay: 2 } : null;
    case 'rb': return a === 'red' || a === 'black' ? { nums: range(1, 36).filter((n) => colorOfNumber(n) === a), pay: 1 } : null;
    case 'oe': return a === 'odd' || a === 'even' ? { nums: range(1, 36).filter((n) => (n % 2 === 1) === (a === 'odd')), pay: 1 } : null;
    case 'hl': return a === 'low' || a === 'high' ? { nums: a === 'low' ? range(1, 18) : range(19, 36), pay: 1 } : null;
    default: return null;
  }
}
const betKey = (t, a, b) => (t === 'sp' ? `sp:${Math.min(a, b)}-${Math.max(a, b)}` : `${t}:${a}`);

/* =====================================================================
   Crash
   ===================================================================== */
const CRASH_K = 0.00015; // multiplier = e^(K * ms): 2x after ~4.6s, 10x after ~15s, 100x after ~31s
const CRASH_MAX = 100;
const CRASH_LAUNCH_MS = 900; // short pause between "bets closed" and take-off
const crashMult = (ms) => Math.exp(CRASH_K * Math.max(0, ms));
const crashTime = (m) => Math.log(m) / CRASH_K;
const floor2 = (x) => Math.floor(x * 100 + 1e-9) / 100;
// P(crash >= x) = 0.99 / x  (a 1% house edge). The roll is uniform in [0, 1).
function rollCrash() {
  const r = crypto.randomInt(1_000_000_000) / 1_000_000_000;
  return Math.min(CRASH_MAX, Math.max(1, floor2(0.99 / (1 - r))));
}

/* =====================================================================
   Plinko
   ===================================================================== */
const PLINKO_MS_PER_ROW = 300;
const PLINKO_LAND_MS = 450;
const PLINKO_ROWS = [8, 12, 16];
const PLINKO_RISK = ['low', 'medium', 'high'];
// multiplier for each landing slot (rows + 1 of them, symmetric), by rows and risk
const PLINKO = {
  8: {
    low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
    medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
  },
  12: {
    low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
    medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
    high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
  },
  16: {
    low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
    medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
    high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
  },
};
// expected return per chip for a table (a fair game would be exactly 1)
function plinkoRtp(rows, risk) {
  const tbl = PLINKO[rows][risk];
  let c = 1, sum = 0;
  for (let k = 0; k <= rows; k++) {
    sum += (c / 2 ** rows) * tbl[k];
    c = (c * (rows - k)) / (k + 1);
  }
  return sum;
}

/* Dice: a roll of 0.00-99.99 (an integer 0..9999 here). Over/under a target, 1%-98% to win, 1% edge. */
const DICE_MS = 700;
const DICE_MIN_WINS = 100, DICE_MAX_WINS = 9800;
function diceWins(dir, T) { return dir === 'under' ? T : 9999 - T; }
const diceMult = (wins) => Math.floor((9900 / wins) * 10000) / 10000;

/* Mines: 5x5 board, m mines, every safe tile multiplies the stake. Fair odds times 0.99. */
const MINES_TILES = 25;
function minesMult(m, k) {
  let p = 1;
  for (let i = 0; i < k; i++) p *= (MINES_TILES - i) / (MINES_TILES - m - i);
  return k === 0 ? 1 : Math.floor(p * 0.99 * 10000) / 10000;
}

module.exports = (H) => {
  const { arr, sys, setTimer, setTimerMs, clearTimer, gameBump, bump, aliveList, seatedList, ApiError, endMatch, HISTORY_MAX, fmtNet, betSecs, interMs, minBetOf, maxBetOf, isSolo } = H;

  const MAX_BET_CHIPS = 80; // distinct roulette bets per player per spin
  const SPIN_MS = 6500;
  const live = (st, seat) => st.seats[seat] && st.alive[seat];
  const needAr = (st, game) => {
    if (!st.ar || st.ar.game !== game) throw new ApiError('bad_phase', 'Nothing to do right now');
    return st.ar;
  };
  const int = (v, lo, hi) => {
    v = Math.floor(Number(v));
    if (!Number.isFinite(v) || v < lo || v > hi) throw new ApiError('bad_amount', `Amount must be ${lo}–${hi}`);
    return v;
  };

  /* ---------- starting a round ---------- */
  function start(st, now) {
    const game = st.settings.game;
    if (!st.ar || st.ar.game !== game || st.round === 0) {
      st.ar = { game, solo: !!st.house || seatedList(st).length === 1, hist: [], recent: [], balls: [], rolls: [], ballId: 0 };
    }
    const ar = st.ar;
    ar.solo = ar.solo || false;
    st.phase = 'arcade';
    st.results = null;
    st.over = null;
    st.nextVotes = arr(false);
    st.turn = null;
    st.first = 0;
    if (CONT.includes(game)) return startPlinko(st, now);
    st.round++;
    ar.part = aliveList(st);
    ar.res = null;
    ar.note = '';
    if (game === 'roulette') {
      ar.stage = 'bet';
      ar.wheel = st.settings.wheel === 'american' ? 'american' : 'european';
      ar.bets = arr(() => []);
      ar.log = arr(() => []);
      ar.stake = arr(0);
      ar.locked = arr(false);
      ar.n = null;
      ar.spinAt = 0;
    } else {
      ar.stage = 'bet';
      ar.bet = arr(null); // { amt, auto, cashed }
      ar.crashAt = 0;
      ar.runAt = 0;
      ar.crashed = false;
      ar.early = false;
    }
    setTimer(st, now, 'bet', betSecs(st));
    ar.betEnd = st.timerAt;
    gameBump(st);
  }

  function startPlinko(st, now) {
    const ar = st.ar;
    // plinko has no rounds: every seat drops balls whenever it likes, the match runs until the limit or until broke
    ar.stage = 'play';
    ar.part = aliveList(st);
    ar.last = arr(0);
    ar.mines = arr(null);
    ar.done = arr(null);
    clearTimer(st);
    gameBump(st);
  }

  /* ---------- finishing: stats, history, eliminations, match end ---------- */
  // stakes / nets are per seat; players with no stake this round are left out of stats and the log.
  function finish(st, now, { stakes, nets, notes, outcome, extraMs = 0 }) {
    const ar = st.ar;
    const ord = ar.part.filter((s) => (stakes[s] || 0) > 0);
    for (const s of ord) {
      if (nets[s] > 0) st.stats.w[s]++;
      else if (nets[s] < 0) st.stats.l[s]++;
      else st.stats.p[s]++;
    }
    const nameOf = (s) => (ar.names && ar.names[s]) || (st.seats[s] && st.seats[s].name) || '?';
    ar.res = arr(null);
    for (const s of ar.part) ar.res[s] = { stake: stakes[s] || 0, net: nets[s] || 0, note: (notes && notes[s]) || '' };
    st.history.push({
      r: st.round, t: now, ar: true, game: ar.game, outcome,
      seats: ord.map((s) => ({ seat: s, name: nameOf(s), stake: stakes[s], net: nets[s], note: (notes && notes[s]) || '' })),
      bal: [...st.balances],
    });
    if (st.history.length > HISTORY_MAX) st.history.shift();
    st.series.push([...st.balances]);
    if (st.series.length > 200) st.series.shift();
    if (ord.length) {
      sys(st, `Round ${st.round}: ${ord.map((s) => `${nameOf(s)} ${fmtNet(nets[s])}`).join(' · ')}`, now, 'round', {
        r: st.round, ar: ar.game, o: outcome,
        p: ord.map((s) => ({ s, n: nameOf(s), net: nets[s], bal: st.balances[s] })),
      });
    }
    afterRound(st, now, extraMs);
  }

  // eliminations and the end of the match, then the intermission before the next round
  function afterRound(st, now, extraMs = 0) {
    const ar = st.ar;
    const min = minBetOf(st);
    const out = aliveList(st).filter((s) => st.balances[s] < min).sort((a, b) => st.balances[b] - st.balances[a] || a - b);
    for (const s of out) {
      st.alive[s] = false;
      st.elim[s] = st.round;
    }
    const remaining = aliveList(st).length;
    out.forEach((s, idx) => sys(st, `${st.seats[s].name} is out of chips.`, now, 'out', { n: st.seats[s].name, s, place: remaining + 1 + idx, tourney: false }));
    const roundsDone = st.settings.maxRounds > 0 && st.round >= st.settings.maxRounds;
    const lastOne = ar.solo ? remaining < 1 : remaining <= 1;
    if (lastOne || roundsDone) endMatch(st, lastOne ? 'broke' : 'rounds');
    st.phase = 'settled';
    st.nextVotes = arr(false);
    setTimerMs(st, now, 'next', Math.max(1500, interMs(st) + extraMs));
    gameBump(st);
  }

  /* =====================================================================
     Roulette
     ===================================================================== */
  const rlStake = (ar, s) => ar.bets[s].reduce((a, b) => a + b.amt, 0);

  function rlAdd(st, seat, t, a, b, amt, ar) {
    const info = rouletteBet(ar.wheel, t, a, b);
    if (!info) throw new ApiError('bad_bet', 'That bet is not on the table');
    amt = int(amt, 1, 1e12);
    if (amt > st.balances[seat]) throw new ApiError('no_funds', 'Not enough chips');
    const max = maxBetOf(st);
    if (rlStake(ar, seat) + amt > max) throw new ApiError('over_max', `Table maximum is ${max} per spin`);
    const key = betKey(t, a, b);
    let bet = ar.bets[seat].find((x) => x.k === key);
    if (!bet) {
      if (ar.bets[seat].length >= MAX_BET_CHIPS) throw new ApiError('too_many', 'Too many different bets');
      bet = { k: key, t, a, b: t === 'sp' ? b : undefined, amt: 0 };
      ar.bets[seat].push(bet);
    }
    bet.amt += amt;
    st.balances[seat] -= amt;
    ar.stake[seat] += amt;
    ar.log[seat].push({ k: key, amt });
    if (ar.log[seat].length > 200) ar.log[seat].shift();
  }
  function rlRefundAll(st, seat, ar) {
    st.balances[seat] += ar.stake[seat];
    ar.stake[seat] = 0;
    ar.bets[seat] = [];
    ar.log[seat] = [];
  }

  function rlAct(st, seat, type, msg, now) {
    const ar = needAr(st, 'roulette');
    if (ar.stage !== 'bet') throw new ApiError('bad_phase', 'Bets are closed');
    if (!live(st, seat)) throw new ApiError('out', 'You are out of the match');
    if (type === 'rl_lock') {
      const want = !!msg.value;
      if (want) {
        if (ar.stake[seat] > 0 && ar.stake[seat] < minBetOf(st)) throw new ApiError('bet_too_small', `Minimum is ${minBetOf(st)} per spin`);
      }
      ar.locked[seat] = want;
      gameBump(st);
      return rlMaybeSpin(st, now);
    }
    if (ar.locked[seat]) throw new ApiError('locked', 'Unlock to change your bets');
    if (type === 'rl_bet') {
      const list = Array.isArray(msg.bets) ? msg.bets.slice(0, 40) : [msg];
      for (const x of list) rlAdd(st, seat, String(x.t), x.a, x.b, x.amt, ar);
    } else if (type === 'rl_undo') {
      const last = ar.log[seat].pop();
      if (!last) return;
      const bet = ar.bets[seat].find((x) => x.k === last.k);
      if (bet) {
        bet.amt -= last.amt;
        if (bet.amt <= 0) ar.bets[seat] = ar.bets[seat].filter((x) => x !== bet);
      }
      st.balances[seat] += last.amt;
      ar.stake[seat] -= last.amt;
    } else if (type === 'rl_clear') {
      rlRefundAll(st, seat, ar);
    } else if (type === 'rl_rebet' || type === 'rl_double') {
      const src = type === 'rl_double' ? ar.bets[seat].map((b) => ({ ...b })) : (ar.prev && ar.prev[seat]) || [];
      if (!src.length) throw new ApiError('nothing', 'Nothing to repeat');
      if (type === 'rl_rebet' && ar.bets[seat].length) rlRefundAll(st, seat, ar);
      let added = 0;
      for (const b of src) {
        try { rlAdd(st, seat, b.t, b.a, b.b, b.amt, ar); added++; } catch { /* skip what no longer fits */ }
      }
      if (!added) throw new ApiError('no_funds', 'Not enough chips');
    } else throw new ApiError('unknown_action', 'Unknown action');
    gameBump(st);
  }

  // everyone who can play has locked in: spin early
  function rlMaybeSpin(st, now) {
    const ar = st.ar;
    if (ar.stage !== 'bet') return;
    if (ar.part.filter((s) => live(st, s)).every((s) => ar.locked[s])) rlSpin(st, now);
  }

  function rlSpin(st, now) {
    const ar = st.ar;
    ar.names = {};
    for (const s of ar.part) {
      ar.names[s] = st.seats[s].name;
      // a stake below the table minimum is returned and that player sits this spin out
      if (ar.stake[s] > 0 && ar.stake[s] < minBetOf(st)) rlRefundAll(st, s, ar);
    }
    ar.stage = 'spin';
    ar.n = crypto.randomInt(wheelSize(ar.wheel));
    ar.spinAt = now;
    ar.prev = ar.bets.map((b) => b.map((x) => ({ ...x })));
    setTimerMs(st, now, 'spin', SPIN_MS);
    gameBump(st);
  }

  function rlSettle(st, now) {
    const ar = st.ar;
    const stakes = arr(0), nets = arr(0), notes = arr('');
    for (const s of ar.part) {
      const stake = ar.stake[s];
      stakes[s] = stake;
      let pay = 0;
      const wins = [];
      for (const b of ar.bets[s]) {
        const info = rouletteBet(ar.wheel, b.t, b.a, b.b);
        if (info && info.nums.includes(ar.n)) { pay += b.amt * (info.pay + 1); wins.push(b); }
      }
      if (st.seats[s] && st.alive[s]) st.balances[s] += pay;
      nets[s] = pay - stake;
      notes[s] = stake ? (pay ? `${wins.length} of ${ar.bets[s].length} bets won` : `${ar.bets[s].length} bet${ar.bets[s].length === 1 ? '' : 's'} lost`) : '';
    }
    ar.hist.unshift(ar.n);
    if (ar.hist.length > 24) ar.hist.pop();
    const label = ar.n === DOUBLE_ZERO ? '00' : String(ar.n);
    if (ar.part.some((s) => stakes[s] > 0)) sys(st, `The ball lands on ${label} ${colorOfNumber(ar.n)}.`, now, 'rl', { n: ar.n, c: colorOfNumber(ar.n) });
    ar.stage = 'done';
    finish(st, now, { stakes, nets, notes, outcome: `${label} ${colorOfNumber(ar.n)}`, extraMs: 1800 });
  }

  /* =====================================================================
     Crash
     ===================================================================== */
  function crAct(st, seat, type, msg, now) {
    const ar = needAr(st, 'crash');
    if (!live(st, seat)) throw new ApiError('out', 'You are out of the match');
    if (type === 'cr_cash') {
      if (ar.stage !== 'run') throw new ApiError('bad_phase', 'Nothing to cash out');
      const b = ar.bet[seat];
      if (!b || b.cashed) throw new ApiError('no_bet', 'You have no live bet');
      if (now < ar.runAt) throw new ApiError('too_early', 'Wait for take-off');
      crAutos(st, now);
      if (b.cashed) return gameBump(st);
      const m = floor2(crashMult(now - ar.runAt));
      if (m >= ar.crashAt) throw new ApiError('too_late', 'Crashed');
      crCash(st, seat, Math.max(1, m), now);
      crSchedule(st, now);
      gameBump(st);
      return;
    }
    if (ar.stage !== 'bet') throw new ApiError('bad_phase', 'Bets are closed');
    if (type === 'cr_bet') {
      const min = minBetOf(st), max = Math.min(maxBetOf(st), st.balances[seat] + (ar.bet[seat] ? ar.bet[seat].amt : 0));
      if (max < min) throw new ApiError('no_funds', 'Not enough chips');
      const amt = int(msg.amt, min, max);
      let auto = 0;
      if (msg.auto != null && msg.auto !== '' && Number(msg.auto) !== 0) {
        auto = Number(msg.auto);
        if (!Number.isFinite(auto) || auto < 1.01 || auto > CRASH_MAX) throw new ApiError('bad_auto', `Auto cash-out must be 1.01–${CRASH_MAX}x`);
        auto = floor2(auto);
      }
      if (ar.bet[seat]) st.balances[seat] += ar.bet[seat].amt;
      st.balances[seat] -= amt;
      ar.bet[seat] = { amt, auto, cashed: 0 };
    } else if (type === 'cr_cancel') {
      if (!ar.bet[seat]) return;
      st.balances[seat] += ar.bet[seat].amt;
      ar.bet[seat] = null;
      if (ar.early) { ar.early = false; st.timerAt = ar.betEnd; }
    } else throw new ApiError('unknown_action', 'Unknown action');
    gameBump(st);
    // every active player is in: take off after a short moment
    if (ar.part.filter((s) => live(st, s)).every((s) => ar.bet[s])) {
      const at = now + 1400;
      if (!ar.betEnd || at < ar.betEnd) { ar.early = true; st.timerKind = 'bet'; st.timerDur = 1400; st.timerAt = at; }
    }
  }

  function crCash(st, seat, mult, now) {
    const ar = st.ar, b = ar.bet[seat];
    b.cashed = mult;
    const pay = Math.floor(b.amt * mult + 1e-9);
    b.pay = pay;
    if (st.seats[seat] && st.alive[seat]) st.balances[seat] += pay;
  }

  // auto cash-outs that the multiplier has reached
  function crAutos(st, now) {
    const ar = st.ar;
    const m = Math.min(floor2(crashMult(now - ar.runAt)), ar.crashAt);
    for (const s of ar.part) {
      const b = ar.bet[s];
      if (b && !b.cashed && b.auto && b.auto <= m) crCash(st, s, b.auto, now);
    }
  }
  // the next moment something happens: an auto cash-out, or the crash itself
  function crSchedule(st, now) {
    const ar = st.ar;
    let at = ar.runAt + crashTime(ar.crashAt);
    let kind = 'crash';
    for (const s of ar.part) {
      const b = ar.bet[s];
      if (b && !b.cashed && b.auto && b.auto < ar.crashAt) {
        const t = ar.runAt + crashTime(b.auto);
        if (t < at) { at = t; kind = 'auto'; }
      }
    }
    st.timerKind = kind;
    st.timerDur = Math.max(1, at - now);
    st.timerAt = Math.ceil(at);
  }

  function crRun(st, now) {
    const ar = st.ar;
    ar.names = {};
    for (const s of ar.part) ar.names[s] = st.seats[s].name;
    ar.crashAt = rollCrash();
    ar.runAt = now + CRASH_LAUNCH_MS;
    ar.stage = 'run';
    const bettors = ar.part.filter((s) => ar.bet[s]);
    if (!bettors.length) { // nobody is in: show the crash point without the wait
      ar.stage = 'done'; ar.crashed = true; ar.runAt = 0;
      ar.hist.unshift(ar.crashAt); if (ar.hist.length > 20) ar.hist.pop();
      return finish(st, now, { stakes: arr(0), nets: arr(0), notes: arr(''), outcome: `${ar.crashAt.toFixed(2)}x`, extraMs: -3500 });
    }
    crSchedule(st, now);
    gameBump(st);
  }

  function crCrash(st, now) {
    const ar = st.ar;
    crAutos(st, ar.runAt + crashTime(ar.crashAt) + 1);
    ar.stage = 'done';
    ar.crashed = true;
    const stakes = arr(0), nets = arr(0), notes = arr('');
    for (const s of ar.part) {
      const b = ar.bet[s];
      if (!b) continue;
      stakes[s] = b.amt;
      nets[s] = (b.cashed ? b.pay : 0) - b.amt;
      notes[s] = b.cashed ? `cashed out at ${b.cashed.toFixed(2)}x` : 'crashed';
    }
    ar.hist.unshift(ar.crashAt);
    if (ar.hist.length > 20) ar.hist.pop();
    const x = `${ar.crashAt.toFixed(2)}x`;
    if (ar.part.some((s) => ar.bet[s])) sys(st, `Crashed at ${x}.`, now, 'crash', { x: ar.crashAt });
    finish(st, now, { stakes, nets, notes, outcome: x, extraMs: 800 });
  }

  /* =====================================================================
     Plinko
     ===================================================================== */
  function plAct(st, seat, type, msg, now) {
    const ar = needAr(st, 'plinko');
    if (type !== 'pl_drop') throw new ApiError('unknown_action', 'Unknown action');
    if (!live(st, seat)) throw new ApiError('out', 'You are out of the match');
    if (st.over || st.phase !== 'arcade') throw new ApiError('bad_phase', 'The session is over');
    const rows = Number(msg.rows), risk = String(msg.risk);
    if (!PLINKO_ROWS.includes(rows) || !PLINKO_RISK.includes(risk)) throw new ApiError('bad_cfg', 'Pick rows and risk');
    if (st.settings.maxRounds > 0 && st.round >= st.settings.maxRounds) throw new ApiError('limit', 'Drop limit reached');
    const mine = ar.balls.filter((b) => b.seat === seat).length;
    if (mine >= 8) throw new ApiError('too_many', 'Wait for your balls to land');
    const min = minBetOf(st), max = Math.min(maxBetOf(st), st.balances[seat]);
    if (max < min) throw new ApiError('no_funds', 'Not enough chips');
    const amt = int(msg.amt, min, max);
    if (now - (ar.last[seat] || 0) < 120) throw new ApiError('slow_down', 'Slow down');
    ar.last[seat] = now;
    st.balances[seat] -= amt;
    st.round++;
    const bits = Array.from({ length: rows }, () => crypto.randomInt(2));
    const slot = bits.reduce((a, b) => a + b, 0);
    const mult = PLINKO[rows][risk][slot];
    ar.balls.push({ id: ++ar.ballId, seat, name: st.seats[seat].name, r: st.round, amt, rows, risk, bits, slot, mult, at: now, landAt: now + rows * PLINKO_MS_PER_ROW + PLINKO_LAND_MS });
    plSchedule(st);
    gameBump(st);
  }
  function plSchedule(st) {
    const ar = st.ar;
    const all = ar.balls.concat(ar.rolls);
    if (!all.length) { if (st.timerKind === 'land') clearTimer(st); return; }
    const at = Math.min(...all.map((b) => b.landAt));
    st.timerKind = 'land';
    st.timerAt = at;
    st.timerDur = Math.max(1, at - Date.now());
  }
  function plLand(st, now) {
    const ar = st.ar;
    const done = ar.balls.filter((b) => b.landAt <= now);
    ar.balls = ar.balls.filter((b) => b.landAt > now);
    clearTimer(st);
    for (const b of done) {
      const pay = Math.floor(b.amt * b.mult + 1e-9);
      const seatOk = st.seats[b.seat] && st.seats[b.seat].name === b.name;
      if (seatOk && st.alive[b.seat]) st.balances[b.seat] += pay;
      const net = pay - b.amt;
      if (seatOk) { if (net > 0) st.stats.w[b.seat]++; else if (net < 0) st.stats.l[b.seat]++; else st.stats.p[b.seat]++; }
      st.history.push({ r: b.r, t: now, ar: true, game: 'plinko', outcome: `${b.mult}x`, seats: [{ seat: b.seat, name: b.name, stake: b.amt, net, note: `${b.rows} rows · ${b.risk}` }], bal: [...st.balances] });
      if (st.history.length > HISTORY_MAX) st.history.shift();
      ar.recent.unshift({ id: b.id, seat: b.seat, name: b.name, amt: b.amt, mult: b.mult, net });
      if (ar.recent.length > 12) ar.recent.pop();
      if (b.mult >= 10 || (b.mult >= 3 && net >= 500)) sys(st, `${b.name} hits ${b.mult}x for ${net > 0 ? '+' : ''}${net}.`, now, 'plinko', { n: b.name, mult: b.mult, net });
    }
    if (done.length) {
      st.series.push([...st.balances]);
      if (st.series.length > 200) st.series.shift();
    }
    plSchedule(st);
    sweep(st, now);
  }
  const busy = (ar, s) => ar.balls.some((b) => b.seat === s) || ar.rolls.some((b) => b.seat === s) || !!(ar.mines && ar.mines[s]);
  // a player whose chips and balls/rolls/games are all gone is out; then maybe the match ends
  function sweep(st, now) {
    const ar = st.ar;
    {
      const min = minBetOf(st);
      for (const s of aliveList(st)) {
      if (st.balances[s] < min && !busy(ar, s)) {
        st.alive[s] = false;
        st.elim[s] = st.round;
        const remaining = aliveList(st).length;
        sys(st, `${st.seats[s].name} is out of chips.`, now, 'out', { n: st.seats[s].name, s, place: remaining + 1, tourney: false });
      }
      }
    }
    plMaybeEnd(st, now);
    gameBump(st);
  }
  function plMaybeEnd(st, now) {
    const ar = st.ar;
    if (st.phase !== 'arcade' || ar.balls.length || ar.rolls.length || (ar.mines && ar.mines.some(Boolean))) return;
    const remaining = aliveList(st).length;
    const limit = st.settings.maxRounds > 0 && st.round >= st.settings.maxRounds;
    const lastOne = ar.solo ? remaining < 1 : remaining <= 1 && seatedList(st).length > 1;
    if (!lastOne && !limit) return;
    endMatch(st, lastOne ? 'broke' : 'rounds');
    st.phase = 'settled';
    st.nextVotes = arr(false);
    clearTimer(st);
    setTimerMs(st, now, 'next', interMs(st));
  }


  /* =====================================================================
     Dice
     ===================================================================== */
  function dcAct(st, seat, type, msg, now) {
    const ar = needAr(st, 'dice');
    if (type !== 'dc_roll') throw new ApiError('unknown_action', 'Unknown action');
    if (!live(st, seat)) throw new ApiError('out', 'You are out of the match');
    if (st.over || st.phase !== 'arcade') throw new ApiError('bad_phase', 'The session is over');
    const dir = msg.dir === 'under' ? 'under' : 'over';
    const T = Math.round(Number(msg.target) * 100);
    if (!Number.isFinite(T) || T < 0 || T > 9999) throw new ApiError('bad_cfg', 'Pick a target');
    const wins = diceWins(dir, T);
    if (wins < DICE_MIN_WINS || wins > DICE_MAX_WINS) throw new ApiError('bad_cfg', 'Win chance must be 1%–98%');
    if (st.settings.maxRounds > 0 && st.round >= st.settings.maxRounds) throw new ApiError('limit', 'Roll limit reached');
    if (ar.rolls.filter((b) => b.seat === seat).length >= 6) throw new ApiError('too_many', 'Wait for your rolls to land');
    const min = minBetOf(st), max = Math.min(maxBetOf(st), st.balances[seat]);
    if (max < min) throw new ApiError('no_funds', 'Not enough chips');
    const amt = int(msg.amt, min, max);
    if (now - (ar.last[seat] || 0) < 120) throw new ApiError('slow_down', 'Slow down');
    ar.last[seat] = now;
    st.balances[seat] -= amt;
    st.round++;
    const roll = crypto.randomInt(10000);
    const win = dir === 'under' ? roll < T : roll > T;
    ar.rolls.push({ id: ++ar.ballId, seat, name: st.seats[seat].name, r: st.round, amt, dir, T, roll, win, mult: diceMult(wins), at: now, landAt: now + DICE_MS });
    plSchedule(st);
    gameBump(st);
  }
  function dcLand(st, now) {
    const ar = st.ar;
    const done = ar.rolls.filter((b) => b.landAt <= now);
    ar.rolls = ar.rolls.filter((b) => b.landAt > now);
    clearTimer(st);
    for (const b of done) {
      const pay = b.win ? Math.floor(b.amt * b.mult + 1e-9) : 0;
      const seatOk = st.seats[b.seat] && st.seats[b.seat].name === b.name;
      if (seatOk && st.alive[b.seat]) st.balances[b.seat] += pay;
      const net = pay - b.amt;
      if (seatOk) { if (net > 0) st.stats.w[b.seat]++; else st.stats.l[b.seat]++; }
      const rollTxt = (b.roll / 100).toFixed(2);
      st.history.push({ r: b.r, t: now, ar: true, game: 'dice', outcome: rollTxt, seats: [{ seat: b.seat, name: b.name, stake: b.amt, net, note: `${b.dir} ${(b.T / 100).toFixed(2)} · ${b.mult}x` }], bal: [...st.balances] });
      if (st.history.length > HISTORY_MAX) st.history.shift();
      ar.recent.unshift({ id: b.id, seat: b.seat, name: b.name, amt: b.amt, roll: b.roll, dir: b.dir, T: b.T, mult: b.mult, win: b.win, net });
      if (ar.recent.length > 12) ar.recent.pop();
      if (b.win && (b.mult >= 20 || net >= 5000)) sys(st, `${b.name} rolls ${rollTxt} and wins ${net}.`, now, 'dice', { n: b.name, mult: b.mult, net });
    }
    if (done.length) { st.series.push([...st.balances]); if (st.series.length > 200) st.series.shift(); }
    plSchedule(st);
    sweep(st, now);
  }

  /* =====================================================================
     Mines
     ===================================================================== */
  function mnEnd(st, seat, g, how, now) {
    const ar = st.ar;
    const mult = how === 'bust' ? 0 : minesMult(g.m, g.rev.length);
    const pay = how === 'bust' ? 0 : Math.floor(g.amt * mult + 1e-9);
    const seatOk = st.seats[seat] && st.seats[seat].name === g.name;
    if (seatOk && st.alive[seat]) st.balances[seat] += pay;
    const net = pay - g.amt;
    g.state = how; g.pay = pay; g.mult = mult;
    ar.mines[seat] = null;
    ar.done[seat] = g;
    if (seatOk) { if (net > 0) st.stats.w[seat]++; else st.stats.l[seat]++; }
    st.history.push({ r: g.r, t: now, ar: true, game: 'mines', outcome: how === 'bust' ? 'Mine!' : `${mult}x`, seats: [{ seat, name: g.name, stake: g.amt, net, note: `${g.m} mine${g.m === 1 ? '' : 's'} · ${g.rev.length} safe` }], bal: [...st.balances] });
    if (st.history.length > HISTORY_MAX) st.history.shift();
    ar.recent.unshift({ id: g.id, seat, name: g.name, amt: g.amt, m: g.m, k: g.rev.length, mult, bust: how === 'bust', net });
    if (ar.recent.length > 12) ar.recent.pop();
    if (how === 'cash' && (mult >= 20 || net >= 5000)) sys(st, `${g.name} cashes out ${mult}x on mines for +${net}.`, now, 'mines', { n: g.name, mult, net });
    st.series.push([...st.balances]);
    if (st.series.length > 200) st.series.shift();
    sweep(st, now);
  }
  function mnAct(st, seat, type, msg, now) {
    const ar = needAr(st, 'mines');
    if (!live(st, seat)) throw new ApiError('out', 'You are out of the match');
    if (st.over || st.phase !== 'arcade') throw new ApiError('bad_phase', 'The session is over');
    const g = ar.mines[seat];
    if (type === 'mn_start') {
      if (g) throw new ApiError('in_game', 'Finish your current game first');
      const m = int(msg.mines, 1, 24);
      if (st.settings.maxRounds > 0 && st.round >= st.settings.maxRounds) throw new ApiError('limit', 'Game limit reached');
      const min = minBetOf(st), max = Math.min(maxBetOf(st), st.balances[seat]);
      if (max < min) throw new ApiError('no_funds', 'Not enough chips');
      const amt = int(msg.amt, min, max);
      const tiles = Array.from({ length: MINES_TILES }, (_, i) => i);
      for (let i = 0; i < m; i++) { const j = i + crypto.randomInt(MINES_TILES - i); [tiles[i], tiles[j]] = [tiles[j], tiles[i]]; }
      st.balances[seat] -= amt;
      st.round++;
      ar.done[seat] = null;
      ar.mines[seat] = { id: ++ar.ballId, name: st.seats[seat].name, r: st.round, amt, m, mines: tiles.slice(0, m), rev: [] };
      gameBump(st);
      return;
    }
    if (!g) throw new ApiError('no_game', 'Start a game first');
    if (type === 'mn_pick') {
      const i = Number(msg.i);
      if (!Number.isInteger(i) || i < 0 || i >= MINES_TILES) throw new ApiError('bad_tile', 'Pick a tile');
      if (g.rev.includes(i)) throw new ApiError('revealed', 'Already revealed');
      if (g.mines.includes(i)) { g.rev.push(i); g.hit = i; return mnEnd(st, seat, g, 'bust', now); }
      g.rev.push(i);
      if (g.rev.length === MINES_TILES - g.m) return mnEnd(st, seat, g, 'cash', now);
      gameBump(st);
    } else if (type === 'mn_cash') {
      if (!g.rev.length) throw new ApiError('nothing', 'Reveal a tile first');
      mnEnd(st, seat, g, 'cash', now);
    } else throw new ApiError('unknown_action', 'Unknown action');
  }

  /* ---------- the engine's entry points ---------- */
  function act(st, seat, type, msg, now) {
    if (type.startsWith('rl_')) return rlAct(st, seat, type, msg, now);
    if (type.startsWith('cr_')) return crAct(st, seat, type, msg, now);
    if (type.startsWith('pl_')) return plAct(st, seat, type, msg, now);
    if (type.startsWith('dc_')) return dcAct(st, seat, type, msg, now);
    if (type.startsWith('mn_')) return mnAct(st, seat, type, msg, now);
    throw new ApiError('unknown_action', 'Unknown action');
  }

  function fireTimer(st, now, kind) {
    const ar = st.ar;
    if (!ar) return false;
    if (ar.game === 'roulette') {
      if (kind === 'bet' && ar.stage === 'bet') { rlSpin(st, now); return true; }
      if (kind === 'spin' && ar.stage === 'spin') { rlSettle(st, now); return true; }
    } else if (ar.game === 'crash') {
      if (kind === 'bet' && ar.stage === 'bet') { ar.early = false; crRun(st, now); return true; }
      if (kind === 'auto' && ar.stage === 'run') { crAutos(st, ar.runAt + crashTime(ar.crashAt) > now ? now : ar.runAt + crashTime(ar.crashAt)); crSchedule(st, now); gameBump(st); return true; }
      if (kind === 'crash' && ar.stage === 'run') { crCrash(st, now); return true; }
    } else if (ar.game === 'plinko') {
      if (kind === 'land') { plLand(st, now); return true; }
    } else if (ar.game === 'dice') {
      if (kind === 'land') { dcLand(st, now); return true; }
    }
    return false;
  }

  // a player leaves a live match
  function forfeit(st, seat, reason, now) {
    const ar = st.ar;
    const name = st.seats[seat].name;
    const inBet = ar && ar.stage === 'bet';
    if (ar && ar.game === 'roulette' && inBet) rlRefundAll(st, seat, ar);
    if (ar && ar.game === 'crash' && inBet && ar.bet[seat]) { st.balances[seat] += ar.bet[seat].amt; ar.bet[seat] = null; }
    if (ar && CONT.includes(ar.game)) { ar.balls = ar.balls.filter((b) => b.seat !== seat); ar.rolls = ar.rolls.filter((b) => b.seat !== seat); if (ar.mines) ar.mines[seat] = null; }
    if (ar && ar.names) ar.names[seat] = ar.names[seat] || name;
    st.alive[seat] = false;
    st.seats[seat] = null;
    st.ready = arr(false);
    sys(st, reason === 'disconnect' ? `${name} disconnected and forfeits the match.` : `${name} forfeits the match.`, now, reason === 'disconnect' ? 'dc' : 'forfeit', { n: name });
    const remaining = aliveList(st);
    if (remaining.length <= (ar && ar.solo ? 0 : 1)) {
      st.turn = null;
      clearTimer(st);
      endMatch(st, reason);
      st.phase = 'over';
      const w = st.over.winners.map((s) => st.seats[s] && st.seats[s].name).filter(Boolean);
      if (ar && ar.solo) sys(st, `${name} left the table.`, now, 'unseat', { n: name });
      else if (w.length === 1) sys(st, `${w[0]} wins the match!`, now, 'win', { n: w[0], why: reason });
      else sys(st, 'Match ends in a draw.', now, 'draw', w.length ? { names: w } : null);
      gameBump(st);
      return;
    }
    if (ar && CONT.includes(ar.game)) plSchedule(st);
    gameBump(st);
    if (ar && ar.game === 'roulette' && ar.stage === 'bet') rlMaybeSpin(st, now);
    else if (ar && ar.game === 'crash' && ar.stage === 'bet' && ar.part.filter((s) => live(st, s)).every((s) => ar.bet[s])) {
      const at = now + 1400;
      if (!ar.betEnd || at < ar.betEnd) { ar.early = true; st.timerKind = 'bet'; st.timerDur = 1400; st.timerAt = at; }
    } else if (ar && CONT.includes(ar.game)) plMaybeEnd(st, now);
  }

  // the host's pause: everything with a clock moves back by the time spent paused
  function shift(st, d) {
    const ar = st.ar;
    if (!ar) return;
    if (ar.runAt) ar.runAt += d;
    if (ar.spinAt) ar.spinAt += d;
    if (ar.betEnd) ar.betEnd += d;
    for (const b of (ar.balls || []).concat(ar.rolls || [])) { b.landAt += d; b.at += d; }
  }

  /* ---------- the view ---------- */
  function view(st, mySeat) {
    const ar = st.ar;
    if (!ar || ar.game !== st.settings.game) return null;
    const base = { game: ar.game, solo: !!ar.solo, stage: ar.stage, hist: ar.hist, res: ar.res || null, round: st.round };
    if (ar.game === 'roulette') {
      const others = arr(() => []);
      if (ar.bets) ar.bets.forEach((list, s) => (others[s] = s === mySeat ? [] : list.map((b) => ({ k: b.k, amt: b.amt }))));
      return {
        ...base,
        wheel: ar.wheel || st.settings.wheel,
        n: ar.stage === 'bet' ? null : ar.n,
        spinAt: ar.spinAt,
        spinMs: SPIN_MS,
        bets: mySeat >= 0 && ar.bets ? ar.bets[mySeat] : [],
        prev: mySeat >= 0 && ar.prev ? ar.prev[mySeat] : [],
        stake: ar.stake || arr(0),
        locked: ar.locked || arr(false),
        others,
      };
    }
    if (ar.game === 'crash') {
      return {
        ...base,
        k: CRASH_K,
        max: CRASH_MAX,
        runAt: ar.runAt,
        crashAt: ar.stage === 'done' ? ar.crashAt : 0,
        bets: (ar.bet || arr(null)).map((b, s) => (b ? { amt: b.amt, cashed: b.cashed || 0, pay: b.pay || 0, auto: s === mySeat ? b.auto : b.auto ? 1 : 0 } : null)),
      };
    }
    if (ar.game === 'dice') {
      return { ...base, rolls: ar.rolls.map((b) => ({ id: b.id, seat: b.seat, name: b.name, amt: b.amt, dir: b.dir, T: b.T, mult: b.mult, at: b.at, landAt: b.landAt })), recent: ar.recent };
    }
    if (ar.game === 'mines') {
      const games = (ar.mines || []).map((g, s) => {
        const d = g || (ar.done && ar.done[s]);
        if (!d) return null;
        const over = d.state || '';
        const mineView = s === mySeat || over;
        return { amt: d.amt, m: d.m, k: d.rev.length, state: over, mult: over ? d.mult : minesMult(d.m, d.rev.length), pay: d.pay || 0, rev: s === mySeat ? d.rev : undefined, mines: s === mySeat && over ? d.mines : undefined, hit: s === mySeat && over === 'bust' ? d.hit : undefined, mine: mineView && s === mySeat };
      });
      return { ...base, games, recent: ar.recent };
    }
    return {
      ...base,
      tables: PLINKO,
      msPerRow: PLINKO_MS_PER_ROW,
      balls: ar.balls.map((b) => ({ id: b.id, seat: b.seat, name: b.name, amt: b.amt, rows: b.rows, risk: b.risk, bits: b.bits, slot: b.slot, mult: b.mult, at: b.at, landAt: b.landAt })),
      recent: ar.recent,
    };
  }

  return { start, act, fireTimer, forfeit, shift, view };
};

module.exports.GAMES = GAMES;
module.exports.rouletteBet = rouletteBet;
module.exports.betKey = betKey;
module.exports.colorOfNumber = colorOfNumber;
module.exports.crashMult = crashMult;
module.exports.crashTime = crashTime;
module.exports.rollCrash = rollCrash;
module.exports.plinkoRtp = plinkoRtp;
module.exports.minesMult = minesMult;
module.exports.diceMult = diceMult;
module.exports.diceWins = diceWins;
module.exports.PLINKO = PLINKO;
module.exports.PLINKO_ROWS = PLINKO_ROWS;
module.exports.PLINKO_RISK = PLINKO_RISK;
module.exports.CRASH_K = CRASH_K;
