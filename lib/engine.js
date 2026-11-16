'use strict';
// Pure blackjack state machine. No I/O. All time-based behaviour is driven by tick(state, now).
const crypto = require('node:crypto');

const ONLINE_MS = 30_000;
const FORFEIT_MS = 75_000;
const PRUNE_MS = 10 * 60_000;
const HOST_AWAY_MS = 2 * 60_000; // host unseen this long -> the next person to act inherits the room
const INTERMISSION_MS = 7_000;
const CHAT_MAX = 60;
const HISTORY_MAX = 40;
const MAX_HANDS = 4;
const MAX_SEATS = 6;
const BLITZ_SECS = 8;
const BLITZ_INTERMISSION_MS = 2_500;
const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

class ApiError extends Error {
  constructor(code, message, status = 400) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}


// Game modes: how many players may sit, and (for the UI) a label.
const MODES = {
  duel: { min: 2, max: 2, label: 'Duel' },
  classic: { min: 2, max: 6, label: 'Classic' },
  showdown: { min: 2, max: 6, label: 'Showdown' },
  tournament: { min: 3, max: 6, label: 'Tournament' },
};

const DEFAULT_SETTINGS = {
  mode: 'duel',
  blitz: false, // short timers + fast rounds, works with every mode
  startingBalance: 1000,
  minBet: 10,
  maxBet: 500,
  decks: 6,
  payout: 1.5, // 3:2
  h17: false, // dealer stands on soft 17
  maxRounds: 0, // 0 = play until someone is broke
  blindEvery: 5, // tournament: raise the bet limits every N rounds
  betTime: 30,
  actionTime: 30,
};

const clampInt = (v, lo, hi, d) => {
  v = Math.round(Number(v));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
};
const pick = (v, allowed, d) => (allowed.includes(v) ? v : d);

function sanitizeSettings(input = {}, base = DEFAULT_SETTINGS) {
  const s = { ...base };
  if ('mode' in input) s.mode = pick(String(input.mode), Object.keys(MODES), base.mode);
  if ('blitz' in input) s.blitz = !!input.blitz;
  if ('startingBalance' in input) s.startingBalance = clampInt(input.startingBalance, 50, 10_000_000, base.startingBalance);
  if ('minBet' in input) s.minBet = clampInt(input.minBet, 1, 1_000_000, base.minBet);
  if ('maxBet' in input) s.maxBet = clampInt(input.maxBet, 1, 10_000_000, base.maxBet);
  if ('decks' in input) s.decks = pick(Number(input.decks), [1, 2, 4, 6, 8], base.decks);
  if ('payout' in input) s.payout = pick(Number(input.payout), [1.5, 1.2, 1], base.payout);
  if ('h17' in input) s.h17 = !!input.h17;
  if ('maxRounds' in input) s.maxRounds = pick(Number(input.maxRounds), [0, 5, 10, 20, 50, 100], base.maxRounds);
  if ('blindEvery' in input) s.blindEvery = pick(Number(input.blindEvery), [3, 5, 10], base.blindEvery);
  if ('betTime' in input) s.betTime = pick(Number(input.betTime), [0, 15, 30, 60], base.betTime);
  if ('actionTime' in input) s.actionTime = pick(Number(input.actionTime), [0, 15, 30, 60], base.actionTime);
  s.minBet = Math.min(s.minBet, s.startingBalance);
  s.maxBet = Math.max(s.maxBet, s.minBet);
  return s;
}

