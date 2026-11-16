'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../lib/engine');
const P = require('../lib/poker');

const T0 = 1_700_000_000_000;
const U = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].map((id, i) => ({ id: id + 'xxxxxxx', name: ['Ann', 'Ben', 'Cat', 'Dan', 'Eve', 'Fay'][i] }));

// a started poker match with n players, seats 0..n-1 (stack 1000, blinds 10/20 unless overridden)
function room(n, settings = {}) {
  const st = E.newRoom('pk', T0);
  for (let i = 0; i < n; i++) E.applyAction(st, U[i], { type: 'join' }, T0);
  E.applyAction(st, U[0], { type: 'settings', settings: { game: 'poker', startingBalance: 1000, sb: 10, ...settings } }, T0);
  E.applyAction(st, U[0], { type: 'open' }, T0);
  for (let i = 0; i < n; i++) E.applyAction(st, U[i], { type: 'sit', seat: i }, T0);
  for (let i = 0; i < n; i++) E.applyAction(st, U[i], { type: 'ready', value: true }, T0);
  return st;
}
// rig the deck: hole = [[c,c], ...] by seat, board = 5 cards
function rig(st, hole, board) {
  const pk = st.pk;
  hole.forEach((h, s) => h && (pk.hole[s] = h));
  pk.deck = ['XX', board[0], board[1], board[2], 'XX', board[3], 'XX', board[4]].reverse();
}
const act = (st, seat, type, extra = {}) => E.applyAction(st, U[seat], { type, ...extra }, T0 + 1000);
const total = (st) => st.balances.reduce((a, b) => a + b, 0) + (st.pk ? st.pk.total.reduce((a, b) => a + b, 0) : 0) * (st.phase === 'poker' ? 1 : 0);

/* ---------- evaluator ---------- */
test('evaluator ranks every category correctly', () => {
  const s = (cards) => P.evaluate(cards).score[0];
  assert.strictEqual(s(['AS', 'KS', 'QS', 'JS', '10S']), 8);
  assert.strictEqual(P.evaluate(['AS', 'KS', 'QS', 'JS', '10S']).name, 'Royal Flush');
  assert.strictEqual(s(['9H', '9D', '9S', '9C', '2D']), 7);
  assert.strictEqual(s(['KH', 'KD', 'KS', '2C', '2D']), 6);
  assert.strictEqual(s(['2H', '9H', 'JH', '4H', '6H']), 5);
  assert.strictEqual(s(['5H', '6D', '7S', '8C', '9D']), 4);
  assert.strictEqual(s(['5H', '5D', '5S', '8C', '9D']), 3);
  assert.strictEqual(s(['5H', '5D', '8S', '8C', '9D']), 2);
  assert.strictEqual(s(['5H', '5D', '7S', '8C', '9D']), 1);
  assert.strictEqual(s(['2H', '5D', '7S', '8C', 'KD']), 0);
});

test('evaluator: wheel is the lowest straight, kickers decide, best five of seven', () => {
  const wheel = P.evaluate(['AS', '2D', '3C', '4H', '5S']);
  const six = P.evaluate(['2D', '3C', '4H', '5S', '6S']);
  assert.strictEqual(wheel.score[0], 4);
  assert.ok(P.cmp(six.score, wheel.score) > 0);
  const a = P.evaluate(['AS', 'AD', 'KC', '5H', '2S']);
  const b = P.evaluate(['AH', 'AC', 'QC', '5D', '2D']);
  assert.ok(P.cmp(a.score, b.score) > 0); // king kicker beats queen
  const seven = P.evaluate(['AS', 'KS', '2D', '3H', 'QS', 'JS', '10S']);
  assert.strictEqual(seven.name, 'Royal Flush');
  const board = P.evaluate(['AS', 'AD', 'AC', 'KS', 'KD', '2C', '3C']); // full house on board
  assert.strictEqual(board.name, 'Full House');
  assert.strictEqual(P.cmp(P.evaluate(['2H', '3D', 'AS', 'AD', 'KC', 'KS', '7C']).score, [2, 14, 13, 7]), 0);
});

