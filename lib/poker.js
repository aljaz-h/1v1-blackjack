'use strict';
// Texas Hold'em (no limit). A plugin for the room engine: lobby, seats, chat, host, pause and timers
// all live in engine.js. This file owns the hand itself. It is created with the engine's helpers:
//   const poker = require('./poker')(helpers)

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RV = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));
const rankOf = (c) => c.slice(0, -1);
const suitOf = (c) => c.slice(-1);
const HAND_NAMES = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];

/* ---------- hand evaluation ---------- */
function score5(c) {
  const v = c.map((x) => RV[rankOf(x)]).sort((a, b) => b - a);
  const flush = c.every((x) => suitOf(x) === suitOf(c[0]));
  let straight = 0;
  if (new Set(v).size === 5) {
    if (v[0] - v[4] === 4) straight = v[0];
    else if (v[0] === 14 && v[1] === 5 && v[2] === 4 && v[3] === 3 && v[4] === 2) straight = 5; // the wheel
  }
  const counts = {};
  for (const x of v) counts[x] = (counts[x] || 0) + 1;
  const g = Object.entries(counts)
    .map(([val, n]) => ({ val: +val, n }))
    .sort((a, b) => b.n - a.n || b.val - a.val);
  if (straight && flush) return [8, straight];
  if (g[0].n === 4) return [7, g[0].val, g[1].val];
  if (g[0].n === 3 && g[1].n === 2) return [6, g[0].val, g[1].val];
  if (flush) return [5, ...v];
  if (straight) return [4, straight];
  if (g[0].n === 3) return [3, g[0].val, g[1].val, g[2].val];
  if (g[0].n === 2 && g[1].n === 2) return [2, g[0].val, g[1].val, g[2].val];
  if (g[0].n === 2) return [1, g[0].val, g[1].val, g[2].val, g[3].val];
  return [0, ...v];
}
const cmp = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
};
// Best five of up to seven cards: { score, name, cards }
function evaluate(cards) {
  let best = null;
  const n = cards.length;
  const pick = (start, chosen) => {
    if (chosen.length === 5) {
      const sc = score5(chosen);
      if (!best || cmp(sc, best.score) > 0) best = { score: sc, cards: [...chosen] };
      return;
    }
    for (let i = start; i < n; i++) {
      chosen.push(cards[i]);
      pick(i + 1, chosen);
      chosen.pop();
    }
  };
  if (n < 5) {
    const v = cards.map((x) => RV[rankOf(x)]).sort((a, b) => b - a);
    return { score: [0, ...v], name: HAND_NAMES[0], cards: [...cards] };
  }
  pick(0, []);
  best.name = best.score[0] === 8 && best.score[1] === 14 ? 'Royal Flush' : HAND_NAMES[best.score[0]];
  return best;
}

function fullDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push(r + s);
  return d;
}

/* ---------- side pots ---------- */
// total[]: chips each seat put in. live[]: seats still contesting. Returns [{amount, eligible:[seats]}].
function buildPots(total, live) {
  const seats = total.map((t, i) => i).filter((i) => total[i] > 0);
  const levels = [...new Set(seats.map((i) => total[i]))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const lvl of levels) {
    let amount = 0;
    for (const i of seats) amount += Math.max(0, Math.min(total[i], lvl) - prev);
    const eligible = live.filter((i) => total[i] >= lvl);
    if (amount > 0) pots.push({ amount, eligible, level: lvl });
    prev = lvl;
  }
  return pots;
}