/* ---------- cards ---------- */
const rankOf = (c) => c.slice(0, -1);
function cardValue(c) {
  const r = rankOf(c);
  if (r === 'A') return 11;
  if (r === 'K' || r === 'Q' || r === 'J' || r === '10') return 10;
  return Number(r);
}
function handTotal(cards) {
  let t = 0;
  let aces = 0;
  for (const c of cards) {
    const v = cardValue(c);
    t += v;
    if (v === 11) aces++;
  }
  while (t > 21 && aces) {
    t -= 10;
    aces--;
  }
  return { total: t, soft: aces > 0 };
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function newShoe(decks) {
  const cards = [];
  for (let d = 0; d < decks; d++) for (const s of SUITS) for (const r of RANKS) cards.push(r + s);
  return shuffle(cards);
}
function draw(st) {
  if (!st.shoe.length) st.shoe = newShoe(st.settings.decks);
  return st.shoe.pop();
}

/* ---------- state ---------- */
const arr = (f) => Array.from({ length: MAX_SEATS }, typeof f === 'function' ? f : () => f);

function newRoom(room, now = Date.now()) {
  return {
    room,
    v: 1,
    seq: 0,
    created: now,
    settings: { ...DEFAULT_SETTINGS },
    members: {},
    host: null, // id of the room's host: sets the game mode / rules
    open: false, // true once the host opened the table for seating
    seats: arr(null), // {id,name} per seat, up to MAX_SEATS
    ready: arr(false),
    alive: arr(false), // still in the current match (false once eliminated / forfeited)
    elim: arr(0), // round in which a seat was eliminated
    phase: 'lobby', // lobby | betting | playing | dealer | settled | over
    round: 0,
    first: 0,
    balances: arr(0),
    bets: arr(null),
    lastBet: arr(0),
    hands: arr(() => []),
    dealer: { cards: [] },
    holeHidden: false,
    shoe: [],
    turn: null,
    timerAt: 0,
    timerKind: '',
    timerDur: 0,
    dealerAt: 0,
    nextVotes: arr(false),
    results: null,
    over: null,
    history: [],
    series: [],
    stats: { w: arr(0), l: arr(0), p: arr(0), bj: arr(0) },
    chat: [],
    chatId: 0,
  };
}

const bump = (st) => {
  st.v++;
};
const gameBump = (st) => {
  st.seq++;
  st.v++;
};
function setTimer(st, now, kind, secs) {
  if (secs > 0) {
    st.timerKind = kind;
    st.timerDur = secs * 1000;
    st.timerAt = now + secs * 1000;
  } else clearTimer(st);
}
function setTimerMs(st, now, kind, ms) {
  st.timerKind = kind;
  st.timerDur = ms;
  st.timerAt = now + ms;
}
function clearTimer(st) {
  st.timerKind = '';
  st.timerDur = 0;
  st.timerAt = 0;
}

// System event: x is a plain-text fallback, k = kind and d = data let the UI render a styled card.
function sys(st, text, now = Date.now(), k = '', d = null) {
  const m = { id: ++st.chatId, s: 1, x: text, t: now };
  if (k) { m.k = k; if (d) m.d = d; }
  st.chat.push(m);
  if (st.chat.length > CHAT_MAX) st.chat.splice(0, st.chat.length - CHAT_MAX);
}
const seatOf = (st, id) => st.seats.findIndex((s) => s && s.id === id);
const isOnline = (st, id, now) => {
  const m = st.members[id];
  return !!m && now - m.lastSeen < ONLINE_MS;
};
const seatedList = (st) => st.seats.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
const aliveList = (st) => seatedList(st).filter((i) => st.alive[i]);
const modeOf = (st) => MODES[st.settings.mode] || MODES.duel;
const isShowdown = (st) => st.settings.mode === 'showdown';
const betSecs = (st) => (st.settings.blitz ? BLITZ_SECS : st.settings.betTime);
const actionSecs = (st) => (st.settings.blitz ? BLITZ_SECS : st.settings.actionTime);
const interMs = (st) => (st.settings.blitz ? BLITZ_INTERMISSION_MS : INTERMISSION_MS);

// Tournament: bet limits grow x1.5 every `blindEvery` rounds. Other modes: constant limits.
function levelOf(st, round) {
  return st.settings.mode === 'tournament' ? Math.floor((Math.max(1, round) - 1) / st.settings.blindEvery) : 0;
}
function limits(st, round = st.round) {
  const mul = Math.pow(1.5, levelOf(st, round));
  return { min: Math.round(st.settings.minBet * mul), max: Math.round(st.settings.maxBet * mul), level: levelOf(st, round) };
}

// Seat order for a round: alive seats, starting with `first`, going up and wrapping.
function nextAliveAfter(st, from) {
  for (let k = 1; k <= MAX_SEATS; k++) {
    const i = (((from + k) % MAX_SEATS) + MAX_SEATS) % MAX_SEATS;
    if (st.seats[i] && st.alive[i]) return i;
  }
  return -1;
}
function order(st) {
  const out = [];
  let s = st.first;
  for (let k = 0; k < MAX_SEATS; k++) {
    if (st.seats[s] && st.alive[s]) out.push(s);
    s = (s + 1) % MAX_SEATS;
  }
  return out;
}

/* ---------- round flow ---------- */
function startMatch(st, now) {
  const seated = seatedList(st);
  st.alive = arr(false);
  st.elim = arr(0);
  st.balances = arr(0);
  for (const i of seated) {
    st.alive[i] = true;
    st.balances[i] = st.settings.startingBalance;
  }
  st.round = 0;
  st.history = [];
  st.series = [[...st.balances]];
  st.stats = { w: arr(0), l: arr(0), p: arr(0), bj: arr(0) };
  st.lastBet = arr(0);
  st.over = null;
  st.shoe = newShoe(st.settings.decks);
  st.ready = arr(false);
  const names = seated.map((i) => st.seats[i].name);
  sys(st, `${modeOf(st).label} started: ${names.join(', ')}. Starting stack ${st.settings.startingBalance}. Good luck.`, now, 'start', {
    names,
    seats: seated,
    stack: st.settings.startingBalance,
    mode: st.settings.mode,
    blitz: st.settings.blitz,
  });
  beginBetting(st, now);
}

function beginBetting(st, now, keepFirst = false) {
  st.round++;
  if (keepFirst && st.seats[st.first] && st.alive[st.first]) {
    /* same first actor as the aborted round */
  } else if (keepFirst) st.first = nextAliveAfter(st, st.first);
  else st.first = st.round === 1 ? nextAliveAfter(st, -1) : nextAliveAfter(st, st.first);
  if (st.shoe.length < st.settings.decks * 52 * 0.25) {
    st.shoe = newShoe(st.settings.decks);
    sys(st, 'Shoe reshuffled.', now, 'shuffle');
  }
  const lim = limits(st);
  if (lim.level > 0 && (st.round - 1) % st.settings.blindEvery === 0) {
    sys(st, `Blinds up: bets are now ${lim.min}–${lim.max}.`, now, 'level', { lvl: lim.level + 1, min: lim.min, max: lim.max });
  }
  st.phase = 'betting';
  st.bets = arr(null);
  st.hands = arr(() => []);
  st.dealer = { cards: [] };
  st.holeHidden = false;
  st.results = null;
  st.turn = null;
  st.nextVotes = arr(false);
  setTimer(st, now, 'bet', betSecs(st));
  gameBump(st);
}

function betBounds(st, seat) {
  const lim = limits(st);
  return { min: lim.min, max: Math.min(lim.max, st.balances[seat]) };
}

function placeBet(st, seat, amount, now) {
  if (st.phase !== 'betting') throw new ApiError('bad_phase', 'Betting is closed');
  if (!st.alive[seat]) throw new ApiError('not_in_round', 'You are out of this match');
  if (st.bets[seat] != null) throw new ApiError('already_bet', 'Bet already placed');
  amount = Math.floor(Number(amount));
  const { min, max } = betBounds(st, seat);
  // going all-in (your whole stack) is always allowed, even above the table maximum or below the minimum
  const allIn = amount > 0 && amount === st.balances[seat];
  if (!Number.isFinite(amount) || (!allIn && (amount < min || amount > max))) throw new ApiError('bad_bet', `Bet must be ${min}–${max}, or all in`);
  st.bets[seat] = amount;
  st.lastBet[seat] = amount;
  st.balances[seat] -= amount;
  gameBump(st);
  if (aliveList(st).every((s) => st.bets[s] != null)) deal(st, now);
}

const newHand = (bet) => ({ cards: [], bet, doubled: false, done: false, bj: false, fromSplit: false });

function deal(st, now) {
  const ord = order(st);
  st.hands = arr(() => []);
  for (const s of ord) st.hands[s] = [newHand(st.bets[s])];
  st.dealer = { cards: [] };
  const showdown = isShowdown(st);
  for (let pass = 0; pass < 2; pass++) {
    for (const s of ord) st.hands[s][0].cards.push(draw(st));
    if (!showdown) st.dealer.cards.push(draw(st));
  }
  st.holeHidden = !showdown;
  st.phase = 'playing';
  st.dealerAt = 0;
  clearTimer(st);
  gameBump(st);

  if (!showdown) {
    const up = cardValue(st.dealer.cards[0]);
    if (up >= 10 && handTotal(st.dealer.cards).total === 21) {
      // dealer peeks and has blackjack: round is over before anyone acts
      for (const s of ord) {
        const h = st.hands[s][0];
        h.bj = handTotal(h.cards).total === 21;
        h.done = true;
      }
      startDealer(st, now);
      return;
    }
  }
  for (const s of ord) {
    const h = st.hands[s][0];
    if (handTotal(h.cards).total === 21) {
      h.bj = true;
      h.done = true;
    }
  }
  advanceTurn(st, now);
}

function advanceTurn(st, now) {
  for (const s of order(st)) {
    for (let h = 0; h < st.hands[s].length; h++) {
      if (!st.hands[s][h].done) {
        st.turn = { seat: s, hand: h };
        setTimer(st, now, 'action', actionSecs(st));
        gameBump(st);
        return;
      }
    }
  }
  st.turn = null;
  if (isShowdown(st)) {
    clearTimer(st);
    settleShowdown(st, now);
  } else startDealer(st, now);
}

function startDealer(st, now) {
  st.turn = null;
  st.holeHidden = false;
  const live = st.hands.some((hs) => hs.some((h) => !h.bj && handTotal(h.cards).total <= 21));
  let draws = 0;
  if (live) {
    for (;;) {
      const { total, soft } = handTotal(st.dealer.cards);
      if (total < 17 || (st.settings.h17 && total === 17 && soft)) {
        st.dealer.cards.push(draw(st));
        draws++;
      } else break;
    }
  }
  st.phase = 'dealer';
  st.dealerAt = now;
  setTimerMs(st, now, 'dealer', 500 + 800 * draws + 900);
  gameBump(st);
}

function curHand(st, seat) {
  if (st.phase !== 'playing' || !st.turn || st.turn.seat !== seat) throw new ApiError('not_your_turn', 'Not your turn');
  const h = st.hands[seat][st.turn.hand];
  if (!h || h.done) throw new ApiError('not_your_turn', 'Not your turn');
  return h;
}

function legal(st, seat) {
  if (st.phase !== 'playing' || !st.turn || st.turn.seat !== seat) return null;
  const h = st.hands[seat][st.turn.hand];
  if (!h || h.done) return null;
  const two = h.cards.length === 2;
  return {
    hit: true,
    stand: true,
    double: two && st.balances[seat] >= h.bet,
    split:
      !isShowdown(st) &&
      two &&
      cardValue(h.cards[0]) === cardValue(h.cards[1]) &&
      st.hands[seat].length < MAX_HANDS &&
      st.balances[seat] >= h.bet,
  };
}

function finishHandAction(st, h, now) {
  gameBump(st);
  if (h.done) advanceTurn(st, now);
  else setTimer(st, now, 'action', actionSecs(st));
}

function actHit(st, seat, now) {
  const h = curHand(st, seat);
  h.cards.push(draw(st));
  if (handTotal(h.cards).total >= 21) h.done = true;
  finishHandAction(st, h, now);
}
function actStand(st, seat, now) {
  const h = curHand(st, seat);
  h.done = true;
  finishHandAction(st, h, now);
}
function actDouble(st, seat, now) {
  const h = curHand(st, seat);
  if (!legal(st, seat).double) throw new ApiError('illegal', "Can't double here");
  st.balances[seat] -= h.bet;
  h.bet *= 2;
  h.doubled = true;
  h.cards.push(draw(st));
  h.done = true;
  finishHandAction(st, h, now);
}
function actSplit(st, seat, now) {
  const h = curHand(st, seat);
  if (!legal(st, seat).split) throw new ApiError('illegal', "Can't split here");
  st.balances[seat] -= h.bet;
  const idx = st.turn.hand;
  const aces = rankOf(h.cards[0]) === 'A';
  const a = newHand(h.bet);
  const b = newHand(h.bet);
  a.fromSplit = b.fromSplit = true;
  a.cards = [h.cards[0], draw(st)];
  b.cards = [h.cards[1], draw(st)];
  for (const x of [a, b]) if (aces || handTotal(x.cards).total >= 21) x.done = true;
  st.hands[seat].splice(idx, 1, a, b);
  gameBump(st);
  if (a.done) advanceTurn(st, now);
  else setTimer(st, now, 'action', actionSecs(st));
}

const fmtNet = (n) => (n > 0 ? `+${n}` : `${n}`);

// Records stats / history / chat for a finished round, then decides eliminations and match end.
function finishRound(st, now, ord, res, nets, dealerInfo) {
  for (const s of ord) {
    if (nets[s] > 0) st.stats.w[s]++;
    else if (nets[s] < 0) st.stats.l[s]++;
    else st.stats.p[s]++;
    if (res[s].some((r) => r.out === 'blackjack')) st.stats.bj[s]++;
  }
  st.results = res;
  st.history.push({
    r: st.round,
    t: now,
    first: st.first,
    dealer: dealerInfo,
    seats: ord.map((s) => ({
      seat: s,
      name: st.seats[s].name,
      hands: st.hands[s].map((h, i) => ({ cards: [...h.cards], bet: h.bet, out: res[s][i].out, net: res[s][i].net })),
      net: nets[s],
    })),
    bal: [...st.balances],
  });
  if (st.history.length > HISTORY_MAX) st.history.shift();
  st.series.push([...st.balances]);
  if (st.series.length > 200) st.series.shift();

  sys(st, `Round ${st.round}: ${ord.map((s) => `${st.seats[s].name} ${fmtNet(nets[s])}`).join(' · ')}`, now, 'round', {
    r: st.round,
    p: ord.map((s) => ({ s, n: st.seats[s].name, net: nets[s], bal: st.balances[s] })),
  });

  // eliminations: anyone who cannot cover the next round's minimum bet is out
  const nextMin = limits(st, st.round + 1).min;
  const out = ord.filter((s) => st.balances[s] < nextMin).sort((a, b) => st.balances[b] - st.balances[a] || a - b);
  for (const s of out) {
    st.alive[s] = false;
    st.elim[s] = st.round;
  }
  const remaining = aliveList(st).length;
  out.forEach((s, idx) => {
    const n = st.seats[s].name;
    sys(st, `${n} is out of chips.`, now, 'out', { n, s, place: remaining + 1 + idx, tourney: st.settings.mode === 'tournament' });
  });

  const roundsDone = st.settings.maxRounds > 0 && st.round >= st.settings.maxRounds;
  if (remaining <= 1 || roundsDone) endMatch(st, remaining <= 1 ? 'broke' : 'rounds');
  st.phase = 'settled';
  st.nextVotes = arr(false);
  setTimerMs(st, now, 'next', interMs(st));
  gameBump(st);
}

function settleRound(st, now) {
  const dc = st.dealer.cards;
  const dt = handTotal(dc).total;
  const dBJ = dc.length === 2 && dt === 21;
  const dBust = dt > 21;
  const ord = aliveList(st);
  const res = arr(() => []);
  const nets = arr(0);
  for (const s of ord) {
    for (const h of st.hands[s]) {
      const t = handTotal(h.cards).total;
      let out;
      let pay = 0;
      if (t > 21) out = 'bust';
      else if (h.bj) {
        if (dBJ) {
          out = 'push';
          pay = h.bet;
        } else {
          out = 'blackjack';
          pay = h.bet + Math.floor(h.bet * st.settings.payout);
        }
      } else if (dBJ) out = 'lose';
      else if (dBust || t > dt) {
        out = 'win';
        pay = h.bet * 2;
      } else if (t === dt) {
        out = 'push';
        pay = h.bet;
      } else out = 'lose';
      st.balances[s] += pay;
      const net = pay - h.bet;
      nets[s] += net;
      res[s].push({ out, net });
    }
  }
  finishRound(st, now, ord, res, nets, { cards: [...dc], total: dt, bj: dBJ, bust: dBust });
}

// Showdown: no house. Poker-style side pots: every stake level forms a pot that the best eligible hand
// wins (ties split it). Natural blackjack > 21 > 20 ... > bust. You can never lose more than your stake
// and chips are conserved. A stake nobody else matched simply comes back to its owner.
function settleShowdown(st, now) {
  st.holeHidden = false;
  const ord = aliveList(st);
  const score = {};
  const stake = {};
  for (const s of ord) {
    const h = st.hands[s][0];
    const t = handTotal(h.cards).total;
    score[s] = t > 21 ? -1 : h.bj ? 22 : t;
    stake[s] = h.bet;
  }
  const payout = {};
  for (const s of ord) payout[s] = 0;
  const levels = [...new Set(ord.map((s) => stake[s]))].sort((a, b) => a - b);
  let prev = 0;
  for (const L of levels) {
    const contributors = ord.filter((s) => stake[s] >= L);
    const pot = (L - prev) * contributors.length;
    prev = L;
    const best = Math.max(...contributors.map((s) => score[s]));
    const winners = contributors.filter((s) => score[s] === best);
    const share = Math.floor(pot / winners.length);
    let rem = pot - share * winners.length;
    for (const w of winners) {
      payout[w] += share + (rem > 0 ? 1 : 0);
      if (rem > 0) rem--;
    }
  }
  const res = arr(() => []);
  const nets = arr(0);
  for (const s of ord) {
    const h = st.hands[s][0];
    nets[s] = payout[s] - stake[s];
    st.balances[s] += payout[s];
    const bust = score[s] === -1;
    res[s].push({ out: nets[s] > 0 ? (h.bj ? 'blackjack' : 'win') : nets[s] < 0 ? (bust ? 'bust' : 'lose') : bust ? 'bust' : 'push', net: nets[s] });
  }
  finishRound(st, now, ord, res, nets, null);
}

// Final standings: survivors by stack, then the eliminated, latest elimination first.
function ranking(st) {
  const rows = seatedList(st).map((s) => ({ seat: s, name: st.seats[s].name, balance: st.balances[s], alive: st.alive[s], elim: st.elim[s] }));
  const key = (r) => (r.alive ? [1, r.balance] : [0, r.elim, r.balance]);
  const cmp = (a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < 3; i++) {
      const x = ka[i] ?? 0;
      const y = kb[i] ?? 0;
      if (x !== y) return y - x;
    }
    return 0;
  };
  rows.sort((a, b) => cmp(a, b) || a.seat - b.seat);
  let place = 0;
  rows.forEach((r, i) => {
    if (i === 0 || cmp(rows[i - 1], r) !== 0) place = i + 1;
    r.place = place;
  });
  return rows.map(({ seat, name, balance, place: p }) => ({ seat, name, balance, place: p }));
}