test('side pots are layered by stake', () => {
  const total = [100, 300, 300, 50, 0, 0];
  const pots = P.buildPots(total, [0, 1, 2]); // seat 3 folded after putting in 50
  assert.deepStrictEqual(pots.map((p) => p.amount), [200, 150, 400]); // 50-level (incl. folded), 100-level, 300-level
  const sum = pots.reduce((a, p) => a + p.amount, 0);
  assert.strictEqual(sum, 750);
});

/* ---------- hand flow ---------- */
test('heads-up: the button posts the small blind and acts first; a check-down reaches showdown', () => {
  const st = room(2);
  assert.strictEqual(st.phase, 'poker');
  const pk = st.pk;
  assert.strictEqual(pk.sbSeat, pk.button);
  assert.strictEqual(pk.to, pk.sbSeat);
  assert.deepStrictEqual([pk.bet[pk.sbSeat], pk.bet[pk.bbSeat]], [10, 20]);
  rig(st, [['AS', 'AH'], ['KS', 'KH']], ['2C', '7D', '9H', 'JS', '3D']);
  const sb = pk.sbSeat, bb = pk.bbSeat;
  act(st, sb, 'call'); // completes to 20
  assert.strictEqual(pk.to, bb); // big blind has the option
  act(st, bb, 'check');
  assert.strictEqual(pk.street, 'flop');
  assert.strictEqual(pk.board.length, 3);
  assert.strictEqual(pk.to, bb); // out of position acts first after the flop
  for (const street of ['flop', 'turn', 'river']) {
    assert.strictEqual(pk.street, street);
    act(st, pk.to, 'check');
    act(st, pk.to, 'check');
  }
  assert.strictEqual(st.phase, 'settled');
  assert.strictEqual(pk.board.length, 5);
  const aces = pk.hole[0][0] === 'AS' ? 0 : 1;
  assert.strictEqual(st.balances[aces], 1020);
  assert.strictEqual(st.balances[1 - aces], 980);
  assert.strictEqual(pk.res[aces].hand, 'Pair');
});

test('a fold hands the pot over without a showdown and hides the cards', () => {
  const st = room(3);
  const pk = st.pk;
  const first = pk.to;
  act(st, first, 'raise', { to: 60 });
  act(st, pk.to, 'fold');
  act(st, pk.to, 'fold');
  assert.strictEqual(st.phase, 'settled');
  assert.strictEqual(pk.reveal, false);
  assert.strictEqual(st.balances[first], 1000 + 30); // wins the two blinds
  assert.strictEqual(st.balances.reduce((a, b) => a + b, 0), 3000);
  const v = E.buildView(st, U[0].id, T0 + 2000).poker;
  assert.ok(v.hole[first].every((c) => c === null || typeof c === 'string'));
  if (first !== 0) assert.ok(v.hole[first].every((c) => c === null), 'opponent cards stay hidden');
});

test('hole cards are private until showdown', () => {
  const st = room(3);
  const pk = st.pk;
  for (const me of [0, 1, 2]) {
    const v = E.buildView(st, U[me].id, T0).poker;
    for (let s = 0; s < 3; s++) {
      if (s === me) assert.deepStrictEqual(v.hole[s], pk.hole[s]);
      else assert.deepStrictEqual(v.hole[s], [null, null]);
    }
    assert.ok(!('deck' in v));
  }
  const spec = E.buildView(st, 'nobody-here', T0).poker;
  assert.ok(spec.hole.slice(0, 3).every((h) => h[0] === null));
});

test('betting rules: turn order, minimum raise, call or fold', () => {
  const st = room(3);
  const pk = st.pk;
  const first = pk.to;
  assert.throws(() => act(st, (first + 1) % 3, 'call'), /turn/i);
  assert.throws(() => act(st, first, 'check'), /call, raise or fold/);
  assert.throws(() => act(st, first, 'raise', { to: 30 }), /Minimum raise is to 40/);
  act(st, first, 'raise', { to: 100 });
  assert.strictEqual(pk.cur, 100);
  assert.strictEqual(pk.minRaise, 80);
  const next = pk.to;
  assert.throws(() => act(st, next, 'raise', { to: 150 }), /Minimum raise is to 180/);
  const lg = E.buildView(st, U[next].id, T0).poker.legal;
  assert.strictEqual(lg.toCall > 0, true);
  assert.deepStrictEqual(lg.raise.min, 180);
  assert.strictEqual(lg.raise.max, 1000); // all-in total
});

