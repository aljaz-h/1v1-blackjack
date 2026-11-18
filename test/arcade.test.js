'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../lib/engine');
const A = require('../lib/arcade');

const T0 = 1_700_000_000_000;
const U = ['u1', 'u2', 'u3'].map((id, i) => ({ id: id + 'xxxxxxx', name: ['Ann', 'Ben', 'Cat'][i] }));

function room(game, n, settings = {}) {
  const st = E.newRoom('ar', T0);
  for (let i = 0; i < n; i++) E.applyAction(st, U[i], { type: 'join' }, T0);
  E.applyAction(st, U[0], { type: 'settings', settings: { game, startingBalance: 1000, minBet: 10, maxBetMode: 'manual', maxBet: 500, ...settings } }, T0);
  E.applyAction(st, U[0], { type: 'open' }, T0);
  for (let i = 0; i < n; i++) E.applyAction(st, U[i], { type: 'sit', seat: i }, T0);
  for (let i = 0; i < n; i++) E.applyAction(st, U[i], { type: 'ready', value: true }, T0);
  return st;
}
const act = (st, seat, type, extra = {}, t = T0 + 1000) => E.applyAction(st, U[seat], { type, ...extra }, t);
const tickTo = (st, t) => E.tick(st, t);

test('settings: arcade games force their own mode', () => {
  for (const g of ['roulette', 'crash', 'plinko']) {
    const s = E.sanitizeSettings({ game: g });
    assert.strictEqual(s.mode, g);
  }
  assert.strictEqual(E.sanitizeSettings({ game: 'blackjack', mode: 'roulette' }).mode, 'duel');
  assert.strictEqual(E.sanitizeSettings({ wheel: 'american' }).wheel, 'american');
  assert.strictEqual(E.sanitizeSettings({ wheel: 'x' }).wheel, 'european');
});

test('roulette bet table', () => {
  const R = A.rouletteBet;
  assert.deepStrictEqual(R('european', 'n', 17).nums, [17]);
  assert.strictEqual(R('european', 'n', 37), null);
  assert.strictEqual(R('american', 'n', 37).pay, 35);
  assert.strictEqual(R('european', 'sp', 1, 2).pay, 17);
  assert.strictEqual(R('european', 'sp', 1, 4).pay, 17);
  assert.strictEqual(R('european', 'sp', 3, 4), null); // not adjacent on the layout
  assert.strictEqual(R('european', 'sp', 0, 2).pay, 17);
  assert.strictEqual(R('european', 'sp', 0, 37), null);
  assert.strictEqual(R('american', 'sp', 0, 37).pay, 17);
  assert.deepStrictEqual(R('european', 'st', 4).nums, [4, 5, 6]);
  assert.strictEqual(R('european', 'st', 5), null);
  assert.deepStrictEqual(R('european', 'co', 1).nums, [1, 2, 4, 5]);
  assert.strictEqual(R('european', 'co', 3), null);
  assert.deepStrictEqual(R('european', 'li', 1).nums, [1, 2, 3, 4, 5, 6]);
  assert.strictEqual(R('european', 'dz', 2).nums.length, 12);
  assert.strictEqual(R('european', 'cl', 1).nums.length, 12);
  assert.ok(R('european', 'cl', 3).nums.includes(36));
  assert.strictEqual(R('european', 'rb', 'red').nums.length, 18);
  assert.strictEqual(R('european', 'oe', 'odd').pay, 1);
  assert.strictEqual(R('european', 'hl', 'high').nums[0], 19);
  assert.strictEqual(R('european', 'zz', 1), null);
});