module.exports = function create(H) {
  const { arr, sys, setTimer, setTimerMs, clearTimer, gameBump, aliveList, seatedList, ApiError, nextAliveAfter, endMatch, HISTORY_MAX, fmtNet, shuffle, actionSecs, interMs } = H;

  const niceBlind = (v) => (v >= 20 ? Math.round(v / 5) * 5 : Math.round(v));
  function levelOf(st, round = st.round) {
    const every = st.settings.levelEvery;
    return every > 0 ? Math.floor((Math.max(1, round) - 1) / every) : 0;
  }
  function blinds(st, round = st.round) {
    const sb = niceBlind(st.settings.sb * Math.pow(1.5, levelOf(st, round)));
    return { sb, bb: sb * 2, level: levelOf(st, round) };
  }

  const pot = (pk) => pk.total.reduce((a, b) => a + b, 0);
  const inHand = (pk, s) => pk.inHand[s] && !pk.folded[s];
  const live = (pk) => pk.inHand.map((x, i) => (x && !pk.folded[i] ? i : -1)).filter((i) => i >= 0);
  const able = (pk) => live(pk).filter((i) => !pk.allin[i]);

  /* ---------- a hand ---------- */
  function startHand(st, now) {
    st.round++;
    const alive = aliveList(st);
    st.first = st.round === 1 ? nextAliveAfter(st, -1) : nextAliveAfter(st, st.first); // the dealer button
    const b = blinds(st);
    if (b.level > 0 && (st.round - 1) % st.settings.levelEvery === 0)
      sys(st, `Blinds up: ${b.sb}/${b.bb}.`, now, 'level', { lvl: b.level + 1, sb: b.sb, bb: b.bb, poker: true });

    const pk = {
      button: st.first,
      sbSeat: -1,
      bbSeat: -1,
      sb: b.sb,
      bb: b.bb,
      level: b.level,
      street: 'preflop',
      deck: shuffle(fullDeck()),
      board: [],
      hole: arr(() => []),
      inHand: arr(false),
      bet: arr(0),
      total: arr(0),
      folded: arr(false),
      allin: arr(false),
      acted: arr(false),
      noRaise: arr(false),
      last: arr(''),
      names: arr(''),
      cur: 0,
      minRaise: b.bb,
      to: -1,
      reveal: false,
      runout: false,
      res: null,
    };
    st.pk = pk;
    for (const s of alive) {
      pk.inHand[s] = true;
      pk.names[s] = st.seats[s].name;
    }
    // deal two hole cards each, starting left of the button
    const dealOrder = [];
    let s = st.first;
    for (let k = 0; k < 6; k++) {
      s = (s + 1) % 6;
      if (pk.inHand[s]) dealOrder.push(s);
    }
    for (let r = 0; r < 2; r++) for (const x of dealOrder) pk.hole[x].push(pk.deck.pop());

    // blinds: heads-up the button posts the small blind
    if (alive.length === 2) {
      pk.sbSeat = st.first;
      pk.bbSeat = nextAliveAfter(st, st.first);
    } else {
      pk.sbSeat = nextAliveAfter(st, st.first);
      pk.bbSeat = nextAliveAfter(st, pk.sbSeat);
    }
    commit(st, pk.sbSeat, pk.sb);
    commit(st, pk.bbSeat, pk.bb);
    pk.cur = Math.max(pk.bet[pk.sbSeat], pk.bet[pk.bbSeat]);
    st.phase = 'poker';
    st.results = null;
    st.over = null;
    st.nextVotes = arr(false);
    const first = alive.length === 2 ? pk.sbSeat : nextAliveAfter(st, pk.bbSeat);
    pk.to = nextToAct(st, prevSeat(first));
    nextStep(st, now);
  }
  const prevSeat = (s) => (s + 5) % 6;

  // put chips in front of a seat (clamped to its stack)
  function commit(st, seat, amount) {
    const pk = st.pk;
    const a = Math.max(0, Math.min(amount, st.balances[seat]));
    st.balances[seat] -= a;
    pk.bet[seat] += a;
    pk.total[seat] += a;
    if (st.balances[seat] === 0) pk.allin[seat] = true;
    return a;
  }

  // next seat after `from` that still has to act
  function nextToAct(st, from) {
    const pk = st.pk;
    for (let k = 1; k <= 6; k++) {
      const i = (from + k) % 6;
      if (inHand(pk, i) && !pk.allin[i] && (!pk.acted[i] || pk.bet[i] < pk.cur)) return i;
    }
    return -1;
  }

  // after any change: pick who acts next, or close the street
  function nextStep(st, now) {
    const pk = st.pk;
    if (live(pk).length <= 1) return awardUncontested(st, now);
    if (pk.to >= 0) {
      st.turn = { seat: pk.to, hand: 0 };
      setTimer(st, now, 'action', actionSecs(st));
      gameBump(st);
      return;
    }
    endStreet(st, now);
  }

  function endStreet(st, now) {
    const pk = st.pk;
    st.turn = null;
    if (pk.street === 'river') return showdown(st, now);
    // clear the street's bets (they stay counted in total)
    pk.bet = arr(0);
    pk.acted = arr(false);
    pk.noRaise = arr(false);
    pk.cur = 0;
    pk.minRaise = pk.bb;
    for (const i of seatedAll(pk)) if (pk.last[i] !== 'Fold' && pk.last[i] !== 'All-in') pk.last[i] = '';
    pk.deck.pop(); // burn
    if (pk.street === 'preflop') {
      pk.street = 'flop';
      pk.board.push(pk.deck.pop(), pk.deck.pop(), pk.deck.pop());
    } else if (pk.street === 'flop') {
      pk.street = 'turn';
      pk.board.push(pk.deck.pop());
    } else {
      pk.street = 'river';
      pk.board.push(pk.deck.pop());
    }
    if (able(pk).length <= 1) {
      // nobody left to bet against: reveal the rest of the board one street at a time
      pk.runout = true;
      pk.to = -1;
      setTimerMs(st, now, 'run', st.settings.blitz ? 900 : 1700);
      gameBump(st);
      return;
    }
    pk.to = nextToAct(st, st.first);
    nextStep(st, now);
  }
  const seatedAll = (pk) => [0, 1, 2, 3, 4, 5].filter((i) => pk.inHand[i]);

  /* ---------- player actions ---------- */
  function legal(st, seat) {
    const pk = st.pk;
    if (st.phase !== 'poker' || !pk || pk.to !== seat) return null;
    const stack = st.balances[seat];
    const toCall = pk.cur - pk.bet[seat];
    const maxTo = pk.bet[seat] + stack;
    const out = { check: toCall <= 0, call: Math.min(Math.max(toCall, 0), stack), toCall: Math.max(toCall, 0), allIn: maxTo, raise: null, pot: pot(pk) };
    if (!pk.noRaise[seat] && stack > toCall) out.raise = { min: Math.min(pk.cur + pk.minRaise, maxTo), max: maxTo };
    return out;
  }

  function act(st, seat, type, msg, now) {
    const pk = st.pk;
    if (st.phase !== 'poker' || !pk) throw new ApiError('bad_phase', 'No hand in progress');
    if (pk.to !== seat) throw new ApiError('not_your_turn', 'Not your turn');
    const toCall = pk.cur - pk.bet[seat];
    const name = pk.names[seat];
    if (type === 'fold') {
      pk.folded[seat] = true;
      pk.last[seat] = 'Fold';
    } else if (type === 'check') {
      if (toCall > 0) throw new ApiError('bad_action', 'You must call, raise or fold');
      pk.last[seat] = 'Check';
      pk.acted[seat] = true;
    } else if (type === 'call') {
      if (toCall <= 0) {
        pk.last[seat] = 'Check';
      } else {
        commit(st, seat, toCall);
        pk.last[seat] = pk.allin[seat] ? 'All-in' : 'Call';
      }
      pk.acted[seat] = true;
    } else if (type === 'raise') {
      const maxTo = pk.bet[seat] + st.balances[seat];
      let to = Math.floor(Number(msg.to ?? msg.amount));
      if (!Number.isFinite(to)) throw new ApiError('bad_raise', 'Enter an amount');
      if (to >= maxTo) to = maxTo; // all in
      if (to <= pk.cur) {
        // not a raise: it is a call (possibly all in for less)
        return act(st, seat, 'call', msg, now);
      }
      if (pk.noRaise[seat]) throw new ApiError('bad_raise', 'The last raise was too small to reopen betting: call or fold');
      const minTo = pk.cur + pk.minRaise;
      if (to < minTo && to < maxTo) throw new ApiError('bad_raise', `Minimum raise is to ${minTo}`);
      const hadBet = pk.cur > 0;
      const size = to - pk.cur;
      commit(st, seat, to - pk.bet[seat]);
      if (to >= minTo) {
        pk.minRaise = size;
        pk.cur = to;
        for (const i of seatedAll(pk)) if (i !== seat) { pk.acted[i] = false; pk.noRaise[i] = false; }
      } else {
        // short all-in: others must still respond to it, but those who already acted may not re-raise
        pk.cur = to;
        for (const i of seatedAll(pk)) if (i !== seat && pk.acted[i]) pk.noRaise[i] = true;
      }
      pk.acted[seat] = true;
      pk.last[seat] = pk.allin[seat] ? 'All-in' : hadBet ? 'Raise' : 'Bet';
    } else throw new ApiError('bad_action', 'Unknown poker action');
    afterAction(st, seat, now);
  }

  function afterAction(st, seat, now) {
    const pk = st.pk;
    pk.to = live(pk).length <= 1 ? -1 : nextToAct(st, seat);
    nextStep(st, now);
  }

  /* ---------- finishing a hand ---------- */
  function awardUncontested(st, now) {
    const pk = st.pk;
    const winner = live(pk)[0];
    const payouts = arr(0);
    if (winner != null) payouts[winner] = pot(pk);
    finishHand(st, now, payouts, null);
  }

  function showdown(st, now) {
    const pk = st.pk;
    pk.reveal = true;
    const contenders = live(pk);
    const ev = {};
    for (const s of contenders) ev[s] = evaluate([...pk.hole[s], ...pk.board]);
    const payouts = arr(0);
    const pots = buildPots(pk.total, contenders);
    const afterButton = (s) => (s - pk.button + 6) % 6;
    for (const p of pots) {
      if (!p.eligible.length) continue; // an overbet by a seat that folded: returned below
      let top = p.eligible[0];
      for (const s of p.eligible) if (cmp(ev[s].score, ev[top].score) > 0) top = s;
      const winners = p.eligible.filter((s) => cmp(ev[s].score, ev[top].score) === 0).sort((a, b) => afterButton(a) - afterButton(b));
      const share = Math.floor(p.amount / winners.length);
      winners.forEach((s, k) => (payouts[s] += share + (k < p.amount - share * winners.length ? 1 : 0)));
    }
    // any chips that no live seat could claim (a folded player's overbet) go back to their owner
    const paid = payouts.reduce((a, b) => a + b, 0);
    const owed = pot(pk) - paid;
    if (owed > 0) {
      const top = [...pk.total.keys()].sort((a, b) => pk.total[b] - pk.total[a])[0];
      payouts[top] += owed;
    }
    finishHand(st, now, payouts, ev);
  }

  function finishHand(st, now, payouts, ev) {
    const pk = st.pk;
    st.turn = null;
    pk.to = -1;
    const seats = seatedAll(pk);
    const res = arr(null);
    const nets = arr(0);
    for (const s of seats) {
      st.balances[s] += payouts[s];
      nets[s] = payouts[s] - pk.total[s];
    }
    // who actually won chips (for the highlight)
    const best = seats.reduce((m, s) => Math.max(m, nets[s]), 0);
    for (const s of seats) {
      res[s] = { net: nets[s], won: payouts[s] > 0 && nets[s] >= 0 && nets[s] === best && best > 0, hand: ev && ev[s] ? ev[s].name : '', best: ev && ev[s] ? ev[s].cards : null, folded: !!pk.folded[s] };
    }
    pk.res = res;
    const ord = seats.filter((s) => st.alive[s] || pk.total[s] > 0);
    for (const s of ord) {
      if (nets[s] > 0) st.stats.w[s]++;
      else if (nets[s] < 0) st.stats.l[s]++;
      else st.stats.p[s]++;
    }
    const winners = seats.filter((s) => payouts[s] > 0 && nets[s] > 0);
    st.history.push({
      r: st.round,
      t: now,
      poker: true,
      first: st.first,
      board: [...pk.board],
      pot: pot(pk),
      seats: seats.map((s) => ({ seat: s, name: pk.names[s], net: nets[s], hand: res[s].hand, cards: pk.reveal && !pk.folded[s] ? [...pk.hole[s]] : null, folded: !!pk.folded[s] })),
      bal: [...st.balances],
    });
    if (st.history.length > HISTORY_MAX) st.history.shift();
    st.series.push([...st.balances]);
    if (st.series.length > 200) st.series.shift();
    sys(st, `Hand ${st.round}: ${seats.map((s) => `${pk.names[s]} ${fmtNet(nets[s])}`).join(' · ')}`, now, 'round', {
      r: st.round,
      poker: true,
      p: seats.map((s) => ({ s, n: pk.names[s], net: nets[s], bal: st.balances[s], hand: res[s].hand })),
    });
    for (const w of winners.slice(0, 1)) if (res[w].hand) sys(st, `${pk.names[w]} wins ${pot(pk) > 0 ? payouts[w] : 0} with ${res[w].hand}.`, now, 'phand', { n: pk.names[w], hand: res[w].hand, amt: payouts[w] });

    // anyone with no chips left is out
    const out = seats.filter((s) => st.alive[s] && st.balances[s] <= 0).sort((a, b) => a - b);
    for (const s of out) {
      st.alive[s] = false;
      st.elim[s] = st.round;
    }
    const remaining = aliveList(st).length;
    out.forEach((s, idx) => sys(st, `${pk.names[s]} is out of chips.`, now, 'out', { n: pk.names[s], s, place: remaining + 1 + idx, tourney: true }));
    const done = st.settings.maxRounds > 0 && st.round >= st.settings.maxRounds;
    if (remaining <= 1 || done) endMatch(st, remaining <= 1 ? 'broke' : 'rounds');
    st.phase = 'settled';
    st.nextVotes = arr(false);
    // leave time to read the showdown (and to watch the flop, turn and river land)
    setTimerMs(st, now, 'next', interMs(st) + (pk.reveal ? 2500 : 0));
    gameBump(st);
  }

  /* ---------- timers ---------- */
  function fireTimer(st, now, kind) {
    const pk = st.pk;
    if (!pk) return false;
    if (kind === 'action' && st.phase === 'poker' && pk.to >= 0) {
      const seat = pk.to;
      const free = pk.cur - pk.bet[seat] <= 0;
      sys(st, `${pk.names[seat]} ran out of time and ${free ? 'checks' : 'folds'}.`, now, 'timeout', { n: pk.names[seat], poker: free ? 'check' : 'fold' });
      act(st, seat, free ? 'check' : 'fold', {}, now);
      return true;
    }
    if (kind === 'run' && st.phase === 'poker' && pk.runout) {
      pk.runout = false;
      endStreet(st, now);
      return true;
    }
    return false;
  }

  /* ---------- a player leaves a live match ---------- */
  function forfeit(st, seat, reason, now) {
    const pk = st.pk;
    const name = st.seats[seat].name;
    const liveHand = st.phase === 'poker' && pk;
    st.alive[seat] = false;
    st.seats[seat] = null;
    st.ready = arr(false);
    if (liveHand && pk.inHand[seat] && !pk.folded[seat]) {
      pk.folded[seat] = true;
      pk.last[seat] = 'Fold';
    }
    sys(st, reason === 'disconnect' ? `${name} disconnected and forfeits the match.` : `${name} forfeits the match.`, now, reason === 'disconnect' ? 'dc' : 'forfeit', { n: name });
    const remaining = aliveList(st);
    if (remaining.length <= 1) {
      if (liveHand) {
        // the last player standing collects the pot
        const w = remaining[0];
        if (w != null) st.balances[w] += pot(pk);
        pk.total = arr(0);
      }
      st.turn = null;
      clearTimer(st);
      endMatch(st, reason);
      st.phase = 'over';
      const w = st.over.winners.map((s) => st.seats[s] && st.seats[s].name).filter(Boolean);
      if (w.length === 1) sys(st, `${w[0]} wins the match!`, now, 'win', { n: w[0], why: reason });
      else sys(st, 'Match ends in a draw.', now, 'draw', w.length ? { names: w } : null);
      gameBump(st);
      return;
    }
    if (liveHand) {
      if (pk.to === seat) afterAction(st, seat, now);
      else if (live(pk).length <= 1) awardUncontested(st, now);
      else gameBump(st);
      return;
    }
    gameBump(st);
  }

  /* ---------- the view ---------- */
  function view(st, mySeat) {
    const pk = st.pk;
    if (!pk) return null;
    const hole = arr(() => []);
    for (const s of seatedAll(pk)) {
      if (pk.folded[s] && !(pk.reveal && s === mySeat)) hole[s] = [];
      else if (s === mySeat || (pk.reveal && !pk.folded[s])) hole[s] = pk.hole[s];
      else hole[s] = [null, null];
    }
    return {
      button: pk.button,
      sbSeat: pk.sbSeat,
      bbSeat: pk.bbSeat,
      sb: pk.sb,
      bb: pk.bb,
      level: pk.level,
      street: pk.street,
      board: pk.board,
      pot: pot(pk),
      bet: pk.bet,
      total: pk.total,
      inHand: pk.inHand,
      folded: pk.folded,
      allin: pk.allin,
      last: pk.last,
      cur: pk.cur,
      minRaise: pk.minRaise,
      to: pk.to,
      reveal: pk.reveal,
      runout: pk.runout,
      hole,
      res: pk.res,
      legal: mySeat >= 0 ? legal(st, mySeat) : null,
    };
  }

  return { startHand, act, legal, fireTimer, forfeit, view, blinds, levelOf };
};

module.exports.evaluate = evaluate;
module.exports.buildPots = buildPots;
module.exports.score5 = score5;
module.exports.cmp = cmp;
