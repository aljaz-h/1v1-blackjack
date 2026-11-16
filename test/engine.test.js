'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../lib/engine');

const A = { id: 'a1', name: 'Alice' };
const B = { id: 'b1', name: 'Bob' };
const now0 = 1_000_000;
// helper: a room whose host has already opened the table (the host is whoever acts first)
const newRoom = (name, now) => { const st = E.newRoom(name, now); st.open = true; return st; };

function table(settings = {}) {
  const st = newRoom('t', now0);
  E.applyAction(st, A, { type: 'join' }, now0);
  E.applyAction(st, B, { type: 'join' }, now0);
  E.applyAction(st, A, { type: 'sit', seat: 0 }, now0);
  E.applyAction(st, B, { type: 'sit', seat: 1 }, now0);
  if (Object.keys(settings).length) E.applyAction(st, A, { type: 'settings', settings }, now0);
  E.applyAction(st, A, { type: 'ready', value: true }, now0);
  E.applyAction(st, B, { type: 'ready', value: true }, now0);
  return st;
}
// stack the shoe: cards listed in draw order
const rig = (st, cards) => { st.shoe = [...cards].reverse(); };

test('hand totals', () => {
  assert.deepStrictEqual(E.handTotal(['AS', 'KH']), { total: 21, soft: true });
  assert.deepStrictEqual(E.handTotal(['AS', 'AH', '9C']), { total: 21, soft: true });
  assert.deepStrictEqual(E.handTotal(['AS', '6H', '9C']), { total: 16, soft: false });
  assert.deepStrictEqual(E.handTotal(['10S', 'KH', '5C']), { total: 25, soft: false });
});

test('match starts when both ready; settings validated', () => {
  const st = table({ startingBalance: 2000, minBet: 50, maxBet: 10, decks: 3 });
  assert.strictEqual(st.phase, 'betting');
  assert.strictEqual(st.balances[0], 2000);
  assert.ok(st.settings.maxBet >= st.settings.minBet);
  assert.strictEqual(st.settings.decks, 6); // 3 is invalid -> default kept
});

test('only the host changes settings, only in lobby', () => {
  const st = newRoom('t', now0);
  const C = { id: 'c1', name: 'Cara' };
  E.applyAction(st, A, { type: 'join' }, now0);
  E.applyAction(st, C, { type: 'join' }, now0);
  assert.strictEqual(st.host, A.id, 'first to join is the host');
  assert.throws(() => E.applyAction(st, C, { type: 'settings', settings: {} }, now0), /Only the host/);
  E.applyAction(st, A, { type: 'settings', settings: { minBet: 20 } }, now0);
  assert.strictEqual(st.settings.minBet, 20);
});

test('table must be opened by the host before anyone can sit; host leaves -> next active user inherits', () => {
  const st = E.newRoom('h', now0);
  E.applyAction(st, A, { type: 'join' }, now0);
  E.applyAction(st, B, { type: 'join' }, now0);
  assert.throws(() => E.applyAction(st, A, { type: 'sit', seat: 0 }, now0), /setting up/);
  assert.throws(() => E.applyAction(st, B, { type: 'open' }, now0), /Only the host/);
  E.applyAction(st, A, { type: 'settings', settings: { mode: 'classic' } }, now0);
  E.applyAction(st, A, { type: 'open' }, now0);
  assert.strictEqual(E.buildView(st, B.id, now0).open, true);
  E.applyAction(st, B, { type: 'sit', seat: 3 }, now0);
  assert.strictEqual(st.seats[3].id, B.id, 'any seat of the mode can be picked');
  // host unseen for > 2 min: Bob's next action makes him host
  E.applyAction(st, B, { type: 'ping' }, now0 + 3 * 60_000);
  assert.strictEqual(st.host, B.id);
  assert.strictEqual(E.buildView(st, B.id, now0 + 3 * 60_000).you.host, true);
});