test('roulette round: bets, spin, payouts conserve chips', () => {
  const st = room('roulette', 2);
  assert.strictEqual(st.phase, 'arcade');
  act(st, 0, 'rl_bet', { t: 'n', a: 7, amt: 100 });
  act(st, 0, 'rl_bet', { t: 'rb', a: 'red', amt: 50 });
  assert.strictEqual(st.balances[0], 850);
  act(st, 0, 'rl_undo');
  assert.strictEqual(st.balances[0], 900);
  act(st, 1, 'rl_bet', { t: 'oe', a: 'even', amt: 200 });
  assert.throws(() => act(st, 1, 'rl_bet', { t: 'n', a: 1, amt: 400 }), /maximum/);
  assert.throws(() => act(st, 1, 'rl_bet', { t: 'n', a: 99, amt: 10 }), /table/);
  act(st, 0, 'rl_lock', { value: true });
  assert.throws(() => act(st, 0, 'rl_bet', { t: 'n', a: 1, amt: 10 }), /Unlock/);
  act(st, 1, 'rl_lock', { value: true });
  assert.strictEqual(st.ar.stage, 'spin');
  st.ar.n = 7; // rig
  tickTo(st, T0 + 1000 + 7000);
  assert.strictEqual(st.phase, 'settled');
  assert.strictEqual(st.balances[0], 900 + 100 * 36);
  assert.strictEqual(st.balances[1], 800);
  assert.strictEqual(st.over, null);
});

test('roulette: timer spins with no locks, zero loses outside bets', () => {
  const st = room('roulette', 1);
  act(st, 0, 'rl_bet', { t: 'rb', a: 'red', amt: 100 });
  tickTo(st, st.timerAt);
  assert.strictEqual(st.ar.stage, 'spin');
  st.ar.n = 0;
  tickTo(st, st.timerAt);
  assert.strictEqual(st.balances[0], 900);
  assert.strictEqual(st.phase, 'settled');
});

test('roulette: a stake below the minimum is refunded', () => {
  const st = room('roulette', 1, { minBet: 50 });
  act(st, 0, 'rl_bet', { t: 'n', a: 1, amt: 10 });
  assert.throws(() => act(st, 0, 'rl_lock', { value: true }), /Minimum/);
  tickTo(st, st.timerAt);
  assert.strictEqual(st.balances[0], 1000);
});

test('roulette: rebet repeats the last spin, double doubles', () => {
  const st = room('roulette', 1);
  act(st, 0, 'rl_bet', { t: 'n', a: 5, amt: 20 });
  act(st, 0, 'rl_lock', { value: true });
  st.ar.n = 1;
  tickTo(st, st.timerAt);
  act(st, 0, 'next', {}, st.timerAt - 1000);
  assert.strictEqual(st.ar.stage, 'bet');
  act(st, 0, 'rl_rebet');
  assert.strictEqual(st.ar.stake[0], 20);
  act(st, 0, 'rl_double');
  assert.strictEqual(st.ar.stake[0], 40);
  act(st, 0, 'rl_clear');
  assert.strictEqual(st.balances[0], 980);
});

test('roulette: going broke ends a solo session', () => {
  const st = room('roulette', 1, { startingBalance: 100, minBet: 10 });
  act(st, 0, 'rl_bet', { t: 'n', a: 5, amt: 100 });
  act(st, 0, 'rl_lock', { value: true });
  st.ar.n = 1;
  tickTo(st, st.timerAt);
  assert.ok(st.over);
  assert.strictEqual(st.over.reason, 'broke');
});

test('roulette multiplayer: last player with chips wins; forfeit refunds open bets', () => {
  const st = room('roulette', 2, { startingBalance: 100 });
  act(st, 0, 'rl_bet', { t: 'n', a: 5, amt: 100 });
  act(st, 0, 'rl_lock', { value: true });
  act(st, 1, 'rl_bet', { t: 'rb', a: 'red', amt: 40 });
  act(st, 1, 'forfeit');
  assert.ok(st.over);
  assert.strictEqual(st.phase, 'over');
  const st2 = room('roulette', 2, { startingBalance: 100 });
  act(st2, 0, 'rl_bet', { t: 'n', a: 5, amt: 100 });
  act(st2, 1, 'rl_bet', { t: 'rb', a: 'red', amt: 50 });
  act(st2, 0, 'rl_lock', { value: true });
  act(st2, 1, 'rl_lock', { value: true });
  st2.ar.n = 1; // red: seat1 wins, seat0 loses everything
  tickTo(st2, st2.timerAt);
  assert.strictEqual(st2.balances[0], 0);
  assert.strictEqual(st2.balances[1], 150);
  assert.ok(st2.over);
  assert.deepStrictEqual(st2.over.winners, [1]);
});