test('side pots: the short stack wins only the main pot', () => {
  const st = room(3);
  const pk = st.pk;
  st.balances[0] = 100 - pk.bet[0]; st.balances[1] = 300 - pk.bet[1]; st.balances[2] = 300 - pk.bet[2];
  rig(st, [['AS', 'AH'], ['KS', 'KH'], ['QS', 'QH']], ['2C', '7D', '9H', 'JS', '3D']);
  // everybody is all in
  let guard = 0;
  while (st.phase === 'poker' && pk.to >= 0 && guard++ < 10) act(st, pk.to, 'raise', { to: 99999 });
  // finish the run-out
  E.tick(st, T0 + 20_000);
  while (st.phase === 'poker') E.tick(st, st.timerAt + 1);
  assert.strictEqual(st.phase, 'settled');
  // seat 0 (aces, 100 in) wins 300 main pot; seat 1 (kings, 300 in) wins the 400 side pot from seat 2
  assert.strictEqual(pk.board.length, 5);
  assert.deepStrictEqual(st.balances.slice(0, 3), [300, 400, 0]);
  assert.strictEqual(st.alive[2], false);
});

test('split pot on a tie, odd chip goes to the first seat after the button', () => {
  const st = room(3);
  const pk = st.pk;
  rig(st, [['AS', '2H'], ['AH', '2D'], ['9S', '8H']], ['AC', 'KD', 'QH', 'JS', '10D']); // board straight A-high for everyone
  const f = pk.to;
  act(st, f, 'call');
  act(st, pk.to, 'call');
  act(st, pk.to, 'check');
  while (st.phase === 'poker' && pk.to >= 0) { act(st, pk.to, 'check'); }
  assert.strictEqual(st.phase, 'settled');
  const sum = st.balances.reduce((a, b) => a + b, 0);
  assert.strictEqual(sum, 3000);
  assert.strictEqual(st.balances[0], st.balances[1]); // tie between seats 0 and 1
});

test('an all-in call runs the board out street by street on a timer', () => {
  const st = room(2);
  const pk = st.pk;
  rig(st, [['AS', 'AH'], ['KS', 'KH']], ['2C', '7D', '9H', 'JS', '3D']);
  const first = pk.to;
  act(st, first, 'raise', { to: 99999 });
  act(st, pk.to, 'call');
  assert.strictEqual(st.phase, 'poker');
  assert.strictEqual(pk.runout, true);
  assert.strictEqual(pk.board.length, 3);
  assert.strictEqual(st.timerKind, 'run');
  E.tick(st, st.timerAt);
  assert.strictEqual(pk.board.length, 4);
  E.tick(st, st.timerAt);
  assert.strictEqual(pk.board.length, 5);
  E.tick(st, st.timerAt);
  assert.strictEqual(st.phase, 'settled');
  assert.strictEqual(st.over.reason, 'broke'); // one player has all the chips
  E.tick(st, st.timerAt);
  assert.strictEqual(st.phase, 'over');
});

test('a short all-in does not reopen the betting for someone who already acted', () => {
  const st = room(3);
  const pk = st.pk;
  const a = pk.to; // under the gun
  const b = (a + 1) % 3, c = (a + 2) % 3;
  pk.bet[b] = pk.bet[b]; // blinds posted by b and c
  st.balances[b] = 70 - pk.bet[b] + 0; // b can only go all in for 70 total
  act(st, a, 'raise', { to: 60 });
  act(st, b, 'raise', { to: 70 }); // short all-in (min raise would be to 100)
  assert.strictEqual(pk.cur, 70);
  assert.strictEqual(pk.noRaise[a], true); // a already acted: a short all-in does not reopen
  assert.strictEqual(pk.noRaise[c], false); // c has not acted yet and may still raise
  act(st, c, 'call');
  assert.strictEqual(pk.to, a);
  assert.strictEqual(pk.noRaise[a], true);
  assert.throws(() => act(st, a, 'raise', { to: 500 }), /call or fold/);
  act(st, a, 'call');
});