test('bet validation and deal order', () => {
  const st = table();
  rig(st, ['5S', '6S', '9H', '7S', '8S', '9D']); // first(0)=A, then B, dealer, A, B, dealer
  assert.throws(() => E.applyAction(st, A, { type: 'bet', amount: 5 }, now0), /Bet must/);
  assert.throws(() => E.applyAction(st, A, { type: 'bet', amount: 5000 }, now0), /Bet must/);
  E.applyAction(st, A, { type: 'bet', amount: 100 }, now0);
  assert.throws(() => E.applyAction(st, A, { type: 'bet', amount: 100 }, now0), /already/);
  E.applyAction(st, B, { type: 'bet', amount: 50 }, now0);
  assert.strictEqual(st.phase, 'playing');
  assert.deepStrictEqual(st.hands[0][0].cards, ['5S', '7S']);
  assert.deepStrictEqual(st.hands[1][0].cards, ['6S', '8S']);
  assert.deepStrictEqual(st.dealer.cards, ['9H', '9D']);
  assert.deepStrictEqual(st.turn, { seat: 0, hand: 0 });
  assert.strictEqual(st.balances[0], 900);
});

test('hole card is hidden in the view until dealer phase', () => {
  const st = table();
  rig(st, ['5S', '6S', '9H', '7S', '8S', '4D']);
  E.applyAction(st, A, { type: 'bet', amount: 10 }, now0);
  E.applyAction(st, B, { type: 'bet', amount: 10 }, now0);
  const v = E.buildView(st, 'b1', now0);
  assert.strictEqual(v.dealer.cards[1], null);
  assert.strictEqual(v.dealer.cards[0], '9H');
  assert.ok(!JSON.stringify(v).includes('4D'));
});

test('full round: stand, bust, dealer draw, payouts', () => {
  const st = table();
  // A: 10+10=20, B: 10+6=16, dealer: 10+6 -> draws 5 -> 21
  rig(st, ['10S', '10H', 'KS', 'KD', '6H', '6D', 'JC', '5C', '9S']);
  // order: A c1=10S, B c1=10H, D c1=KS, A c2=KD, B c2=6H, D c2=6D ; then draws JC.. B hits
  E.applyAction(st, A, { type: 'bet', amount: 100 }, now0);
  E.applyAction(st, B, { type: 'bet', amount: 100 }, now0);
  E.applyAction(st, A, { type: 'stand_hand', seq: st.seq }, now0);
  E.applyAction(st, B, { type: 'hit', seq: st.seq }, now0); // JC -> bust (26)
  assert.strictEqual(st.phase, 'dealer');
  assert.deepStrictEqual(st.dealer.cards, ['KS', '6D', '5C']); // 16 -> hits 5C -> 21
  E.tick(st, st.timerAt);
  assert.strictEqual(st.phase, 'settled');
  assert.strictEqual(st.balances[0], 900); // 20 < 21 lose
  assert.strictEqual(st.balances[1], 900); // bust
  assert.strictEqual(st.results[1][0].out, 'bust');
});

test('blackjack pays 3:2 and 6:5, floors fractions', () => {
  for (const [payout, expect] of [[1.5, 1000 + 150], [1.2, 1000 + 120]]) {
    const st = table({ payout });
    rig(st, ['AS', '9H', '9S', 'KD', '9C', '8D']);
    E.applyAction(st, A, { type: 'bet', amount: 100 }, now0);
    E.applyAction(st, B, { type: 'bet', amount: 100 }, now0);
    assert.ok(st.hands[0][0].bj);
    E.applyAction(st, B, { type: 'stand_hand', seq: st.seq }, now0);
    E.tick(st, st.timerAt);
    assert.strictEqual(st.balances[0], expect);
  }
});

test('dealer peek blackjack ends round, naturals push', () => {
  const st = table();
  rig(st, ['AS', '9H', 'AD', 'KD', '9C', 'KS']);
  E.applyAction(st, A, { type: 'bet', amount: 100 }, now0);
  E.applyAction(st, B, { type: 'bet', amount: 100 }, now0);
  assert.strictEqual(st.phase, 'dealer');
  E.tick(st, st.timerAt);
  assert.strictEqual(st.balances[0], 1000); // push
  assert.strictEqual(st.balances[1], 900); // lost
});