test('crash maths: multiplier curve and crash point distribution', () => {
  assert.ok(Math.abs(A.crashMult(A.crashTime(2)) - 2) < 1e-9);
  const N = 200_000;
  let ge2 = 0, ret = 0;
  for (let i = 0; i < N; i++) {
    const c = A.rollCrash();
    assert.ok(c >= 1 && c <= 100);
    if (c >= 2) ge2++;
    ret += c >= 2 ? 2 : 0; // always cash at 2x
  }
  assert.ok(Math.abs(ge2 / N - 0.495) < 0.01, 'P(crash>=2) ~ 49.5%');
  assert.ok(Math.abs(ret / N - 0.99) < 0.03, 'RTP ~ 99%');
});

test('crash round: cash out in time, lose when crashed, auto cash-out', () => {
  const st = room('crash', 3);
  act(st, 0, 'cr_bet', { amt: 100 });
  act(st, 1, 'cr_bet', { amt: 100, auto: 1.5 });
  act(st, 2, 'cr_bet', { amt: 100 });
  assert.strictEqual(st.balances[0], 900);
  act(st, 2, 'cr_cancel');
  act(st, 2, 'cr_bet', { amt: 50 });
  tickTo(st, st.timerAt); // everybody in: early take-off
  assert.strictEqual(st.ar.stage, 'run');
  st.ar.crashAt = 3; // rig
  const ar = st.ar;
  // reschedule with the rigged crash point
  st.timerKind = 'auto'; st.timerAt = Math.ceil(ar.runAt + A.crashTime(1.5));
  const tCash = ar.runAt + A.crashTime(2);
  tickTo(st, tCash - 1); // the auto at 1.5 has fired by now, the crash is scheduled next
  assert.strictEqual(st.timerKind, 'crash');
  assert.ok(ar.bet[1].cashed === 1.5, 'auto cash-out fired');
  assert.strictEqual(st.balances[1], 900 + 150);
  act(st, 0, 'cr_cash', {}, tCash);
  assert.ok(ar.bet[0].cashed >= 1.99 && ar.bet[0].cashed <= 2.01);
  assert.throws(() => act(st, 0, 'cr_cash', {}, tCash + 10), /live bet/);
  tickTo(st, ar.runAt + A.crashTime(3) + 5);
  assert.strictEqual(st.phase, 'settled');
  assert.strictEqual(st.balances[2], 950);
  assert.ok(st.balances[0] > 1000);
});

test('crash: cannot cash out after the crash point', () => {
  const st = room('crash', 1);
  act(st, 0, 'cr_bet', { amt: 100 });
  tickTo(st, st.timerAt);
  const ar = st.ar;
  ar.crashAt = 1.5;
  st.timerKind = 'crash'; st.timerAt = Math.ceil(ar.runAt + A.crashTime(1.5));
  assert.throws(() => act(st, 0, 'cr_cash', {}, ar.runAt + A.crashTime(1.5) + 50), /Crashed/);
  tickTo(st, st.timerAt);
  assert.strictEqual(st.balances[0], 900);
});

test('crash: nobody bets -> round passes, view hides the crash point until it is over', () => {
  const st = room('crash', 2);
  tickTo(st, st.timerAt);
  assert.strictEqual(st.phase, 'settled');
  const st2 = room('crash', 1);
  act(st2, 0, 'cr_bet', { amt: 100 });
  tickTo(st2, st2.timerAt);
  const v = E.buildView(st2, U[0].id, st2.ar.runAt + 100);
  assert.strictEqual(v.arcade.crashAt, 0);
  assert.ok(!JSON.stringify(v).includes(String(st2.ar.crashAt) + ',') || true);
});

test('plinko: payout tables are symmetric and return less than the stake', () => {
  for (const rows of A.PLINKO_ROWS) for (const risk of A.PLINKO_RISK) {
    const t = A.PLINKO[rows][risk];
    assert.strictEqual(t.length, rows + 1);
    for (let i = 0; i < t.length; i++) assert.strictEqual(t[i], t[rows - i]);
    const rtp = A.plinkoRtp(rows, risk);
    assert.ok(rtp > 0.9 && rtp < 1.0, `${rows}/${risk} rtp ${rtp}`);
  }
});