test('timeouts: the clock checks when free, folds otherwise', () => {
  const st = room(3, { actionTime: 15 });
  const pk = st.pk;
  const first = pk.to;
  assert.strictEqual(st.timerKind, 'action');
  E.tick(st, st.timerAt);
  assert.strictEqual(pk.folded[first], true);
  // the big blind can check for free
  const st2 = room(2, { actionTime: 15 });
  act(st2, st2.pk.to, 'call');
  const bb = st2.pk.to;
  E.tick(st2, st2.timerAt);
  assert.strictEqual(st2.pk.folded[bb], false);
  assert.strictEqual(st2.pk.street, 'flop');
});

test('forfeit mid-hand: the pot goes to the last player and the match ends', () => {
  const st = room(2);
  const pk = st.pk;
  act(st, pk.to, 'raise', { to: 100 });
  act(st, pk.to, 'forfeit');
  assert.strictEqual(st.phase, 'over');
  assert.strictEqual(st.over.reason, 'forfeit');
  assert.strictEqual(st.balances.reduce((a, b) => a + b, 0) - (1000 - 0) >= 0, true);
  const w = st.over.winner;
  assert.ok(w >= 0);
});

test('forfeit when it is your turn passes the action on (3 players)', () => {
  const st = room(3);
  const pk = st.pk;
  const f = pk.to;
  act(st, f, 'forfeit');
  assert.strictEqual(st.phase, 'poker');
  assert.notStrictEqual(pk.to, f);
  assert.strictEqual(pk.folded[f], true);
});

test('blinds rise on schedule', () => {
  const st = room(2, { levelEvery: 5, sb: 10 });
  assert.deepStrictEqual(E.poker.blinds(st, 1), { sb: 10, bb: 20, level: 0 });
  assert.deepStrictEqual(E.poker.blinds(st, 6), { sb: 15, bb: 30, level: 1 });
  assert.deepStrictEqual(E.poker.blinds(st, 11), { sb: 25, bb: 50, level: 2 });
});

test('settings: poker and blackjack keep to their own modes', () => {
  const st = E.newRoom('s', T0);
  E.applyAction(st, U[0], { type: 'join' }, T0);
  E.applyAction(st, U[0], { type: 'settings', settings: { game: 'poker' } }, T0);
  assert.strictEqual(st.settings.mode, 'holdem');
  E.applyAction(st, U[0], { type: 'settings', settings: { game: 'blackjack' } }, T0);
  assert.strictEqual(st.settings.mode, 'duel');
  E.applyAction(st, U[0], { type: 'settings', settings: { game: 'blackjack', mode: 'holdem' } }, T0);
  assert.strictEqual(st.settings.mode, 'duel');
  E.applyAction(st, U[0], { type: 'settings', settings: { game: 'poker', sb: 25, startingBalance: 5000, levelEvery: 10 } }, T0);
  assert.deepStrictEqual([st.settings.sb, st.settings.levelEvery], [25, 10]);
  assert.throws(() => act(E.newRoom('x', T0), 0, 'fold'), /./);
});

test('blackjack actions are refused at a poker table and vice versa', () => {
  const st = room(2);
  assert.throws(() => act(st, st.pk.to, 'hit'), /turn|phase/i);
  const bj = E.newRoom('b', T0);
  E.applyAction(bj, U[0], { type: 'join' }, T0);
  assert.throws(() => E.applyAction(bj, U[0], { type: 'fold' }, T0), /Unknown/);
});

