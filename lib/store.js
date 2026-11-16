'use strict';
// Room storage. Memory (single process: Docker/Coolify/local) or Upstash Redis REST (Vercel / multi-instance).
// Writes are compare-and-set on a storage version so concurrent serverless instances never clobber each other.

class MemoryStore {
  constructor() {
    this.kind = 'memory';
    this.rooms = new Map();
    this.subs = new Map();
    setInterval(() => {
      const cutoff = Date.now() - 6 * 3600_000;
      for (const [k, r] of this.rooms) if (r.touched < cutoff) this.rooms.delete(k);
    }, 600_000).unref();
  }
  async get(room) {
    const r = this.rooms.get(room);
    return r ? { sv: r.sv, state: structuredClone(r.state) } : null;
  }
  async peek(room) {
    const r = this.rooms.get(room);
    return r ? { v: r.state.v, t: r.state.timerAt || 0 } : null;
  }
  async cas(room, sv, state) {
    const r = this.rooms.get(room);
    if ((r ? r.sv : 0) !== sv) return false;
    this.rooms.set(room, { sv: sv + 1, state: structuredClone(state), touched: Date.now() });
    const set = this.subs.get(room);
    if (set) for (const fn of set) queueMicrotask(fn);
    return true;
  }
  subscribe(room, fn) {
    let set = this.subs.get(room);
    if (!set) this.subs.set(room, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (!set.size) this.subs.delete(room);
    };
  }
}

const CAS_LUA = `
local cur = redis.call('HGET', KEYS[1], 'sv') or '0'
if cur ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], 'sv', ARGV[2], 'v', ARGV[3], 't', ARGV[4], 'd', ARGV[5])
redis.call('EXPIRE', KEYS[1], 86400)
return 1`;

class UpstashStore {
  constructor(url, token) {
    this.kind = 'upstash';
    this.url = url.replace(/\/$/, '');
    this.token = token;
  }
  async cmd(args) {
    const r = await fetch(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(6000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(`redis: ${j.error || r.status}`);
    return j.result;
  }
  key(room) {
    return `bj:room:${room}`;
  }
  async get(room) {
    const [sv, d] = await this.cmd(['HMGET', this.key(room), 'sv', 'd']);
    return d ? { sv: Number(sv), state: JSON.parse(d) } : null;
  }
  async peek(room) {
    const [v, t] = await this.cmd(['HMGET', this.key(room), 'v', 't']);
    return v == null ? null : { v: Number(v), t: Number(t) || 0 };
  }
  async cas(room, sv, state) {
    const r = await this.cmd([
      'EVAL', CAS_LUA, '1', this.key(room),
      String(sv), String(sv + 1), String(state.v), String(state.timerAt || 0), JSON.stringify(state),
    ]);
    return Number(r) === 1;
  }
}

function createStore(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token) return new UpstashStore(url, token);
  return new MemoryStore();
}

module.exports = { MemoryStore, UpstashStore, createStore, CAS_LUA };