function endMatch(st, reason) {
  const rk = ranking(st);
  const winners = rk.filter((r) => r.place === 1).map((r) => r.seat);
  st.over = { winner: winners.length === 1 ? winners[0] : -1, winners, reason, ranking: rk };
}

function proceedFromSettled(st, now) {
  if (st.over) {
    st.phase = 'over';
    clearTimer(st);
    const w = st.over.winners.map((s) => st.seats[s] && st.seats[s].name).filter(Boolean);
    if (st.over.winner >= 0 && w.length === 1) sys(st, `${w[0]} wins the match!`, now, 'win', { n: w[0], why: st.over.reason });
    else sys(st, 'Match ends in a draw.', now, 'draw', w.length ? { names: w } : null);
    gameBump(st);
  } else beginBetting(st, now);
}

// A player leaves a live match (forfeit or disconnect). The match goes on if two or more remain.
function forfeit(st, seat, reason, now) {
  const name = st.seats[seat].name;
  if (!st.alive[seat]) {
    // already eliminated: just give up the seat
    st.seats[seat] = null;
    st.ready[seat] = false;
    sys(st, `${name} left seat ${seat + 1}.`, now, 'unseat', { n: name, s: seat });
    bump(st);
    return;
  }
  const live = ['betting', 'playing', 'dealer'].includes(st.phase);
  if (live) {
    // refund the aborted round to everybody
    if (st.phase === 'betting') {
      for (const s of aliveList(st)) if (st.bets[s] != null) st.balances[s] += st.bets[s];
    } else for (const s of aliveList(st)) for (const h of st.hands[s]) st.balances[s] += h.bet;
  }
  st.alive[seat] = false;
  st.seats[seat] = null;
  st.ready = arr(false);
  st.hands[seat] = [];
  st.bets[seat] = null;
  sys(st, reason === 'disconnect' ? `${name} disconnected and forfeits the match.` : `${name} forfeits the match.`, now, reason === 'disconnect' ? 'dc' : 'forfeit', { n: name });

  const remaining = aliveList(st);
  if (remaining.length <= 1) {
    st.turn = null;
    st.holeHidden = false;
    st.results = null;
    clearTimer(st);
    endMatch(st, reason);
    st.phase = 'over';
    const w = st.over.winners.map((s) => st.seats[s] && st.seats[s].name).filter(Boolean);
    if (w.length === 1) sys(st, `${w[0]} wins the match!`, now, 'win', { n: w[0], why: reason });
    else sys(st, 'Match ends in a draw.', now, 'draw', w.length ? { names: w } : null);
    gameBump(st);
    return;
  }
  if (live) {
    st.round--; // replay this round without the leaver
    st.turn = null;
    st.holeHidden = false;
    st.results = null;
    beginBetting(st, now, true);
    return;
  }
  // settled: stack payouts already happened; carry on at the next intermission
  gameBump(st);
  if (st.phase === 'settled' && !st.over && remaining.every((s) => st.nextVotes[s])) proceedFromSettled(st, now);
}