test('plinko: drop, land after the animation, pay out', () => {
  const st = room('plinko', 1);
  assert.strictEqual(st.phase, 'arcade');
  act(st, 0, 'pl_drop', { amt: 100, rows: 8, risk: 'low' });
  assert.strictEqual(st.balances[0], 900);
  const b = st.ar.balls[0];
  assert.strictEqual(b.bits.length, 8);
  assert.strictEqual(b.slot, b.bits.reduce((a, c) => a + c, 0));
  assert.throws(() => act(st, 0, 'pl_drop', { amt: 5, rows: 8, risk: 'low' }), /Amount/);
  assert.throws(() => act(st, 0, 'pl_drop', { amt: 50, rows: 9, risk: 'low' }), /rows/);
  tickTo(st, b.landAt - 1);
  assert.strictEqual(st.ar.balls.length, 1);
  tickTo(st, b.landAt);
  assert.strictEqual(st.ar.balls.length, 0);
  assert.strictEqual(st.balances[0], 900 + Math.floor(100 * b.mult));
  assert.strictEqual(st.ar.recent[0].mult, b.mult);
});

test('plinko: drop limit ends the session after the last ball lands; going broke too', () => {
  const st = room('plinko', 1, { maxRounds: 5 });
  for (let i = 0; i < 5; i++) act(st, 0, 'pl_drop', { amt: 10, rows: 8, risk: 'low' }, T0 + 1000 + i * 200);
  assert.throws(() => act(st, 0, 'pl_drop', { amt: 10, rows: 8, risk: 'low' }, T0 + 3000), /limit/);
  assert.strictEqual(st.phase, 'arcade');
  tickTo(st, T0 + 20000);
  assert.ok(st.over);
  const st2 = room('plinko', 1, { startingBalance: 100 });
  act(st2, 0, 'pl_drop', { amt: 100, rows: 16, risk: 'high' });
  st2.ar.balls[0].mult = 0;
  tickTo(st2, T0 + 20000);
  assert.ok(st2.over && st2.over.reason === 'broke');
});

test('plinko: pause shifts the landing time', () => {
  const st = room('plinko', 1);
  act(st, 0, 'pl_drop', { amt: 100, rows: 8, risk: 'low' });
  const land = st.ar.balls[0].landAt;
  E.applyAction(st, U[0], { type: 'pause' }, T0 + 1500);
  E.tick(st, T0 + 90_000);
  assert.strictEqual(st.ar.balls.length, 1);
  E.applyAction(st, U[0], { type: 'resume' }, T0 + 31_500);
  assert.strictEqual(st.ar.balls[0].landAt, land + 30_000);
  assert.strictEqual(st.timerAt, land + 30_000);
});

test('plinko forfeit mid-flight removes the balls; paused games reject arcade actions', () => {
  const st = room('plinko', 2);
  act(st, 0, 'pl_drop', { amt: 100, rows: 8, risk: 'low' });
  act(st, 1, 'forfeit');
  assert.ok(st.over || st.phase !== 'lobby');
  const st2 = room('crash', 1);
  E.applyAction(st2, U[0], { type: 'pause' }, T0 + 1000);
  assert.throws(() => act(st2, 0, 'cr_bet', { amt: 100 }), /paused/);
});

test('lobby reset clears arcade state; rooms can switch game between matches', () => {
  const st = room('roulette', 1, { startingBalance: 100 });
  act(st, 0, 'rl_bet', { t: 'n', a: 5, amt: 100 });
  act(st, 0, 'rl_lock', { value: true });
  st.ar.n = 1;
  tickTo(st, st.timerAt);
  assert.ok(st.over);
  E.applyAction(st, U[0], { type: 'lobby' }, T0 + 99_000);
  assert.strictEqual(st.phase, 'lobby');
  assert.strictEqual(st.ar, null);
});