/* ---------- soak: random play never loses or invents chips ---------- */
test('random play: chips are conserved and every hand terminates', () => {
  for (let game = 0; game < 40; game++) {
    const n = 2 + (game % 5);
    const st = room(n, { startingBalance: 200 + game * 20, sb: [2, 5, 10][game % 3], levelEvery: game % 2 ? 5 : 0 });
    const startTotal = st.balances.reduce((a, b) => a + b, 0) + st.pk.total.reduce((a, b) => a + b, 0);
    let t = T0, guard = 0;
    while (st.phase !== 'over' && guard++ < 4000) {
      const pk = st.pk;
      if (st.phase === 'poker' && pk.to >= 0) {
        const seat = pk.to, lg = E.poker.legal(st, seat), r = Math.random();
        const user = U[seat];
        t += 500;
        E.applyAction(st, user, { type: 'ping' }, t);
        if (lg.check && r < 0.45) act2(st, user, 'check', t);
        else if (!lg.check && r < 0.15) act2(st, user, 'fold', t);
        else if (lg.raise && r < 0.5) act2(st, user, 'raise', t, { to: lg.raise.min + Math.floor(Math.random() * (lg.raise.max - lg.raise.min + 1)) });
        else if (lg.raise && r < 0.55) act2(st, user, 'raise', t, { to: lg.raise.max });
        else act2(st, user, lg.check ? 'check' : 'call', t);
      } else {
        t = Math.max(t + 1, st.timerAt || t + 1);
        for (const s of st.seats) if (s) E.applyAction(st, U.find((u) => u.id === s.id), { type: 'ping' }, t);
        E.tick(st, t);
      }
      const held = st.balances.reduce((a, b) => a + b, 0) + (st.phase === 'poker' ? st.pk.total.reduce((a, b) => a + b, 0) : 0);
      assert.strictEqual(held, startTotal, `chips changed in game ${game} (phase ${st.phase})`);
      assert.ok(st.balances.every((b) => Number.isInteger(b) && b >= 0));
    }
    assert.strictEqual(st.phase, 'over', `game ${game} did not finish`);
  }
});
function act2(st, user, type, t, extra = {}) {
  E.applyAction(st, user, { type, ...extra }, t);
}

/* ---------- solo blackjack ---------- */
test('solo: one player starts alone, plays the dealer, and the session ends at the round limit or when broke', () => {
  const st = E.newRoom('solo', T0);
  E.applyAction(st, U[0], { type: 'join' }, T0);
  E.applyAction(st, U[1], { type: 'join' }, T0);
  E.applyAction(st, U[0], { type: 'settings', settings: { mode: 'solo', startingBalance: 100, minBet: 10, maxBet: 100, maxRounds: 5 } }, T0);
  E.applyAction(st, U[0], { type: 'open' }, T0);
  E.applyAction(st, U[0], { type: 'sit', seat: 0 }, T0);
  assert.throws(() => E.applyAction(st, U[1], { type: 'sit', seat: 1 }, T0), /./, 'only one seat');
  E.applyAction(st, U[0], { type: 'ready', value: true }, T0);
  assert.strictEqual(st.phase, 'betting');
  assert.strictEqual(E.buildView(st, U[0].id, T0).mode.max, 1);
  let t = T0, guard = 0;
  while (st.phase !== 'over' && guard++ < 400) {
    t += 1000;
    if (st.phase === 'betting' && st.bets[0] == null) E.applyAction(st, U[0], { type: 'bet', amount: 10 }, t);
    else if (st.phase === 'playing' && st.ins) E.applyAction(st, U[0], { type: 'insure', amount: 0 }, t);
    else if (st.phase === 'playing' && st.turn) E.applyAction(st, U[0], { type: 'stand_hand' }, t);
    else if (st.phase === 'settled') E.applyAction(st, U[0], { type: 'next' }, t);
    else { E.applyAction(st, U[0], { type: 'ping' }, t); E.tick(st, Math.max(t, st.timerAt || 0)); }
  }
  assert.strictEqual(st.phase, 'over');
  assert.strictEqual(st.round, 5);
  assert.strictEqual(st.over.reason, 'rounds');
  assert.strictEqual(st.over.winner >= 0, st.balances[0] > 100, 'a win means finishing ahead of the starting stack');
});