/* ---------- timers ---------- */
function autoBets(st, now) {
  for (const s of aliveList(st)) {
    if (st.bets[s] != null || st.phase !== 'betting') continue;
    const { min, max } = betBounds(st, s);
    placeBet(st, s, Math.min(max, Math.max(min, st.lastBet[s] || min)), now);
  }
}

function fireTimer(st, now) {
  const kind = st.timerKind;
  clearTimer(st);
  if (kind === 'bet' && st.phase === 'betting') autoBets(st, now);
  else if (kind === 'action' && st.phase === 'playing' && st.turn) {
    const h = st.hands[st.turn.seat][st.turn.hand];
    h.done = true;
    sys(st, `${st.seats[st.turn.seat].name} ran out of time and stands.`, now, 'timeout', { n: st.seats[st.turn.seat].name });
    gameBump(st);
    advanceTurn(st, now);
  } else if (kind === 'dealer' && st.phase === 'dealer') settleRound(st, now);
  else if (kind === 'next' && st.phase === 'settled') proceedFromSettled(st, now);
}

function stepTimers(st, now) {
  for (const i of seatedList(st)) {
    const s = st.seats[i];
    const m = st.members[s.id];
    if (m && now - m.lastSeen <= FORFEIT_MS) continue;
    if (st.phase === 'lobby' || st.phase === 'over' || (st.phase === 'settled' && st.over)) {
      st.seats[i] = null;
      st.ready = arr(false);
      if (st.phase === 'settled') proceedFromSettled(st, now);
      sys(st, `${s.name} left their seat.`, now, 'unseat', { n: s.name });
      bump(st);
      return true;
    }
    forfeit(st, i, 'disconnect', now);
    return true;
  }
  if (st.timerAt && now >= st.timerAt) {
    fireTimer(st, now);
    return true;
  }
  return false;
}

