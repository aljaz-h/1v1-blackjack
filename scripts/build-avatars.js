'use strict';
// Renders the character avatars in public/avatars/ with DiceBear (https://www.dicebear.com, MIT library).
// Characters are generated from fixed seeds with a transparent background, so the player's chosen
// color shows behind them. Re-run:  node scripts/build-avatars.js
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PER_STYLE = 16;
const STYLES = ['lorelei', 'openPeeps', 'pixelArt', 'bottts']; // key in @dicebear/collection
const SEEDS = ['Ace', 'Maverick', 'Luna', 'Rico', 'Nova', 'Vegas', 'Joker', 'Bishop', 'Roxy', 'Dealer', 'Chip', 'Fortuna', 'Smokey', 'Blaze', 'Tiny', 'Lucky', 'Cleo', 'Duke', 'Mimi', 'Zed'];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dicebear-'));
fs.writeFileSync(path.join(tmp, 'package.json'), '{"private":true}');
execFileSync('npm', ['i', '--silent', '@dicebear/core@9', '@dicebear/collection@9'], { cwd: tmp, stdio: ['ignore', 'ignore', 'inherit'] });
const req = require('node:module').createRequire(path.join(tmp, 'x.js'));
const { createAvatar } = req('@dicebear/core');
const collection = req('@dicebear/collection');

const outDir = path.join(__dirname, '..', 'public', 'avatars');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const credits = ['Avatar characters generated with DiceBear (MIT) — https://www.dicebear.com', ''];
const manifest = {};
for (const key of STYLES) {
  const style = collection[key];
  const id = key.toLowerCase();
  manifest[id] = PER_STYLE;
  for (let i = 0; i < PER_STYLE; i++) {
    const svg = createAvatar(style, { seed: SEEDS[i % SEEDS.length] + (i >= SEEDS.length ? i : ''), backgroundColor: [] }).toString();
    fs.writeFileSync(path.join(outDir, `${id}-${i}.svg`), svg);
  }
  const m = style.meta || {};
  credits.push(`${id}: "${m.title || key}" by ${m.creator} — ${m.license && m.license.name} — ${m.license && m.license.url}${m.source ? ' — source: ' + m.source : ''}`);
}
fs.writeFileSync(path.join(outDir, 'LICENSES.txt'), credits.join('\n') + '\n');
console.log(JSON.stringify(manifest), '\n' + credits.join('\n'));
