(function () {
  var TOTAL = 312, left = TOTAL, disc = 0;
  var shoe = new CardShoe('#shoe', { total: TOTAL, remaining: TOTAL }), tray = new DiscardTray('#discard', { total: TOTAL });
  function sync() { shoe.setRemaining(left); tray.setCount(disc); }
  document.getElementById('deal').onclick = function () { left -= 2; sync(); };
  document.getElementById('round').onclick = function () { left -= 8; disc += 8; sync(); };
  document.getElementById('reset').onclick = function () { left = TOTAL; disc = 0; sync(); };
  document.getElementById('big').onclick = function () { left = TOTAL * 0.25; disc = TOTAL * 0.75 | 0; sync(); };
  window.__d = { shoe: shoe, tray: tray, set: function (l, d) { left = l; disc = d; sync(); } };
})();