function tick(st, now) {
  for (let g = 0; g < 16; g++) if (!stepTimers(st, now)) break;
}

/* ---------- actions ---------- */
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.\-]{1,15}$/u;
// Avatar profile: a #rrggbb color and an icon key (null = first letter of the name).
const AVATAR_ICONS = ['crown', 'skull', 'flame', 'ghost', 'rocket', 'zap', 'gem', 'cat', 'dog', 'bot', 'clover', 'star', 'bird', 'fish', 'spade', 'dices'];
const COLOR_RE = /^#[0-9a-f]{6}$/i;
// Character avatars are pre-rendered DiceBear SVGs in public/avatars/<style>-<n>.svg
const CHAR_RE = /^(lorelei|openpeeps|pixelart|bottts):([0-9]|1[0-5])$/;

function profOf(st, id) {
  const m = st.members[id];
  return { color: (m && m.color) || null, icon: (m && m.icon) || null };
}

function cleanName(n) {
  n = String(n || '').trim().replace(/\s+/g, ' ');
  return NAME_RE.test(n) ? n : null;
}

function upsertMember(st, user, now) {
  let m = st.members[user.id];
  if (!m) {
    m = st.members[user.id] = { id: user.id, name: user.name, joinedAt: now, lastSeen: now, lastChat: 0 };
    return true;
  }
  m.name = user.name;
  m.lastSeen = now;
  return false;
}