test('double and split', () => {
  const st = table();
  // A: 8S 8D (split), B: 5H 6H; dealer 10 7
  rig(st, ['8S', '5H', 'KS', '8D', '6H', '7D', '3C', 'JC', '4C', '9C']);
  E.applyAction(st, A, { type: 'bet', amount: 100 }, now0);
  E.applyAction(st, B, { type: 'bet', amount: 100 }, now0);
  assert.ok(E.legal(st, 0).split);
  E.applyAction(st, A, { type: 'split', seq: st.seq }, now0);
  assert.strictEqual(st.hands[0].length, 2);
  assert.strictEqual(st.balances[0], 800);
  assert.deepStrictEqual(st.hands[0][0].cards, ['8S', '3C']);
  assert.deepStrictEqual(st.hands[0][1].cards, ['8D', 'JC']);
  E.applyAction(st, A, { type: 'double', seq: st.seq }, now0); // 11 -> 4C = 15, doubled
  assert.strictEqual(st.balances[0], 700);
  assert.deepStrictEqual(st.turn, { seat: 0, hand: 1 });
  E.applyAction(st, A, { type: 'stand_hand', seq: st.seq }, now0); // 18
  assert.deepStrictEqual(st.turn, { seat: 1, hand: 0 });
  assert.throws(() => E.applyAction(st, A, { type: 'hit', seq: st.seq }, now0), /Not your turn/);
  E.applyAction(st, B, { type: 'double', seq: st.seq }, now0); // 11 + 9C = 20
  E.tick(st, st.timerAt);
  // dealer 17: A hand0 15 lose(-200), hand1 18 win(+100) ; B 20 win(+200)
  assert.strictEqual(st.balances[0], 700 + 0 + 200);
  assert.strictEqual(st.balances[1], 1000 - 200 + 400);
});

test('stale seq is rejected', () => {
  const st = table();
  rig(st, ['2S', '3S', '4H', '2D', '3D', '5D', '2C', '2H']);
  E.applyAction(st, A, { type: 'bet', amount: 10 }, now0);
  E.applyAction(st, B, { type: 'bet', amount: 10 }, now0);
  const old = st.seq;
  E.applyAction(st, A, { type: 'hit', seq: old }, now0);
  assert.throws(() => E.applyAction(st, A, { type: 'hit', seq: old }, now0), /Stale/);
});

test('timers: auto bet, auto stand, dealer settle, next round', () => {
  const st = table({ betTime: 15, actionTime: 15 });
  let t = now0;
  E.applyAction(st, A, { type: 'bet', amount: 20 }, t);
  t = st.timerAt;
  E.tick(st, t); // B auto-bets min
  assert.strictEqual(st.bets[1], 10);
  assert.ok(['playing', 'dealer'].includes(st.phase));
  let guard = 0;
  while (st.phase === 'playing' && guard++ < 20) { t = st.timerAt; E.tick(st, t); }
  assert.strictEqual(st.phase, 'dealer');
  t = st.timerAt; E.tick(st, t);
  assert.strictEqual(st.phase, 'settled');
  t = st.timerAt; E.tick(st, t);
  assert.strictEqual(st.phase, 'betting');
  assert.strictEqual(st.round, 2);
  assert.strictEqual(st.first, 1); // alternates
});

test('match ends when a player is broke; rematch flow', () => {
  const st = table({ startingBalance: 100, minBet: 50, maxBet: 100 });
  rig(st, ['10S', '10H', 'KS', '9D', '9H', 'KD']);
  E.applyAction(st, A, { type: 'bet', amount: 100 }, now0);
  E.applyAction(st, B, { type: 'bet', amount: 100 }, now0);
  E.applyAction(st, A, { type: 'stand_hand', seq: st.seq }, now0);
  E.applyAction(st, B, { type: 'stand_hand', seq: st.seq }, now0);
  E.tick(st, st.timerAt); // dealer 20: A 19 lose, B 19 lose -> both broke
  assert.ok(st.over);
  E.tick(st, st.timerAt);
  assert.strictEqual(st.phase, 'over');
  E.applyAction(st, A, { type: 'lobby' }, now0);
  assert.strictEqual(st.phase, 'lobby');
  assert.ok(st.seats[0] && st.seats[1]);
});

test('forfeit refunds the opponent and frees the seat', () => {
  const st = table();
  E.applyAction(st, A, { type: 'bet', amount: 100 }, now0);
  E.applyAction(st, A, { type: 'forfeit' }, now0);
  assert.strictEqual(st.phase, 'over');
  assert.strictEqual(st.over.winner, 1);
  assert.strictEqual(st.seats[0], null);
});