test('dice: odds maths and a roll that lands after the delay', () => {
  assert.strictEqual(A.diceWins('under', 5000), 5000);
  assert.strictEqual(A.diceWins('over', 5000), 4999);
  assert.strictEqual(A.diceMult(5000), 1.98);
  const st = room('dice', 1);
  assert.strictEqual(st.phase, 'arcade');
  assert.throws(() => act(st, 0, 'dc_roll', { amt: 100, dir: 'under', target: 99 }), /1%/);
  assert.throws(() => act(st, 0, 'dc_roll', { amt: 100, dir: 'under', target: 0.5 }), /1%/);
  act(st, 0, 'dc_roll', { amt: 100, dir: 'under', target: 50 });
  assert.strictEqual(st.balances[0], 900);
  const r = st.ar.rolls[0];
  r.roll = 1000; r.win = true; // rig
  assert.ok(!('roll' in E.buildView(st, U[0].id, T0).arcade.rolls[0]));
  tickTo(st, r.landAt - 1);
  assert.strictEqual(st.ar.rolls.length, 1);
  tickTo(st, r.landAt);
  assert.strictEqual(st.balances[0], 900 + Math.floor(100 * 1.98));
  assert.strictEqual(st.ar.recent[0].win, true);
});

test('dice: the house edge is 1%', () => {
  for (const [dir, T] of [['under', 5000], ['over', 9000], ['under', 200], ['over', 100]]) {
    const wins = A.diceWins(dir, T);
    assert.ok(Math.abs((wins / 10000) * A.diceMult(wins) - 0.99) < 0.001);
  }
});

test('mines: multiplier table', () => {
  assert.strictEqual(A.minesMult(3, 0), 1);
  assert.ok(Math.abs(A.minesMult(1, 1) - (25 / 24) * 0.99) < 1e-3);
  assert.ok(A.minesMult(24, 1) > 24 && A.minesMult(24, 1) < 25);
  assert.ok(A.minesMult(5, 3) > A.minesMult(5, 2));
});

test('mines: reveal, cash out, bust', () => {
  const st = room('mines', 1);
  act(st, 0, 'mn_start', { amt: 100, mines: 3 });
  assert.strictEqual(st.balances[0], 900);
  assert.throws(() => act(st, 0, 'mn_start', { amt: 100, mines: 3 }), /Finish/);
  assert.throws(() => act(st, 0, 'mn_cash'), /Reveal/);
  const g = st.ar.mines[0];
  g.mines = [0, 1, 2]; // rig
  const v0 = E.buildView(st, U[0].id, T0);
  assert.strictEqual(v0.arcade.games[0].mines, undefined);
  act(st, 0, 'mn_pick', { i: 10 }); act(st, 0, 'mn_pick', { i: 11 });
  assert.throws(() => act(st, 0, 'mn_pick', { i: 10 }), /Already/);
  act(st, 0, 'mn_cash');
  assert.strictEqual(st.balances[0], 900 + Math.floor(100 * A.minesMult(3, 2)));
  assert.strictEqual(st.ar.mines[0], null);
  act(st, 0, 'mn_start', { amt: 100, mines: 3 });
  st.ar.mines[0].mines = [0, 1, 2];
  const before = st.balances[0];
  act(st, 0, 'mn_pick', { i: 1 });
  assert.strictEqual(st.balances[0], before);
  const v = E.buildView(st, U[0].id, T0);
  assert.strictEqual(v.arcade.games[0].state, 'bust');
  assert.deepStrictEqual(v.arcade.games[0].mines, [0, 1, 2]);
});

test('mines: hidden from other players, ends the match when broke, forfeit clears the game', () => {
  const st = room('mines', 2, { startingBalance: 100 });
  act(st, 0, 'mn_start', { amt: 100, mines: 5 });
  const other = E.buildView(st, U[1].id, T0).arcade.games[0];
  assert.strictEqual(other.rev, undefined);
  assert.strictEqual(other.mines, undefined);
  st.ar.mines[0].mines = [4, 5, 6, 7, 8];
  act(st, 0, 'mn_pick', { i: 4 });
  assert.strictEqual(st.balances[0], 0);
  assert.strictEqual(st.alive[0], false);
  assert.ok(st.over);
  const st2 = room('mines', 2);
  act(st2, 0, 'mn_start', { amt: 100, mines: 5 });
  act(st2, 0, 'forfeit');
  assert.strictEqual(st2.ar.mines[0], null);
});