function prune(st, now) {
  for (const id of Object.keys(st.members)) {
    if (seatOf(st, id) >= 0) continue;
    if (now - st.members[id].lastSeen > PRUNE_MS) delete st.members[id];
  }
}


// Seats keep their chosen color unless an earlier seat already uses it (then they fall back to the seat default).
function resolveProfiles(st) {
  const used = new Set();
  return st.seats.map((s) => {
    if (!s) return null;
    const p = profOf(st, s.id);
    if (p.color && used.has(p.color)) p.color = null;
    if (p.color) used.add(p.color);
    return p;
  });
}

// the first person to act in a room is its host; if the host disappears the next active person takes over
function ensureHost(st, user, now) {
  if (st.open === undefined) st.open = st.phase !== 'lobby' || seatedList(st).length > 0; // rooms saved before hosts existed
  const h = st.host && st.members[st.host];
  if (!st.host) st.host = user.id;
  else if (st.host !== user.id && (!h || now - h.lastSeen > HOST_AWAY_MS)) {
    st.host = user.id;
    sys(st, `${user.name} is now the host.`, now, 'host', { n: user.name });
    bump(st);
  }
}
function requireHost(st, user) {
  if (st.host !== user.id) {
    const h = st.members[st.host];
    throw new ApiError('not_host', `Only the host${h ? ' (' + h.name + ')' : ''} can do that`, 403);
  }
}