test('disconnect forfeits a live match', () => {
  const st = table();
  E.applyAction(st, B, { type: 'ping' }, now0 + 100_000);
  E.tick(st, now0 + 100_000); // A silent for > 75s
  assert.strictEqual(st.phase, 'over');
  assert.strictEqual(st.over.reason, 'disconnect');
  assert.strictEqual(st.over.winner, 1);
});

test('spectators cannot act; seats can be claimed after forfeit', () => {
  const st = table();
  const C = { id: 'c1', name: 'Cara' };
  E.applyAction(st, C, { type: 'join' }, now0);
  assert.throws(() => E.applyAction(st, C, { type: 'sit', seat: 0 }, now0), /in progress/);
  assert.throws(() => E.applyAction(st, C, { type: 'bet', amount: 10 }, now0), /not seated/);
  E.applyAction(st, A, { type: 'forfeit' }, now0);
  E.applyAction(st, C, { type: 'sit', seat: 0 }, now0);
  assert.strictEqual(st.seats[0].name, 'Cara');
});

test('name clash and chat limits', () => {
  const st = newRoom('t', now0);
  E.applyAction(st, A, { type: 'join' }, now0);
  assert.throws(() => E.applyAction(st, { id: 'zz', name: 'alice' }, { type: 'join' }, now0), /already/);
  E.applyAction(st, A, { type: 'chat', text: 'x'.repeat(500) }, now0);
  assert.strictEqual(st.chat.at(-1).x.length, 240);
  assert.throws(() => E.applyAction(st, A, { type: 'chat', text: 'hi' }, now0 + 10), /Slow/);
});

test('simulated 300 random rounds keep invariants', () => {
  const st = table({ startingBalance: 1_000_000, minBet: 10, maxBet: 1000, betTime: 0, actionTime: 0 });
  let t = now0;
  for (let i = 0; i < 300; i++) {
    E.applyAction(st, A, { type: 'bet', amount: 10 + (i % 50) }, t);
    E.applyAction(st, B, { type: 'bet', amount: 10 }, t);
    let g = 0;
    while (st.phase === 'playing' && g++ < 60) {
      const s = st.turn.seat; const u = s === 0 ? A : B;
      const l = E.legal(st, s);
      const total = E.handTotal(st.hands[s][st.turn.hand].cards).total;
      const type = l.split && i % 3 === 0 ? 'split' : l.double && total >= 9 && total <= 11 ? 'double' : total < 15 ? 'hit' : 'stand_hand';
      E.applyAction(st, u, { type, seq: st.seq }, t);
    }
    assert.strictEqual(st.phase, 'dealer');
    t = st.timerAt; E.tick(st, t);
    assert.strictEqual(st.phase, 'settled');
    for (const s of [0, 1]) assert.ok(Number.isInteger(st.balances[s]) && st.balances[s] >= 0);
    E.applyAction(st, A, { type: 'next' }, t); E.applyAction(st, B, { type: 'next' }, t);
    assert.strictEqual(st.phase, 'betting');
  }
});

test('system events carry a kind and data for rich rendering', () => {
  const st = table();
  rig(st, ['10S', '10H', 'KS', '9D', '9H', '8D']);
  E.applyAction(st, A, { type: 'bet', amount: 100 }, now0);
  E.applyAction(st, B, { type: 'bet', amount: 100 }, now0);
  E.applyAction(st, A, { type: 'stand_hand', seq: st.seq }, now0);
  E.applyAction(st, B, { type: 'stand_hand', seq: st.seq }, now0);
  E.tick(st, st.timerAt);
  const kinds = st.chat.filter((m) => m.s).map((m) => m.k);
  assert.ok(['join', 'seat', 'start', 'round'].every((k) => kinds.includes(k)), kinds.join());
  const round = st.chat.find((m) => m.k === 'round');
  assert.strictEqual(round.d.r, 1);
  assert.strictEqual(round.d.p[0].n, 'Alice');
  assert.strictEqual(typeof round.d.p[1].net, 'number');
  assert.ok(round.x.startsWith('Round 1:'));
});

