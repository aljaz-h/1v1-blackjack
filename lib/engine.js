'use strict';
// Pure blackjack state machine. No I/O. All time-based behaviour is driven by tick(state, now).
const crypto = require('node:crypto');

const ONLINE_MS = 30_000;
const FORFEIT_MS = 75_000;
const PRUNE_MS = 10 * 60_000;
const INTERMISSION_MS = 7_000;
const CHAT_MAX = 60;
const HISTORY_MAX = 40;
const MAX_HANDS = 4;
const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

class ApiError extends Error {
  constructor(code, message, status = 400) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_SETTINGS = {
  startingBalance: 1000,
  minBet: 10,
  maxBet: 500,
  decks: 6,
  payout: 1.5, // 3:2
  h17: false, // dealer stands on soft 17
  maxRounds: 0, // 0 = play until someone is broke
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
  if ('startingBalance' in input) s.startingBalance = clampInt(input.startingBalance, 50, 10_000_000, base.startingBalance);
  if ('minBet' in input) s.minBet = clampInt(input.minBet, 1, 1_000_000, base.minBet);
  if ('maxBet' in input) s.maxBet = clampInt(input.maxBet, 1, 10_000_000, base.maxBet);
  if ('decks' in input) s.decks = pick(Number(input.decks), [1, 2, 4, 6, 8], base.decks);
  if ('payout' in input) s.payout = pick(Number(input.payout), [1.5, 1.2, 1], base.payout);
  if ('h17' in input) s.h17 = !!input.h17;
  if ('maxRounds' in input) s.maxRounds = pick(Number(input.maxRounds), [0, 5, 10, 20, 50, 100], base.maxRounds);
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
function newRoom(room, now = Date.now()) {
  return {
    room,
    v: 1,
    seq: 0,
    created: now,
    settings: { ...DEFAULT_SETTINGS },
    members: {},
    seats: [null, null],
    ready: [false, false],
    phase: 'lobby', // lobby | betting | playing | dealer | settled | over
    round: 0,
    first: 0,
    balances: [0, 0],
    bets: [null, null],
    lastBet: [0, 0],
    hands: [[], []],
    dealer: { cards: [] },
    holeHidden: false,
    shoe: [],
    turn: null,
    timerAt: 0,
    timerKind: '',
    timerDur: 0,
    dealerAt: 0,
    nextVotes: [false, false],
    results: null,
    over: null,
    history: [],
    series: [],
    stats: { w: [0, 0], l: [0, 0], p: [0, 0], bj: [0, 0] },
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

/* ---------- round flow ---------- */
function startMatch(st, now) {
  st.balances = [st.settings.startingBalance, st.settings.startingBalance];
  st.round = 0;
  st.history = [];
  st.series = [[st.settings.startingBalance, st.settings.startingBalance]];
  st.stats = { w: [0, 0], l: [0, 0], p: [0, 0], bj: [0, 0] };
  st.lastBet = [0, 0];
  st.over = null;
  st.shoe = newShoe(st.settings.decks);
  st.ready = [false, false];
  sys(st, `Match started: ${st.seats[0].name} vs ${st.seats[1].name}. Starting stack ${st.settings.startingBalance}. Good luck.`, now, 'start', { a: st.seats[0].name, b: st.seats[1].name, stack: st.settings.startingBalance });
  beginBetting(st, now);
}

function beginBetting(st, now) {
  st.round++;
  st.first = (st.round - 1) % 2;
  if (st.shoe.length < st.settings.decks * 52 * 0.25) {
    st.shoe = newShoe(st.settings.decks);
    sys(st, 'Shoe reshuffled.', now, 'shuffle');
  }
  st.phase = 'betting';
  st.bets = [null, null];
  st.hands = [[], []];
  st.dealer = { cards: [] };
  st.holeHidden = false;
  st.results = null;
  st.turn = null;
  st.nextVotes = [false, false];
  setTimer(st, now, 'bet', st.settings.betTime);
  gameBump(st);
}

function betBounds(st, seat) {
  return { min: st.settings.minBet, max: Math.min(st.settings.maxBet, st.balances[seat]) };
}

function placeBet(st, seat, amount, now) {
  if (st.phase !== 'betting') throw new ApiError('bad_phase', 'Betting is closed');
  if (st.bets[seat] != null) throw new ApiError('already_bet', 'Bet already placed');
  amount = Math.floor(Number(amount));
  const { min, max } = betBounds(st, seat);
  if (!Number.isFinite(amount) || amount < min || amount > max) throw new ApiError('bad_bet', `Bet must be ${min}–${max}`);
  st.bets[seat] = amount;
  st.lastBet[seat] = amount;
  st.balances[seat] -= amount;
  gameBump(st);
  if (st.bets[0] != null && st.bets[1] != null) deal(st, now);
}

const newHand = (bet) => ({ cards: [], bet, doubled: false, done: false, bj: false, fromSplit: false });

function deal(st, now) {
  const order = [st.first, 1 - st.first];
  st.hands = [[], []];
  for (const s of order) st.hands[s] = [newHand(st.bets[s])];
  st.dealer = { cards: [] };
  for (let pass = 0; pass < 2; pass++) {
    for (const s of order) st.hands[s][0].cards.push(draw(st));
    st.dealer.cards.push(draw(st));
  }
  st.holeHidden = true;
  st.phase = 'playing';
  st.dealerAt = 0;
  clearTimer(st);
  gameBump(st);

  const up = cardValue(st.dealer.cards[0]);
  if (up >= 10 && handTotal(st.dealer.cards).total === 21) {
    // dealer peeks and has blackjack: round is over before anyone acts
    for (let s = 0; s < 2; s++) {
      const h = st.hands[s][0];
      h.bj = handTotal(h.cards).total === 21;
      h.done = true;
    }
    startDealer(st, now);
    return;
  }
  for (let s = 0; s < 2; s++) {
    const h = st.hands[s][0];
    if (handTotal(h.cards).total === 21) {
      h.bj = true;
      h.done = true;
    }
  }
  advanceTurn(st, now);
}

function advanceTurn(st, now) {
  for (const s of [st.first, 1 - st.first]) {
    for (let h = 0; h < st.hands[s].length; h++) {
      if (!st.hands[s][h].done) {
        st.turn = { seat: s, hand: h };
        setTimer(st, now, 'action', st.settings.actionTime);
        gameBump(st);
        return;
      }
    }
  }
  st.turn = null;
  startDealer(st, now);
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
      two &&
      cardValue(h.cards[0]) === cardValue(h.cards[1]) &&
      st.hands[seat].length < MAX_HANDS &&
      st.balances[seat] >= h.bet,
  };
}

function finishHandAction(st, h, now) {
  gameBump(st);
  if (h.done) advanceTurn(st, now);
  else setTimer(st, now, 'action', st.settings.actionTime);
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
  else setTimer(st, now, 'action', st.settings.actionTime);
}

function settleRound(st, now) {
  const dc = st.dealer.cards;
  const dt = handTotal(dc).total;
  const dBJ = dc.length === 2 && dt === 21;
  const dBust = dt > 21;
  const res = [[], []];
  const nets = [0, 0];
  for (let s = 0; s < 2; s++) {
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
    dealer: { cards: [...dc], total: dt, bj: dBJ, bust: dBust },
    seats: [0, 1].map((s) => ({
      name: st.seats[s].name,
      hands: st.hands[s].map((h, i) => ({ cards: [...h.cards], bet: h.bet, out: res[s][i].out, net: res[s][i].net })),
      net: nets[s],
    })),
    bal: [...st.balances],
  });
  if (st.history.length > HISTORY_MAX) st.history.shift();
  st.series.push([...st.balances]);
  if (st.series.length > 200) st.series.shift();

  const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);
  sys(st, `Round ${st.round}: ${st.seats[0].name} ${fmt(nets[0])} · ${st.seats[1].name} ${fmt(nets[1])}`, now, 'round', {
    r: st.round,
    p: [0, 1].map((x) => ({ n: st.seats[x].name, net: nets[x], bal: st.balances[x] })),
  });

  const broke = [0, 1].filter((s) => st.balances[s] < st.settings.minBet);
  const roundsDone = st.settings.maxRounds > 0 && st.round >= st.settings.maxRounds;
  if (broke.length || roundsDone) {
    const winner = st.balances[0] > st.balances[1] ? 0 : st.balances[1] > st.balances[0] ? 1 : -1;
    st.over = { winner, reason: broke.length ? 'broke' : 'rounds' };
  }
  st.phase = 'settled';
  st.nextVotes = [false, false];
  setTimerMs(st, now, 'next', INTERMISSION_MS);
  gameBump(st);
}

function proceedFromSettled(st, now) {
  if (st.over) {
    st.phase = 'over';
    clearTimer(st);
    if (st.over.winner >= 0) sys(st, `${st.seats[st.over.winner].name} wins the match!`, now, 'win', { n: st.seats[st.over.winner].name, why: st.over.reason });
    else sys(st, 'Match ends in a draw.', now, 'draw');
    gameBump(st);
  } else beginBetting(st, now);
}

function forfeit(st, seat, reason, now) {
  const other = 1 - seat;
  const name = st.seats[seat].name;
  // refund the opponent's money that is sitting in the aborted round
  if (['betting', 'playing', 'dealer'].includes(st.phase)) {
    if (st.phase === 'betting') {
      if (st.bets[other] != null) st.balances[other] += st.bets[other];
    } else for (const h of st.hands[other]) st.balances[other] += h.bet;
  }
  st.over = { winner: other, reason };
  st.phase = 'over';
  st.turn = null;
  st.holeHidden = false;
  st.results = null;
  clearTimer(st);
  st.seats[seat] = null;
  st.ready = [false, false];
  sys(
    st,
    reason === 'disconnect' ? `${name} disconnected and forfeits the match.` : `${name} forfeits the match.`,
    now,
    reason === 'disconnect' ? 'dc' : 'forfeit',
    { n: name }
  );
  const winnerName = st.members[st.seats[other].id]?.name || st.seats[other].name;
  sys(st, `${winnerName} wins the match!`, now, 'win', { n: winnerName, why: reason });
  gameBump(st);
}

/* ---------- timers ---------- */
function autoBets(st, now) {
  for (let s = 0; s < 2; s++) {
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
  for (let i = 0; i < 2; i++) {
    const s = st.seats[i];
    if (!s) continue;
    const m = st.members[s.id];
    if (m && now - m.lastSeen <= FORFEIT_MS) continue;
    if (st.phase === 'lobby' || st.phase === 'over' || (st.phase === 'settled' && st.over)) {
      st.seats[i] = null;
      st.ready = [false, false];
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
  for (let g = 0; g < 8; g++) if (!stepTimers(st, now)) break;
}

/* ---------- actions ---------- */
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.\-]{1,15}$/u;
// Avatar profile: a #rrggbb color and an icon key (null = first letter of the name).
const AVATAR_ICONS = ['crown', 'skull', 'flame', 'ghost', 'rocket', 'zap', 'gem', 'cat', 'dog', 'bot', 'clover', 'star', 'bird', 'fish', 'spade', 'dices'];
const COLOR_RE = /^#[0-9a-f]{6}$/i;

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

// Seat 2 falls back to its default color if both players picked the same one.
function seatProf(st, i) {
  const p = profOf(st, st.seats[i].id);
  if (i === 1 && st.seats[0] && p.color && p.color === profOf(st, st.seats[0].id).color) p.color = null;
  return p;
}

function requireSeat(st, user) {
  const seat = seatOf(st, user.id);
  if (seat < 0) throw new ApiError('not_seated', 'You are not seated');
  return seat;
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
    prune(st, now);
    return;
  }
  upsertMember(st, user, now);

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
      if (icon && !AVATAR_ICONS.includes(icon)) throw new ApiError('bad_icon', 'Invalid icon');
      m.color = color ? color.toLowerCase() : null;
      m.icon = icon;
      bump(st);
      return;
    }
    case 'sit': {
      if (st.phase !== 'lobby' && st.phase !== 'over') throw new ApiError('bad_phase', 'A match is in progress');
      const target = Number(msg.seat);
      if (target !== 0 && target !== 1) throw new ApiError('bad_seat');
      if (st.seats[target]) {
        if (st.seats[target].id === user.id) return;
        throw new ApiError('seat_taken', 'Seat is taken');
      }
      const cur = seatOf(st, user.id);
      if (cur >= 0) st.seats[cur] = null;
      st.seats[target] = { id: user.id, name: user.name };
      st.ready = [false, false];
      sys(st, `${user.name} took seat ${target + 1}.`, now, 'seat', { n: user.name, s: target });
      bump(st);
      return;
    }
    case 'stand': {
      const seat = requireSeat(st, user);
      if (st.phase === 'lobby' || st.phase === 'over') {
        st.seats[seat] = null;
        st.ready = [false, false];
        sys(st, `${user.name} left seat ${seat + 1}.`, now, 'unseat', { n: user.name, s: seat });
        bump(st);
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
      requireSeat(st, user);
      if (st.phase !== 'lobby') throw new ApiError('bad_phase', 'Settings are locked during a match');
      st.settings = sanitizeSettings(msg.settings || {}, st.settings);
      st.ready = [false, false];
      bump(st);
      return;
    }
    case 'ready': {
      const seat = requireSeat(st, user);
      if (st.phase !== 'lobby') throw new ApiError('bad_phase');
      st.ready[seat] = !!msg.value;
      bump(st);
      if (st.seats[0] && st.seats[1] && st.ready[0] && st.ready[1]) startMatch(st, now);
      return;
    }
    case 'lobby': {
      requireSeat(st, user);
      if (st.phase === 'settled' && st.over) proceedFromSettled(st, now);
      if (st.phase !== 'over') throw new ApiError('bad_phase');
      st.phase = 'lobby';
      st.over = null;
      st.ready = [false, false];
      st.hands = [[], []];
      st.dealer = { cards: [] };
      st.bets = [null, null];
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
      st.nextVotes[seat] = true;
      bump(st);
      if (st.nextVotes[0] && st.nextVotes[1]) proceedFromSettled(st, now);
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
  return {
    v: st.v,
    seq: st.seq,
    now,
    room: st.room,
    phase: st.phase,
    round: st.round,
    first: st.first,
    settings: st.settings,
    you: { id: meId, name: st.members[meId]?.name || '', seat: mySeat },
    seats: st.seats.map((s, i) =>
      s
        ? {
            id: s.id,
            name: s.name,
            online: isOnline(st, s.id, now),
            ready: st.ready[i],
            balance: inMatch ? st.balances[i] : st.settings.startingBalance,
            bet: st.bets[i],
            lastBet: st.lastBet[i],
            voted: st.nextVotes[i],
            ...seatProf(st, i),
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
  ONLINE_MS,
  FORFEIT_MS,
  INTERMISSION_MS,
};
