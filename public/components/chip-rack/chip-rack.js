/*! ChipRack: reusable dealer chip tray. Vanilla JS + inline SVG, no dependencies.
 *
 *   const rack = new ChipRack(document.getElementById('rack'), {
 *     min: 10, max: 500,
 *     onSelect(chip, ctx) { console.log(chip.value, ctx.selected) },
 *   });
 *
 * See README.md for the full option / method list and how to wire it to betting.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChipRack = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // same palette as the table's decorative rack
  var DEFAULT_CHIPS = [
    { value: 1, color: '#64748b' },
    { value: 5, color: '#ef4444' },
    { value: 10, color: '#3b82f6' },
    { value: 25, color: '#16a34a' },
    { value: 50, color: '#f97316' },
    { value: 100, color: '#18181b' },
    { value: 500, color: '#9333ea' },
    { value: 1000, color: '#db2777' },
    { value: 5000, color: '#ca8a04' },
  ];
  var UNLIMITED = 1e12;
  var uid = 0;

  /* ---------- helpers ---------- */
  function hex(c) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(c || ''));
    if (m) { var n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
    m = /^#?([0-9a-f]{3})$/i.exec(String(c || ''));
    if (m) { var s = m[1]; return [parseInt(s[0] + s[0], 16), parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16)]; }
    return [100, 116, 139];
  }
  function mix(c, to, t) {
    var a = hex(c);
    return 'rgb(' + a.map(function (v) { return Math.round(v + (to - v) * t); }).join(',') + ')';
  }
  var lighten = function (c, t) { return mix(c, 255, t); };
  var darken = function (c, t) { return mix(c, 0, t); };
  function lum(c) { var a = hex(c); return (0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]) / 255; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function short(n) {
    if (n >= 1e6) return +(n / 1e6).toFixed(1) + 'M';
    if (n >= 1000) return +(n / 1000).toFixed(1) + 'K';
    return String(n);
  }
  function money(n) { return '$' + Number(n).toLocaleString('en-US'); }

  /* ---------- chip stack SVG ---------- */
  var W = 60, CW = 22, RY = 8.2, T = 5.2, PAD_BOTTOM = 9, PAD_TOP = 10;

  function slotHeight(capacity) { return Math.round((capacity * T + 2 * RY + PAD_BOTTOM + PAD_TOP) * 10) / 10; }

  function stackSVG(chip, visible, capacity, id) {
    var H = slotHeight(capacity), cx = W / 2, color = chip.color;
    var dark = lum(color) < 0.55, ink = dark ? '#fff' : '#17181b';
    var base = H - PAD_BOTTOM - RY - T; // y of the bottom chip's top ellipse
    var label = chip.label != null ? chip.label : short(chip.value);
    var s = '';
    s += '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true" focusable="false">';
    s += '<defs>';
    // slot recess + glass
    s += '<linearGradient id="' + id + 'b" x1="0" x2="1"><stop offset="0" stop-color="#050506"/><stop offset=".5" stop-color="#17181b"/><stop offset="1" stop-color="#050506"/></linearGradient>';
    s += '<linearGradient id="' + id + 'g" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".18" stop-color="#fff" stop-opacity=".02"/><stop offset=".8" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".09"/></linearGradient>';
    // cylinder shading across a chip's edge
    s += '<linearGradient id="' + id + 's" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset=".28" stop-color="#fff" stop-opacity=".16"/><stop offset=".5" stop-color="#fff" stop-opacity=".05"/><stop offset=".85" stop-color="#000" stop-opacity=".25"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></linearGradient>';
    s += '<radialGradient id="' + id + 'f" cx=".38" cy=".3" r=".9"><stop offset="0" stop-color="' + lighten(color, 0.3) + '"/><stop offset="1" stop-color="' + darken(color, 0.15) + '"/></radialGradient>';
    s += '<linearGradient id="' + id + 'a" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="var(--cr-accent,#38bdf8)" stop-opacity="0"/><stop offset=".5" stop-color="var(--cr-accent,#38bdf8)" stop-opacity=".55"/><stop offset="1" stop-color="var(--cr-accent,#38bdf8)" stop-opacity="0"/></linearGradient>';
    var body = 'M' + (cx - CW) + ',0 V' + T + ' A' + CW + ',' + RY + ' 0 0 0 ' + (cx + CW) + ',' + T + ' V0 Z';
    s += '<clipPath id="' + id + 'c"><path d="' + body + '"/></clipPath>';
    // one chip edge, drawn at y=0 and reused with <use>
    s += '<g id="' + id + 'e"><path d="' + body + '" fill="' + color + '"/>';
    s += '<g clip-path="url(#' + id + 'c)" fill="#fff" fill-opacity=".92">';
    [-0.8, -0.4, 0, 0.4, 0.8].forEach(function (k) { // edge spots, narrower toward the sides (perspective)
      var w = 5.2 * Math.cos(k * 1.05), x = cx + k * CW * 0.96 - w / 2;
      s += '<rect x="' + x.toFixed(2) + '" y="-1" width="' + w.toFixed(2) + '" height="' + (T + RY + 2) + '"/>';
    });
    s += '</g><path d="' + body + '" fill="url(#' + id + 's)"/>';
    s += '<path d="M' + (cx - CW) + ',' + T + ' A' + CW + ',' + RY + ' 0 0 0 ' + (cx + CW) + ',' + T + '" fill="none" stroke="#000" stroke-opacity=".5" stroke-width=".9"/></g>';
    s += '</defs>';

    // back wall of the slot
    s += '<rect x="2" y="0" width="' + (W - 4) + '" height="' + H + '" rx="7" fill="url(#' + id + 'b)" stroke="#000" stroke-width="1"/>';
    s += '<rect x="2.6" y="0.6" width="' + (W - 5.2) + '" height="' + (H - 1.2) + '" rx="6.4" fill="none" stroke="#fff" stroke-opacity=".07"/>';
    // floor shadow
    s += '<ellipse cx="' + cx + '" cy="' + (H - PAD_BOTTOM + 1) + '" rx="' + (CW + 2) + '" ry="' + (RY + 1.5) + '" fill="#000" opacity=".55"/>';

    // chips, bottom to top
    for (var i = 0; i < visible; i++) {
      var y = base - i * T, top = i === visible - 1;
      if (top) s += '<g class="cr-top">';
      s += '<use href="#' + id + 'e" transform="translate(0,' + y.toFixed(2) + ')"/>';
      if (top) {
        // face: colored disc, dashed rim spots, inner ring, squashed denomination
        s += '<ellipse cx="' + cx + '" cy="' + y.toFixed(2) + '" rx="' + CW + '" ry="' + RY + '" fill="url(#' + id + 'f)" stroke="' + darken(color, 0.45) + '" stroke-width=".8"/>';
        s += '<ellipse cx="' + cx + '" cy="' + y.toFixed(2) + '" rx="' + (CW - 2.6) + '" ry="' + (RY - 1.2) + '" fill="none" stroke="#fff" stroke-opacity=".95" stroke-width="1.7" stroke-dasharray="4.6 3.6"/>';
        s += '<ellipse cx="' + cx + '" cy="' + y.toFixed(2) + '" rx="' + (CW - 8.6) + '" ry="' + (RY - 3.1) + '" fill="' + darken(color, 0.08) + '" stroke="#fff" stroke-opacity=".6" stroke-width=".7"/>';
        s += '<text transform="translate(' + cx + ',' + (y + 0.4).toFixed(2) + ') scale(1,.5)" text-anchor="middle" dominant-baseline="central" font-family="Geist,ui-sans-serif,system-ui,sans-serif" font-weight="800" font-size="' + (label.length > 3 ? 8.2 : 10.5) + '" fill="' + ink + '">' + esc(label) + '</text>';
        s += '<ellipse cx="' + (cx - 7) + '" cy="' + (y - 2.4).toFixed(2) + '" rx="9" ry="1.9" fill="#fff" opacity=".22"/>';
        s += '<ellipse class="cr-glow" cx="' + cx + '" cy="' + y.toFixed(2) + '" rx="' + (CW + 1) + '" ry="' + (RY + 1) + '" fill="none" stroke="var(--cr-accent,#38bdf8)" stroke-width="1.6"/>';
        s += '</g>';
      }
    }
    // glass front of the slot
    s += '<rect x="2" y="0" width="' + (W - 4) + '" height="' + H + '" rx="7" fill="url(#' + id + 'g)" pointer-events="none"/>';
    s += '<path d="M6,6 V' + (H - 8) + '" stroke="#fff" stroke-opacity=".12" stroke-width="1.4" stroke-linecap="round"/>';
    s += '</svg>';
    return s;
  }

  /* ---------- component ---------- */
  function ChipRack(container, options) {
    if (!(this instanceof ChipRack)) return new ChipRack(container, options);
    if (typeof container === 'string') container = document.querySelector(container);
    if (!container) throw new Error('ChipRack: container not found');
    var o = options || {};
    this.el = container;
    this.uid = 'cr' + ++uid;
    this.opts = {
      capacity: Math.max(3, Math.min(24, o.capacity | 0 || 10)),
      mode: o.mode === 'tap' ? 'tap' : 'select', // select: one stack stays selected; tap: fires every time, nothing stays selected
      toggle: o.toggle !== false, // select mode: tapping the selected stack again deselects it
      showLabels: o.showLabels !== false,
      disableEmpty: o.disableEmpty !== false,
      format: typeof o.format === 'function' ? o.format : money,
      onSelect: typeof o.onSelect === 'function' ? o.onSelect : null,
      label: o.label || 'Chip rack',
    };
    this.min = o.min == null ? 0 : o.min;
    this.max = o.max == null ? Infinity : o.max;
    this.balance = null;
    this.selected = null;
    this._disabled = null;
    this._timers = new Set();
    this._setChips(o.chips || DEFAULT_CHIPS);
    this._build();
    if (o.selected != null) this.select(o.selected, { silent: true });
  }

  var P = ChipRack.prototype;

  P._setChips = function (list) {
    var cap = this.opts.capacity;
    this.chips = list.map(function (c) {
      var n = c.count == null ? cap : c.count;
      return { value: +c.value, color: c.color || '#64748b', label: c.label, count: n, disabled: !!c.disabled };
    });
  };

  P._build = function () {
    var el = this.el, self = this;
    el.classList.add('chip-rack');
    el.classList.toggle('no-labels', !this.opts.showLabels);
    el.innerHTML = '<div class="cr-plaque" role="note"></div><div class="cr-rack"><div class="cr-tray" role="group"></div></div>';
    this.plaque = el.querySelector('.cr-plaque');
    this.tray = el.querySelector('.cr-tray');
    this.tray.setAttribute('aria-label', this.opts.label);
    this._renderPlaque();
    this._renderSlots();
    this._onClick = function (e) {
      var b = e.target.closest('.cr-slot');
      if (b && !b.disabled) self._activate(+b.dataset.i, e);
    };
    this._onKey = function (e) {
      var b = e.target.closest('.cr-slot');
      if (!b) return;
      var dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (e.key === 'Home' || e.key === 'End') dir = e.key === 'Home' ? -99 : 99;
      if (!dir) return;
      var slots = [].slice.call(self.tray.querySelectorAll('.cr-slot:not(:disabled)'));
      var i = slots.indexOf(b), n = Math.abs(dir) > 1 ? (dir < 0 ? 0 : slots.length - 1) : Math.max(0, Math.min(slots.length - 1, i + dir));
      if (slots[n]) { slots[n].focus(); e.preventDefault(); }
    };
    this.tray.addEventListener('click', this._onClick);
    this.tray.addEventListener('keydown', this._onKey);
  };

  P._renderPlaque = function () {
    var f = this.opts.format;
    var mx = this.max >= UNLIMITED || this.max === Infinity ? '∞' : f(this.max);
    this.plaque.innerHTML = '<span>Min: <b>' + esc(f(this.min)) + '</b></span><span>Max: <b>' + esc(mx) + '</b></span>';
    this.plaque.setAttribute('aria-label', 'Minimum bet ' + f(this.min) + ', maximum bet ' + (mx === '∞' ? 'unlimited' : f(this.max)));
  };

  P._isDisabled = function (c) {
    if (c.disabled) return true;
    if (this.opts.disableEmpty && c.count <= 0) return true;
    if (this.balance != null && c.value > this.balance) return true;
    var d = this._disabled;
    if (typeof d === 'function') return !!d(c);
    if (Array.isArray(d)) return d.indexOf(c.value) >= 0;
    return false;
  };

  P._slotHTML = function (c, i) {
    var vis = Math.min(c.count, this.opts.capacity);
    var cnt = isFinite(c.count) && c.count < UNLIMITED ? '×' + c.count : '';
    return stackSVG(c, vis, this.opts.capacity, this.uid + '_' + i + '_') +
      '<span class="cr-lbl"><span class="cr-f">' + esc(this.opts.format(c.value)) + '</span><span class="cr-s">' + esc(this.opts.format === money ? '$' + short(c.value) : this.opts.format(c.value)) + '</span>' + (cnt ? '<span class="cr-cnt">' + cnt + '</span>' : '') + '</span>';
  };

  P._renderSlots = function () {
    var self = this;
    this.tray.innerHTML = '';
    this.chips.forEach(function (c, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cr-slot';
      b.dataset.i = i;
      b.dataset.value = c.value;
      b.style.setProperty('--chip', c.color);
      b.innerHTML = self._slotHTML(c, i);
      self.tray.appendChild(b);
      self._sync(b, c);
    });
  };

  P._sync = function (b, c) {
    var dis = this._isDisabled(c), sel = this.selected === c.value && !dis;
    b.disabled = dis;
    b.classList.toggle('is-empty', c.count <= 0);
    b.classList.toggle('is-selected', sel);
    b.setAttribute('aria-pressed', this.opts.mode === 'select' ? String(sel) : 'false');
    b.setAttribute('aria-label', this.opts.format(c.value) + ' chip' + (isFinite(c.count) && c.count < UNLIMITED ? ', ' + c.count + ' in stack' : ''));
  };

  P._refresh = function () {
    var self = this;
    if (this.selected != null) {
      var cur = this.chips.filter(function (c) { return c.value === self.selected; })[0];
      if (!cur || self._isDisabled(cur)) this.selected = null;
    }
    [].forEach.call(this.tray.children, function (b, i) { self._sync(b, self.chips[i]); });
  };

  P._anim = function (b, cls, ms) {
    var self = this;
    b.classList.remove(cls); void b.offsetWidth; b.classList.add(cls);
    var t = setTimeout(function () { self._timers.delete(t); b.classList.remove(cls); }, ms);
    this._timers.add(t);
  };

  P._ripple = function (b) {
    var r = document.createElement('i'), self = this;
    r.className = 'cr-ripple'; b.appendChild(r);
    var t = setTimeout(function () { self._timers.delete(t); r.remove(); }, 600);
    this._timers.add(t);
  };

  P._activate = function (i, event) {
    var c = this.chips[i], b = this.tray.children[i];
    var was = this.selected === c.value, selected;
    if (this.opts.mode === 'select') {
      selected = !(was && this.opts.toggle);
      this.selected = selected ? c.value : null;
      this._refresh();
    } else selected = true;
    this._anim(b, 'is-hop', 450);
    this._ripple(b);
    this._emit(c, i, selected, event);
  };

  P._emit = function (c, i, selected, event) {
    var chip = { value: c.value, color: c.color, label: c.label, count: c.count };
    var ctx = { index: i, selected: selected, rack: this, event: event || null };
    if (this.opts.onSelect) this.opts.onSelect(chip, ctx);
    this.el.dispatchEvent(new CustomEvent('chiprack:select', { bubbles: true, detail: { chip: chip, index: i, selected: selected } }));
  };

  /* ---------- public API ---------- */
  P.select = function (value, o) {
    var c = this.chips.filter(function (x) { return x.value === value; })[0];
    this.selected = c && !this._isDisabled(c) ? value : null;
    this._refresh();
    if (c && this.selected != null && !(o && o.silent)) this._emit(c, this.chips.indexOf(c), true, null);
    return this;
  };
  P.clearSelection = function () { this.selected = null; this._refresh(); return this; };
  P.getSelected = function () {
    var v = this.selected;
    return v == null ? null : this.chips.filter(function (c) { return c.value === v; })[0] || null;
  };
  P.setLimits = function (min, max) {
    if (min != null) this.min = min;
    if (max != null) this.max = max;
    this._renderPlaque();
    return this;
  };
  P.setChips = function (list) {
    this._setChips(list);
    this._renderSlots();
    this._refresh();
    return this;
  };
  P.setCount = function (value, n) {
    var idx = -1;
    this.chips.forEach(function (c, i) { if (c.value === value) idx = i; });
    if (idx < 0) return this;
    var c = this.chips[idx], b = this.tray.children[idx], old = c.count;
    c.count = Math.max(0, n);
    b.innerHTML = this._slotHTML(c, idx);
    this._refresh();
    if (c.count > old) this._anim(b, 'is-drop', 450);
    else if (c.count < old) this._anim(b, 'is-take', 350);
    return this;
  };
  P.addCount = function (value, d) {
    var c = this.chips.filter(function (x) { return x.value === value; })[0];
    return c ? this.setCount(value, c.count + d) : this;
  };
  // disable stacks by value list or predicate(chip); pass null to clear
  P.setDisabled = function (v) { this._disabled = v; this._refresh(); return this; };
  // disable every denomination bigger than what the player can afford (null = no limit)
  P.setBalance = function (n) { this.balance = n == null ? null : n; this._refresh(); return this; };
  P.destroy = function () {
    this._timers.forEach(clearTimeout);
    this.tray.removeEventListener('click', this._onClick);
    this.tray.removeEventListener('keydown', this._onKey);
    this.el.classList.remove('chip-rack', 'no-labels');
    this.el.innerHTML = '';
  };

  ChipRack.DEFAULT_CHIPS = DEFAULT_CHIPS;
  ChipRack.stackSVG = stackSVG; // exposed for custom layouts
  return ChipRack;
});