test('avatar profiles: validation, view data and same-color fallback', () => {
  const st = newRoom('p', now0);
  for (const u of [A, B]) E.applyAction(st, u, { type: 'join' }, now0);
  E.applyAction(st, A, { type: 'sit', seat: 0 }, now0);
  E.applyAction(st, B, { type: 'sit', seat: 1 }, now0);
  E.applyAction(st, A, { type: 'profile', color: '#FF0000', icon: 'crown' }, now0);
  assert.throws(() => E.applyAction(st, A, { type: 'profile', color: 'red' }, now0), /color/i);
  assert.throws(() => E.applyAction(st, A, { type: 'profile', icon: '<img>' }, now0), /icon/i);
  assert.throws(() => E.applyAction(st, A, { type: 'profile', icon: 'lorelei:16' }, now0), /icon/i);
  assert.throws(() => E.applyAction(st, A, { type: 'profile', icon: '../x:1' }, now0), /icon/i);
  E.applyAction(st, B, { type: 'profile', color: null, icon: 'bottts:7' }, now0);
  assert.strictEqual(E.buildView(st, A.id, now0).seats[1].icon, 'bottts:7');
  E.applyAction(st, B, { type: 'profile', color: '#ff0000', icon: null }, now0);
  const v = E.buildView(st, A.id, now0);
  assert.strictEqual(v.seats[0].color, '#ff0000');
  assert.strictEqual(v.seats[0].icon, 'crown');
  assert.strictEqual(v.seats[1].color, null); // clashes with seat 1 -> default
  assert.strictEqual(v.seats[1].icon, null);
});

/* ---------------- game modes ---------------- */
const C = { id: 'c1', name: 'Cara' };
const D = { id: 'd1', name: 'Dan' };
function tableN(users, settings = {}) {
  const st = newRoom('m', now0);
  users.forEach((u, i) => {
    E.applyAction(st, u, { type: 'join' }, now0);
    E.applyAction(st, u, { type: 'sit', seat: i }, now0);
    if (i === 0) E.applyAction(st, u, { type: 'settings', settings }, now0); // mode decides how many seats exist
  });
  for (const u of users) E.applyAction(st, u, { type: 'ready', value: true }, now0);
  return st;
}
const bet = (st, u, amount) => E.applyAction(st, u, { type: 'bet', amount }, now0);
const stand = (st, u) => E.applyAction(st, u, { type: 'stand_hand', seq: st.seq }, now0);

test('classic: three players play against the dealer and rotate who acts first', () => {
  const st = tableN([A, B, C], { mode: 'classic' });
  assert.strictEqual(st.phase, 'betting');
  assert.strictEqual(st.first, 0);
  rig(st, ['10S', '10H', '10D', '7H', '9S', '8H', '10C', '10D']); // A19 B18 C20, dealer 17
  for (const u of [A, B, C]) bet(st, u, 100);
  assert.strictEqual(st.phase, 'playing');
  assert.deepStrictEqual(st.turn, { seat: 0, hand: 0 });
  for (const u of [A, B, C]) stand(st, u);
  E.tick(st, st.timerAt); // dealer reveal
  assert.deepStrictEqual(st.balances.slice(0, 3), [1100, 1100, 1100]);
  E.tick(st, st.timerAt); // intermission
  assert.strictEqual(st.round, 2);
  assert.strictEqual(st.first, 1);
});

test('showdown: side pots, never lose more than your stake, chips conserved', () => {
  const st = tableN([A, B, C], { mode: 'showdown' });
  rig(st, ['10S', '10H', '10C', '9S', '10D', '8C']); // A19 B20 C18, no dealer cards
  bet(st, A, 100);
  bet(st, B, 50);
  bet(st, C, 100);
  assert.strictEqual(st.dealer.cards.length, 0);
  for (const u of [A, B, C]) stand(st, u);
  assert.strictEqual(st.phase, 'settled');
  assert.deepStrictEqual(st.balances.slice(0, 3), [1000, 1100, 900]); // B wins the 150 main pot, A the 100 side pot
  assert.strictEqual(st.balances[0] + st.balances[1] + st.balances[2], 3000);
  assert.strictEqual(E.legal(st, 0), null);
});

test('showdown: no splitting, natural blackjack beats a three-card 21', () => {
  const st = tableN([A, B], { mode: 'showdown' });
  rig(st, ['8S', 'AH', '8D', 'KH']); // A 8,8 (pair!)  B A,K blackjack
  bet(st, A, 100);
  bet(st, B, 100);
  assert.strictEqual(st.hands[1][0].bj, true);
  assert.strictEqual(E.legal(st, 0).split, false);
  E.applyAction(st, A, { type: 'stand_hand', seq: st.seq }, now0);
  assert.strictEqual(st.balances[1], 1100); // blackjack wins vs 16
  assert.strictEqual(st.balances[0], 900);
});

