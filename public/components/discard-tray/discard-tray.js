/*! DiscardTray: the dealer's discard pile, a neat-ish stack of used cards that grows as the shoe is
 * played. Vanilla JS + inline SVG, no dependencies.
 *
 *   const pile = new DiscardTray('#discard', { total: 312 });
 *   pile.setCount(discardedSoFar);   // call on every state update
 *
 * It only draws. Which cards are discarded is decided by the game engine.
 * Card back colours: --cs-back-a / --cs-back-b on the container (default: the table's blue).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DiscardTray = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var uid = 0;
  var A = [46, -6], B = [10, 24]; // card width / depth axes in the 3/4 view
  var BASE = [22, 62]; // bottom-front-left corner of the pile
  var MAXH = 30, SLAB = 2.5;

  function rnd(i, k) { var x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); }
  function f(n) { return n.toFixed(1); }

  function frame(id) {
    var s = '<svg viewBox="0 -4 82 88" aria-hidden="true" focusable="false"><defs>';
    s += '<pattern id="' + id + 'k" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" style="fill:var(--cs-back-a,#1d4ed8)"/><rect width="2" height="4" style="fill:var(--cs-back-b,#2563eb)"/></pattern>';
    s += '<linearGradient id="' + id + 'f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f4f1"/><stop offset="1" stop-color="#c9c9c3"/></linearGradient>';
    s += '<linearGradient id="' + id + 'r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfcfc9"/><stop offset="1" stop-color="#9c9c96"/></linearGradient>';
    s += '</defs>';
    s += '<ellipse cx="44" cy="68" rx="38" ry="7" fill="#000" opacity=".4"/>';
    // faint outline of where the pile sits
    s += '<path d="M' + f(BASE[0] - B[0]) + ',' + f(BASE[1] - B[1]) + ' l' + A[0] + ',' + A[1] + ' l' + B[0] + ',' + B[1] + ' l' + (-A[0]) + ',' + (-A[1]) + ' Z" fill="none" stroke="#fff" stroke-opacity=".16" stroke-dasharray="3 2.5" stroke-linejoin="round"/>';
    s += '<g class="dt-cards"></g></svg>';
    return s;
  }

  function slab(id, i, j, k, th, top) {
    // slab j (0 = bottom) of k; each one is nudged and slightly rotated so it reads as a casually squared pile
    var ox = (rnd(i + j, 1) - 0.5) * 2.2, rot = (rnd(i + j, 2) - 0.5) * 2.6;
    var base = BASE[1] - j * th;
    var Ox = BASE[0] - B[0] + ox, Oy = base - B[1] - th; // top-face origin of this slab
    var P0 = [Ox, Oy], P1 = [Ox + A[0], Oy + A[1]], P2 = [P1[0] + B[0], P1[1] + B[1]], P3 = [Ox + B[0], Oy + B[1]];
    var cx = (P0[0] + P2[0]) / 2, cy = (P0[1] + P2[1]) / 2;
    var g = '<g class="dt-c' + (top.fresh ? ' dt-new' : '') + '"' + (top.fresh ? ' style="--d:' + top.delay + 's"' : '') + '><g transform="rotate(' + rot.toFixed(2) + ' ' + f(cx) + ' ' + f(cy) + ')">';
    g += '<path d="M' + f(P3[0]) + ',' + f(P3[1]) + ' L' + f(P2[0]) + ',' + f(P2[1]) + ' v' + f(th) + ' H' + f(P3[0]) + ' Z" fill="url(#' + id + 'f)" stroke="#000" stroke-opacity=".45" stroke-width=".5" stroke-linejoin="round"/>';
    g += '<path d="M' + f(P1[0]) + ',' + f(P1[1]) + ' L' + f(P2[0]) + ',' + f(P2[1]) + ' v' + f(th) + ' L' + f(P1[0]) + ',' + f(P1[1] + th) + ' Z" fill="url(#' + id + 'r)" stroke="#000" stroke-opacity=".45" stroke-width=".5" stroke-linejoin="round"/>';
    if (top.last) {
      g += '<g transform="matrix(' + f(A[0] / 28) + ',' + f(A[1] / 28) + ',' + f(B[0] / 40) + ',' + f(B[1] / 40) + ',' + f(P0[0]) + ',' + f(P0[1]) + ')">';
      g += '<rect width="28" height="40" rx="2.4" fill="url(#' + id + 'k)" stroke="#e8f1fb" stroke-width="1.5"/></g>';
      g += '<path d="M' + f(P0[0]) + ',' + f(P0[1]) + ' L' + f(P1[0]) + ',' + f(P1[1]) + ' L' + f(P2[0]) + ',' + f(P2[1]) + ' L' + f(P3[0]) + ',' + f(P3[1]) + ' Z" fill="none" stroke="#000" stroke-opacity=".5" stroke-width=".6" stroke-linejoin="round"/>';
      g += '<path d="M' + f(P0[0] + 2) + ',' + f(P0[1] + 3) + ' L' + f(P1[0] - 3) + ',' + f(P1[1] + 1.5) + '" stroke="#fff" stroke-opacity=".28" stroke-width="1.4" stroke-linecap="round"/>';
    } else g += '<path d="M' + f(P0[0]) + ',' + f(P0[1]) + ' L' + f(P1[0]) + ',' + f(P1[1]) + ' L' + f(P2[0]) + ',' + f(P2[1]) + ' L' + f(P3[0]) + ',' + f(P3[1]) + ' Z" fill="#efefeb"/>';
    g += '</g></g>';
    return g;
  }

  function DiscardTray(container, o) {
    if (!(this instanceof DiscardTray)) return new DiscardTray(container, o);
    if (typeof container === 'string') container = document.querySelector(container);
    if (!container) throw new Error('DiscardTray: container not found');
    o = o || {};
    this.el = container;
    this.id = 'dtr' + ++uid;
    this.total = Math.max(1, o.total || 312);
    this.cut = o.cut || 0.75; // fraction of the shoe played before the dealer reshuffles; the pile is "full height" then
    this.count = 0;
    this.format = typeof o.format === 'function' ? o.format : function (n) { return 'DISCARDS ' + n; };
    this.showLabel = o.label !== false;
    this._t = null;
    container.classList.add('discard-tray');
    container.innerHTML = frame(this.id) + '<span class="dt-lbl"></span>';
    this.g = container.querySelector('.dt-cards');
    this.lbl = container.querySelector('.dt-lbl');
    this._render(0);
    if (o.count) this.setCount(o.count);
  }
  var P = DiscardTray.prototype;

  P._height = function (n) { return n <= 0 ? 0 : 2.4 + Math.min(1, n / (this.total * this.cut)) * (MAXH - 2.4); };

  P._render = function (freshN) {
    var H = this._height(this.count), s = '';
    if (H > 0) {
      var k = Math.max(1, Math.min(14, Math.round(H / SLAB))), th = H / k;
      for (var j = 0; j < k; j++) s += slab(this.id, j, j, k, th, { last: j === k - 1, fresh: j === k - 1 && freshN > 0, delay: 0 });
    }
    this.g.innerHTML = s;
    this.lbl.textContent = this.showLabel ? this.format(this.count) : '';
    this.el.setAttribute('role', 'img');
    this.el.setAttribute('aria-label', 'Discard pile, ' + this.count + ' cards');
  };

  // call with the engine's current discard count: the pile grows with it and sweeps away when it resets
  P.setCount = function (n, total) {
    if (total != null && total > 0) this.total = total;
    n = Math.max(0, n | 0);
    var old = this.count, self = this;
    if (n === old) return this;
    clearTimeout(this._t);
    if (n < old) { // new shoe: sweep the pile away, then show the new (usually empty) one
      this.count = n;
      var el = this.el;
      el.classList.add('is-clear');
      this._t = setTimeout(function () { el.classList.remove('is-clear'); self._render(0); }, 400);
      return this;
    }
    this.count = n;
    this.el.classList.remove('is-clear');
    this._render(n - old);
    return this;
  };
  P.add = function (k) { return this.setCount(this.count + Math.max(1, k | 0 || 1)); };
  P.clear = function () { return this.setCount(0); };
  P.destroy = function () {
    clearTimeout(this._t);
    this.el.classList.remove('discard-tray', 'is-clear');
    this.el.innerHTML = '';
  };
  return DiscardTray;
});
