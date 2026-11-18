'use strict';
// Minimal in-process fake of the Upstash Redis REST API (HMGET + the CAS EVAL script) for testing the Redis store path.
const http = require('node:http');
const { CAS_LUA } = require('../lib/store');

function start(port) {
  const hashes = new Map();
  const zset = new Map();
  let calls = 0;
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls++;
      const out = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.headers.authorization !== 'Bearer tok') return out({ error: 'unauthorized' });
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed[0])) { // /pipeline
        return out(parsed.map(([c, k, f]) => { const h = c === 'HGET' && hashes.get(k); return { result: h && h.has(f) ? h.get(f) : null }; }));
      }
      const [cmd, ...a] = parsed;
      if (cmd === 'HMGET') {
        const h = hashes.get(a[0]);
        return out({ result: a.slice(1).map((f) => (h && h.has(f) ? h.get(f) : null)) });
      }
      if (cmd === 'EVAL') {
        if (a[0] !== CAS_LUA) return out({ error: 'unexpected script' });
        const [, , key, , expect, next, v, t, d, now, cutoff, room, max, , sm] = a;
        const h = hashes.get(key) || new Map();
        if ((h.get('sv') || '0') !== expect) return out({ result: 0 });
        for (const [r, sc] of zset) if (Number(sc) <= Number(cutoff)) zset.delete(r);
        if (expect === '0' && !zset.has(room) && zset.size >= Number(max)) return out({ result: -1 });
        zset.set(room, now);
        h.set('sv', next); h.set('v', v); h.set('t', t); h.set('d', d); h.set('sm', sm);
        hashes.set(key, h);
        return out({ result: 1 });
      }
      out({ error: 'unsupported ' + cmd });
    });
  });
  srv.listen(port, '127.0.0.1');
  srv.calls = () => calls;
  return srv;
}
module.exports = { start };
