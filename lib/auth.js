'use strict';
const crypto = require('node:crypto');

const TOKEN_TTL_MS = 30 * 24 * 3600_000;
const b64 = (b) => Buffer.from(b).toString('base64url');
const sha = (s) => crypto.createHash('sha256').update(s).digest();

function sitePassword() {
  return process.env.SITE_PASSWORD || '';
}
function key() {
  return sha(`bj1:${process.env.AUTH_SECRET || ''}:${sitePassword()}`);
}
function checkPassword(input) {
  const pw = sitePassword();
  if (!pw) return false;
  return crypto.timingSafeEqual(sha(String(input ?? '')), sha(pw));
}
function sign(payload) {
  const p = b64(JSON.stringify(payload));
  return `${p}.${b64(crypto.createHmac('sha256', key()).update(p).digest())}`;
}
function issueToken(user) {
  return sign({ i: user.id, n: user.name, e: Date.now() + TOKEN_TTL_MS });
}
function verifyToken(token) {
  if (!sitePassword() || typeof token !== 'string') return null;
  const [p, s] = token.split('.');
  if (!p || !s) return null;
  const good = crypto.createHmac('sha256', key()).update(p).digest();
  let got;
  try { got = Buffer.from(s, 'base64url'); } catch { return null; }
  if (got.length !== good.length || !crypto.timingSafeEqual(got, good)) return null;
  try {
    const d = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (!d.i || !d.n || d.e < Date.now()) return null;
    return { id: d.i, name: d.n };
  } catch { return null; }
}
const newId = () => crypto.randomBytes(9).toString('base64url');

module.exports = { checkPassword, issueToken, verifyToken, newId, sitePassword };
