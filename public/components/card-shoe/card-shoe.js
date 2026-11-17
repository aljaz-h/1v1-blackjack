/*! CardShoe: visual blackjack dealing shoe (black acrylic box, sloped front with an arch where the
 * next card pokes out, card stack visible through the open top). Vanilla JS + inline SVG.
 *
 *   const shoe = new CardShoe('#shoe', { total: 312, remaining: 312 });
 *   shoe.setRemaining(300);   // call on every state update: animates a deal when the count drops a
 *                             // little, a shuffle when it jumps back up
 *
 * It only draws. Dealing, shuffling and counting stay in the game engine.
 * Card back colours: --cs-back-a / --cs-back-b on the container (default: the table's blue).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CardShoe = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var uid = 0;
  // 3/4 view geometry (viewBox 150 x 104). The open top is a parallelogram LA + x*U + y*V.
  var LA = [5, 37], U = [71, 26], V = [35, -4];
  var TL = [76, 63], TR = [111, 59], BL = [95, 96], BR = [133, 92]; // sloped front panel
  var BED = { x0: 4, x1: 97, y0: 10, y1: 90 };
  var MAXLEN = 86;

  function pt(p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }
  function Q(s, t) { // bilinear point on the front panel
    return [
      (1 - s) * (1 - t) * TL[0] + s * (1 - t) * TR[0] + (1 - s) * t * BL[0] + s * t * BR[0],
      (1 - s) * (1 - t) * TL[1] + s * (1 - t) * TR[1] + (1 - s) * t * BL[1] + s * t * BR[1],
    ];
  }

  function build(id) {
    var F1 = [LA[0] + U[0], LA[1] + U[1]], RA = [LA[0] + V[0], LA[1] + V[1]];
    var s = '<svg viewBox="0 0 150 104" aria-hidden="true" focusable="false"><defs>';
    s += '<linearGradient id="' + id + 'l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2d2f35"/><stop offset=".5" stop-color="#16171a"/><stop offset="1" stop-color="#08090a"/></linearGradient>';
    s += '<linearGradient id="' + id + 'f" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#34363c"/><stop offset=".5" stop-color="#1a1b1f"/><stop offset="1" stop-color="#0c0d0f"/></linearGradient>';
    s += '<linearGradient id="' + id + 'b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#050506"/><stop offset="1" stop-color="#14151a"/></linearGradient>';
    s += '<linearGradient id="' + id + 'w" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4a4d55"/><stop offset=".5" stop-color="#2a2c31"/><stop offset="1" stop-color="#17181b"/></linearGradient>';
    s += '<pattern id="' + id + 'k" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" style="fill:var(--cs-back-a,#1d4ed8)"/><rect width="2.5" height="5" style="fill:var(--cs-back-b,#2563eb)"/></pattern>';
    s += '<clipPath id="' + id + 'c"><rect x="' + BED.x0 + '" y="' + BED.y0 + '" width="' + (BED.x1 - BED.x0) + '" height="' + (BED.y1 - BED.y0) + '"/></clipPath>';
    s += '</defs>';
    s += '<ellipse cx="78" cy="97" rx="66" ry="5" fill="#000" opacity=".45"/>';
    s += '<g class="cs-rock">';
    // front card poking out under the arch (behind the panel)
    s += '<g class="cs-out"><path d="M96,90 L130,86 L141,96 L107,100 Z" fill="url(#' + id + 'k)" stroke="#e0f2fe" stroke-width="1.1" stroke-linejoin="round"/><path d="M107,100 L141,96 L141,98.2 L107,102.2 Z" fill="#cfe3f7"/></g>';
    // left side face
    s += '<path d="M' + pt(LA) + ' L' + pt(F1) + ' L78,93 L5,79 Z" fill="url(#' + id + 'l)" stroke="#000" stroke-width="1" stroke-linejoin="round"/>';
    s += '<path d="M6,70 L77,85" stroke="#fff" stroke-opacity=".07" stroke-width="1"/>';
    s += '<path d="M' + pt([LA[0] + 2, LA[1] + 5]) + ' L' + pt([F1[0] - 3, F1[1] + 4]) + '" stroke="#fff" stroke-opacity=".1" stroke-width="2.4" stroke-linecap="round"/>';
    // open top: rim, bed, card stack, pusher weight
    s += '<g transform="matrix(' + (U[0] / 100) + ',' + (U[1] / 100) + ',' + (V[0] / 100) + ',' + (V[1] / 100) + ',' + LA[0] + ',' + LA[1] + ')">';
    s += '<rect x="0" y="0" width="100" height="100" fill="url(#' + id + 'w)"/>';
    s += '<rect x="' + BED.x0 + '" y="' + BED.y0 + '" width="' + (BED.x1 - BED.x0) + '" height="' + (BED.y1 - BED.y0) + '" fill="url(#' + id + 'b)"/>';
    s += '<g clip-path="url(#' + id + 'c)">';
    s += '<g class="cs-stack"><rect class="cs-stack-rect" x="' + (BED.x1 - MAXLEN) + '" y="12" width="' + MAXLEN + '" height="76" fill="url(#' + id + 'k)" stroke="#e6f0fb" stroke-width="1.6"/></g>';
    s += '<rect class="cs-weight" x="0" y="12" width="15" height="76" rx="2" fill="#2e3036" stroke="#000" stroke-width="1"/><rect class="cs-weight-hi" x="0" y="12" width="2" height="76" fill="#fff" opacity=".22"/>';
    s += '</g></g>';
    s += '<path d="M' + pt(LA) + ' L' + pt(RA) + ' L' + pt([RA[0] + U[0], RA[1] + U[1]]) + '" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width=".9" stroke-linejoin="round"/>';
    s += '<path d="M' + pt(LA) + ' L' + pt(F1) + '" stroke="#fff" stroke-opacity=".4" stroke-width="1" stroke-linecap="round"/>';
    // sloped front panel with the arch cut-out
    var a0 = Q(0.28, 1), a1 = Q(0.28, 0.56), c1 = Q(0.28, 0.3), c2 = Q(0.64, 0.3), a2 = Q(0.64, 0.56), a3 = Q(0.64, 1);
    s += '<path fill-rule="evenodd" d="M' + pt(TL) + ' L' + pt(TR) + ' L' + pt(BR) + ' L' + pt(BL) + ' Z M' + pt(a0) + ' L' + pt(a1) + ' C' + pt(c1) + ' ' + pt(c2) + ' ' + pt(a2) + ' L' + pt(a3) + ' Z" fill="url(#' + id + 'f)" stroke="#000" stroke-width="1" stroke-linejoin="round"/>';
    s += '<path d="M' + pt(TL) + ' L' + pt(TR) + ' L' + pt(BR) + '" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1" stroke-linejoin="round"/>';
    s += '<path d="M' + pt(a0) + ' L' + pt(a1) + ' C' + pt(c1) + ' ' + pt(c2) + ' ' + pt(a2) + ' L' + pt(a3) + '" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width=".8"/>';
    s += '<path d="M' + pt(Q(0.08, 0.1)) + ' L' + pt(Q(0.5, 0.04)) + '" stroke="#fff" stroke-opacity=".12" stroke-width="2.2" stroke-linecap="round"/>';
    s += '</g></svg>';
    return s;
  }

  function CardShoe(container, o) {
    if (!(this instanceof CardShoe)) return new CardShoe(container, o);
    if (typeof container === 'string') container = document.querySelector(container);
    if (!container) throw new Error('CardShoe: container not found');
    o = o || {};
    this.el = container;
    this.id = 'csh' + ++uid;
    this.total = Math.max(1, o.total || 312);
    this.remaining = o.remaining == null ? this.total : o.remaining;
    this.format = typeof o.format === 'function' ? o.format : function (n) { return 'SHOE ' + n; };
    this.showLabel = o.label !== false;
    this._timers = [];
    container.classList.add('card-shoe');
    container.innerHTML = build(this.id) + '<span class="cs-lbl"></span>';
    this.lbl = container.querySelector('.cs-lbl');
    this.rect = container.querySelector('.cs-stack-rect');
    this.weight = container.querySelector('.cs-weight');
    this.weightHi = container.querySelector('.cs-weight-hi');
    this.out = container.querySelector('.cs-out');
    this._draw();
  }
  var P = CardShoe.prototype;

  P._draw = function () {
    var len = Math.max(0, Math.min(1, this.remaining / this.total)) * MAXLEN;
    if (this.remaining > 0) len = Math.max(len, 3);
    this.rect.setAttribute('x', BED.x1 - len);
    this.rect.setAttribute('width', len);
    var wx = BED.x1 - len - 15;
    this.weight.setAttribute('x', wx);
    this.weightHi.setAttribute('x', wx + 13);
    this.rect.style.display = len > 0 ? '' : 'none';
    this.out.style.display = this.remaining > 0 ? '' : 'none';
    this.lbl.textContent = this.showLabel ? this.format(this.remaining) : '';
    this.el.setAttribute('role', 'img');
    this.el.setAttribute('aria-label', 'Card shoe, ' + this.remaining + ' cards left');
  };

  P._play = function (cls, ms) {
    var el = this.el;
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    clearTimeout(el['_t' + cls]);
    el['_t' + cls] = setTimeout(function () { el.classList.remove(cls); }, ms);
  };

  // visual only: slide the front card out n times
  P.deal = function (n) {
    var self = this; n = Math.max(1, Math.min(6, n | 0 || 1));
    for (var i = 0; i < n; i++) this._timers.push(setTimeout(function () { self._play('is-deal', 380); }, i * 260));
    return this;
  };
  P.shuffle = function () { this._play('is-shuffle', 750); return this; };

  // call with the engine's current numbers; animations are inferred from the change
  P.setRemaining = function (n, total) {
    if (total != null && total > 0) this.total = total;
    n = Math.max(0, n | 0);
    var old = this.remaining;
    this.remaining = n;
    this._draw();
    if (n < old && old - n <= 24) this.deal(old - n);
    else if (n > old + 12) this.shuffle();
    return this;
  };
  P.setLabel = function (fn) { this.format = fn; this._draw(); return this; };
  P.destroy = function () {
    this._timers.forEach(clearTimeout);
    this.el.classList.remove('card-shoe', 'is-deal', 'is-shuffle');
    this.el.innerHTML = '';
  };
  return CardShoe;
});
