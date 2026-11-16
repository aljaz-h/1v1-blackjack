'use strict';
// Minimal in-process fake of the Upstash Redis REST API (HMGET + the CAS EVAL script) for testing the Redis store path.
const http = require('node:http');
const { CAS_LUA } = require('../lib/store');

function start(port) {
  const hashes = new Map();
  let calls = 0;
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls++;
      const out = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.headers.authorization !== 'Bearer tok') return out({ error: 'unauthorized' });
      const [cmd, ...a] = JSON.parse(body);
      if (cmd === 'HMGET') {
        const h = hashes.get(a[0]);
        return out({ result: a.slice(1).map((f) => (h && h.has(f) ? h.get(f) : null)) });
      }
      if (cmd === 'EVAL') {
        if (a[0] !== CAS_LUA) return out({ error: 'unexpected script' });
        const [, , key, expect, next, v, t, d] = a;
        const h = hashes.get(key) || new Map();
        if ((h.get('sv') || '0') !== expect) return out({ result: 0 });
        h.set('sv', next); h.set('v', v); h.set('t', t); h.set('d', d);
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