function requireSeat(st, user) {
  const seat = seatOf(st, user.id);
  if (seat < 0) throw new ApiError('not_seated', 'You are not seated');
  return seat;
}

function canStart(st) {
  const seated = seatedList(st);
  const { min, max } = modeOf(st);
  return seated.length >= min && seated.length <= max && seated.every((i) => st.ready[i]);
}

function checkVotes(st, now) {
  if (st.phase === 'settled' && aliveList(st).every((s) => st.nextVotes[s])) proceedFromSettled(st, now);
}

function applyAction(st, user, msg, now) {
  const type = String(msg.type || '');
  if (type === 'join') {
    const clash = Object.values(st.members).find(
      (m) => m.id !== user.id && m.name.toLowerCase() === user.name.toLowerCase() && now - m.lastSeen < ONLINE_MS * 2
    );
    if (clash) throw new ApiError('name_taken', 'That name is already at this table', 409);
    if (upsertMember(st, user, now)) {
      sys(st, `${user.name} joined the room.`, now, 'join', { n: user.name });
      bump(st);
    }
    ensureHost(st, user, now);
    prune(st, now);
    return;
  }
  upsertMember(st, user, now);
  ensureHost(st, user, now);

  // turn-based actions are guarded against stale / double submits
  const turnBased = ['hit', 'stand_hand', 'double', 'split'].includes(type);
  if (turnBased && msg.seq != null && Number(msg.seq) !== st.seq) throw new ApiError('stale', 'Stale action');

  switch (type) {
    case 'ping':
      return;
    case 'chat': {
      const text = String(msg.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 240);
      if (!text) return;
      const m = st.members[user.id];
      if (now - m.lastChat < 500) throw new ApiError('slow_down', 'Slow down');
      m.lastChat = now;
      st.chat.push({ id: ++st.chatId, n: user.name, u: user.id, x: text, t: now });
      if (st.chat.length > CHAT_MAX) st.chat.splice(0, st.chat.length - CHAT_MAX);
      bump(st);
      return;
    }
    case 'profile': {
      const m = st.members[user.id];
      const color = msg.color == null || msg.color === '' ? null : String(msg.color);
      const icon = msg.icon == null || msg.icon === '' ? null : String(msg.icon);
      if (color && !COLOR_RE.test(color)) throw new ApiError('bad_color', 'Invalid color');
      if (icon && !AVATAR_ICONS.includes(icon) && !CHAR_RE.test(icon)) throw new ApiError('bad_icon', 'Invalid icon');
      m.color = color ? color.toLowerCase() : null;
      m.icon = icon;
      bump(st);
      return;
    }
    case 'open': {
      requireHost(st, user);
      if (st.phase !== 'lobby') throw new ApiError('bad_phase');
      if (!st.open) {
        st.open = true;
        sys(st, `${user.name} opened the table.`, now, 'open', { n: user.name, mode: st.settings.mode });
        bump(st);
      }
      return;
    }
    case 'sit': {
      if (!st.open) throw new ApiError('not_open', 'The host is still setting up the table');
      if (st.phase !== 'lobby' && st.phase !== 'over') throw new ApiError('bad_phase', 'A match is in progress');
      const target = Number(msg.seat);
      if (!Number.isInteger(target) || target < 0 || target >= modeOf(st).max) throw new ApiError('bad_seat', 'No such seat in this mode');
      if (st.seats[target]) {
        if (st.seats[target].id === user.id) return;
        throw new ApiError('seat_taken', 'Seat is taken');
      }
      const cur = seatOf(st, user.id);
      if (cur >= 0) st.seats[cur] = null;
      st.seats[target] = { id: user.id, name: user.name };
      st.ready = arr(false);
      sys(st, `${user.name} took seat ${target + 1}.`, now, 'seat', { n: user.name, s: target });
      bump(st);
      return;
    }
    case 'stand': {
      const seat = requireSeat(st, user);
      if (st.phase === 'lobby' || st.phase === 'over' || !st.alive[seat]) {
        st.seats[seat] = null;
        st.ready = arr(false);
        sys(st, `${user.name} left seat ${seat + 1}.`, now, 'unseat', { n: user.name, s: seat });
        bump(st);
        checkVotes(st, now);
      } else if (st.phase === 'settled' && st.over) {
        proceedFromSettled(st, now);
      } else throw new ApiError('bad_phase', 'Use forfeit to leave a live match');
      return;
    }
    case 'forfeit': {
      const seat = requireSeat(st, user);
      if (!['betting', 'playing', 'dealer', 'settled'].includes(st.phase)) throw new ApiError('bad_phase');
      if (st.phase === 'settled' && st.over) {
        proceedFromSettled(st, now);
        return;
      }
      forfeit(st, seat, 'forfeit', now);
      return;
    }
    case 'settings': {
      requireHost(st, user);
      if (st.phase !== 'lobby') throw new ApiError('bad_phase', 'Settings are locked during a match');
      const next = sanitizeSettings(msg.settings || {}, st.settings);
      const cfg = MODES[next.mode];
      const seated = seatedList(st);
      if (seated.length > cfg.max) throw new ApiError('too_many', `${cfg.label} allows ${cfg.max} players. Stand up first.`);
      if (seated.some((i) => i >= cfg.max)) {
        // compact players into the first seats (e.g. switching to Duel)
        const people = seated.map((i) => st.seats[i]);
        st.seats = arr(null);
        people.forEach((p, k) => (st.seats[k] = p));
      }
      st.settings = next;
      st.ready = arr(false);
      bump(st);
      return;
    }
    case 'ready': {
      const seat = requireSeat(st, user);
      if (st.phase !== 'lobby') throw new ApiError('bad_phase');
      st.ready[seat] = !!msg.value;
      bump(st);
      if (canStart(st)) startMatch(st, now);
      return;
    }
    case 'lobby': {
      requireSeat(st, user);
      if (st.phase === 'settled' && st.over) proceedFromSettled(st, now);
      if (st.phase !== 'over') throw new ApiError('bad_phase');
      st.phase = 'lobby';
      st.over = null;
      st.ready = arr(false);
      st.alive = arr(false);
      st.hands = arr(() => []);
      st.dealer = { cards: [] };
      st.bets = arr(null);
      st.turn = null;
      st.results = null;
      bump(st);
      return;
    }
    case 'bet':
      return placeBet(st, requireSeat(st, user), msg.amount, now);
    case 'hit':
      return actHit(st, requireSeat(st, user), now);
    case 'stand_hand':
      return actStand(st, requireSeat(st, user), now);
    case 'double':
      return actDouble(st, requireSeat(st, user), now);
    case 'split':
      return actSplit(st, requireSeat(st, user), now);
    case 'next': {
      const seat = requireSeat(st, user);
      if (st.phase !== 'settled') throw new ApiError('bad_phase');
      if (!st.alive[seat]) return;
      st.nextVotes[seat] = true;
      bump(st);
      checkVotes(st, now);
      return;
    }
    default:
      throw new ApiError('unknown_action', 'Unknown action');
  }
}