test('tournament: blinds rise every N rounds and busted-out players are eliminated', () => {
  const st = tableN([A, B, C], { mode: 'tournament', startingBalance: 100, minBet: 10, maxBet: 100, blindEvery: 3 });
  assert.deepStrictEqual([E.limits(st, 1).min, E.limits(st, 1).max], [10, 100]);
  assert.deepStrictEqual([E.limits(st, 4).min, E.limits(st, 4).max], [15, 150]);
  assert.deepStrictEqual([E.limits(st, 7).min, E.limits(st, 7).max], [23, 225]);
  rig(st, ['10S', '10H', '10D', '10C', '9S', '9H', '6C', '9D']); // A19 B19 C16, dealer 19
  bet(st, A, 10);
  bet(st, B, 10);
  bet(st, C, 95);
  for (const u of [A, B, C]) stand(st, u);
  E.tick(st, st.timerAt);
  assert.strictEqual(st.balances[2], 5);
  assert.strictEqual(st.alive[2], false);
  assert.strictEqual(st.over, null);
  const out = st.chat.find((m) => m.k === 'out');
  assert.strictEqual(out.d.place, 3);
  E.tick(st, st.timerAt);
  assert.strictEqual(st.round, 2);
  assert.strictEqual(st.first, 1); // seat 2 is out, rotation skips it
  assert.throws(() => bet(st, C, 10), /out of this match/);
});

test('tournament needs three players, duel exactly two, classic up to six', () => {
  const st = newRoom('cap', now0);
  for (const u of [A, B]) {
    E.applyAction(st, u, { type: 'join' }, now0);
  }
  E.applyAction(st, A, { type: 'sit', seat: 0 }, now0);
  E.applyAction(st, A, { type: 'settings', settings: { mode: 'tournament' } }, now0);
  E.applyAction(st, B, { type: 'sit', seat: 4 }, now0);
  E.applyAction(st, A, { type: 'ready', value: true }, now0);
  E.applyAction(st, B, { type: 'ready', value: true }, now0);
  assert.strictEqual(st.phase, 'lobby'); // only two seated
  E.applyAction(st, A, { type: 'settings', settings: { mode: 'duel' } }, now0);
  assert.deepStrictEqual([st.seats[0].name, st.seats[1].name], ['Alice', 'Bob']); // compacted
  assert.throws(() => E.applyAction(st, C, { type: 'join' }, now0) || E.applyAction(st, C, { type: 'sit', seat: 2 }, now0), /No such seat/);
  E.applyAction(st, A, { type: 'settings', settings: { mode: 'classic' } }, now0);
  for (const [i, u] of [C, D].entries()) {
    E.applyAction(st, u, { type: 'join' }, now0);
    E.applyAction(st, u, { type: 'sit', seat: 2 + i }, now0);
  }
  assert.throws(() => E.applyAction(st, A, { type: 'settings', settings: { mode: 'duel' } }, now0), /allows 2/);
});

test('leaving a live classic match refunds the round and the rest play on', () => {
  const st = tableN([A, B, C], { mode: 'classic' });
  bet(st, A, 100);
  bet(st, B, 50);
  E.applyAction(st, C, { type: 'forfeit' }, now0);
  assert.strictEqual(st.seats[2], null);
  assert.strictEqual(st.phase, 'betting');
  assert.strictEqual(st.round, 1); // same round replayed
  assert.deepStrictEqual(st.balances.slice(0, 2), [1000, 1000]); // bets refunded
  assert.strictEqual(st.bets[0], null);
  E.applyAction(st, B, { type: 'forfeit' }, now0);
  assert.strictEqual(st.phase, 'over');
  assert.strictEqual(st.over.winner, 0);
  assert.strictEqual(st.over.reason, 'forfeit');
});

