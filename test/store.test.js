'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { MemoryStore, MAX_ROOMS, ROOM_TTL_MS } = require('../lib/store');

test('room cap and inactivity expiry (memory store)', async () => {
  const s = new MemoryStore();
  assert.strictEqual(MAX_ROOMS, 10);
  assert.strictEqual(ROOM_TTL_MS, 3600_000);
  for (let i = 0; i < MAX_ROOMS; i++) assert.strictEqual(await s.cas('r' + i, 0, { v: 1 }), true);
  assert.strictEqual(await s.cas('extra', 0, { v: 1 }), 'full', 'eleventh room refused');
  assert.strictEqual(await s.cas('r0', 1, { v: 2 }), true, 'existing room still writable');
  // r3 goes idle for over an hour -> frees a slot
  s.rooms.get('r3').touched = Date.now() - ROOM_TTL_MS - 1000;
  assert.strictEqual(await s.get('r3'), null, 'expired room is gone');
  assert.strictEqual(await s.cas('extra', 0, { v: 1 }), true, 'slot freed');
  s.rooms.get('r5').touched = Date.now() - ROOM_TTL_MS - 1000;
  s.sweep();
  assert.strictEqual(s.rooms.has('r5'), false);
});