/* ---------- views ---------- */
function onlineSig(st, now) {
  return Object.keys(st.members)
    .filter((id) => isOnline(st, id, now))
    .sort()
    .join(',');
}

function buildView(st, meId, now) {
  const inMatch = st.phase !== 'lobby';
  const mySeat = seatOf(st, meId);
  const profs = resolveProfiles(st);
  const mode = modeOf(st);
  return {
    v: st.v,
    seq: st.seq,
    now,
    room: st.room,
    phase: st.phase,
    round: st.round,
    first: st.first,
    settings: st.settings,
    mode: { id: st.settings.mode, label: mode.label, min: mode.min, max: mode.max },
    limits: limits(st),
    canStart: canStart(st),
    host: st.host ? { id: st.host, name: st.members[st.host]?.name || '' } : null,
    open: !!st.open,
    you: { id: meId, name: st.members[meId]?.name || '', seat: mySeat, host: st.host === meId },
    seats: st.seats.map((s, i) =>
      s
        ? {
            id: s.id,
            name: s.name,
            online: isOnline(st, s.id, now),
            ready: st.ready[i],
            alive: inMatch ? st.alive[i] : true,
            balance: inMatch ? st.balances[i] : st.settings.startingBalance,
            bet: st.bets[i],
            lastBet: st.lastBet[i],
            voted: st.nextVotes[i],
            ...profs[i],
          }
        : null
    ),
    members: Object.values(st.members)
      .filter((m) => isOnline(st, m.id, now))
      .map((m) => ({ id: m.id, name: m.name, seat: seatOf(st, m.id), color: m.color || null, icon: m.icon || null })),
    hands: st.hands,
    dealer: { cards: st.dealer.cards.map((c, i) => (i === 1 && st.holeHidden ? null : c)) },
    turn: st.turn,
    legal: mySeat >= 0 ? legal(st, mySeat) : null,
    timerAt: st.timerAt,
    timerKind: st.timerKind,
    timerDur: st.timerDur,
    dealerAt: st.dealerAt,
    results: st.results,
    over: st.over,
    shoeLeft: st.shoe.length,
    stats: st.stats,
    history: st.history.slice(-20),
    series: st.series.slice(-60),
    chat: st.chat,
  };
}

module.exports = {
  ApiError,
  DEFAULT_SETTINGS,
  MODES,
  MAX_SEATS,
  sanitizeSettings,
  cleanName,
  cardValue,
  handTotal,
  newShoe,
  newRoom,
  tick,
  applyAction,
  buildView,
  onlineSig,
  legal,
  limits,
  ONLINE_MS,
  FORFEIT_MS,
  INTERMISSION_MS,
};