test('classic: players who go broke sit out while others continue; ranking at the end', () => {
  const st = tableN([A, B, C], { mode: 'classic', startingBalance: 100, minBet: 50, maxBet: 100 });
  rig(st, ['10S', '10H', '10D', '7H', '9S', '9H', '6C', '10D']); // A19 B19 C16, dealer 17
  for (const u of [A, B, C]) bet(st, u, 100);
  for (const u of [A, B, C]) stand(st, u);
  E.tick(st, st.timerAt);
  assert.strictEqual(st.alive[2], false); // C lost everything
  assert.strictEqual(st.balances[0], 200);
  E.tick(st, st.timerAt);
  assert.strictEqual(st.round, 2); // A and B continue
  assert.strictEqual(st.phase, 'betting');
  assert.strictEqual(st.first, 1); // B acts first now
  rig(st, ['10S', '10H', '9S', '9H', '8C', '8D']); // B 19, A 18, dealer 17
  bet(st, A, 100);
  bet(st, B, 100);
  for (const u of [B, A]) stand(st, u);
  E.tick(st, st.timerAt);
  assert.deepStrictEqual(st.balances.slice(0, 3), [300, 300, 0]);
  E.tick(st, st.timerAt);
  assert.strictEqual(st.round, 3);
  E.applyAction(st, B, { type: 'forfeit' }, now0);
  assert.strictEqual(st.phase, 'over');
  assert.strictEqual(st.over.winner, 0);
  const rk = st.over.ranking;
  assert.deepStrictEqual(rk.map((r) => [r.seat, r.place]), [[0, 1], [2, 2]]);
});

test('blitz mode shortens the timers and the intermission', () => {
  const st = tableN([A, B], { blitz: true, betTime: 60, actionTime: 60 });
  assert.strictEqual(st.timerDur, 8000);
  rig(st, ['10S', '9S', '8S', '7S', '2H', '3H']);
  bet(st, A, 10);
  bet(st, B, 10);
  if (st.phase === 'playing') assert.strictEqual(st.timerDur, 8000);
  for (let g = 0; g < 10 && st.phase !== 'settled'; g++) E.tick(st, st.timerAt || now0);
  assert.strictEqual(st.timerDur, 2500);
});

test('random play across all modes keeps balances sane and showdown zero-sum', () => {
  const people = [A, B, C, D, { id: 'e1', name: 'Eve' }, { id: 'f1', name: 'Fay' }];
  const setups = [['duel', 2], ['classic', 4], ['classic', 6], ['showdown', 3], ['showdown', 6], ['tournament', 3], ['tournament', 5]];
  for (const [mode, n] of setups) {
    for (const blitz of [false, true]) {
      const users = people.slice(0, n);
      const st = tableN(users, { mode, blitz, startingBalance: 200, minBet: 10, maxBet: 100, blindEvery: 3 });
      assert.strictEqual(st.phase, 'betting', `${mode}/${n} should start`);
      let t = now0;
      let guard = 0;
      while (st.phase !== 'over' && guard++ < 2500) {
        for (const u of users) E.applyAction(st, u, { type: 'ping' }, t);
        const seat = st.turn ? st.turn.seat : -1;
        if (st.phase === 'betting') {
          for (let s = 0; s < 6; s++) if (st.seats[s] && st.alive[s] && st.bets[s] == null && Math.random() < 0.7) {
            const b = E.limits(st);
            E.applyAction(st, users.find((u) => u.id === st.seats[s].id), { type: 'bet', amount: Math.min(st.balances[s], b.min + Math.floor(Math.random() * (b.max - b.min))) }, t);
          }
        } else if (st.phase === 'playing' && seat >= 0) {
          const u = users.find((x) => x.id === st.seats[seat].id);
          const lg = E.legal(st, seat);
          const r = Math.random();
          const type = r < 0.3 && lg.double ? 'double' : r < 0.4 && lg.split ? 'split' : r < 0.7 ? 'hit' : 'stand_hand';
          E.applyAction(st, u, { type, seq: st.seq }, t);
        }
        if (st.timerAt) t = Math.max(t, st.timerAt - (Math.random() < 0.5 ? 0 : 1));
        t += 50;
        E.tick(st, t);
        for (const b of st.balances) assert.ok(b >= 0, `${mode} negative balance`);
        if (mode === 'showdown' && st.phase === 'settled') {
          const total = st.balances.reduce((a, b) => a + b, 0);
          assert.strictEqual(total, 200 * n, 'showdown must be zero-sum');
        }
      }
      assert.strictEqual(st.phase, 'over', `${mode}/${n}${blitz ? ' blitz' : ''} should finish (rounds=${st.round})`);
      assert.ok(st.over.ranking.length >= 1 && st.over.ranking[0].place === 1);
    }
  }
});
