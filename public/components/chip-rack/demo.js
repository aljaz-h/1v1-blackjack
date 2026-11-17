(function () {
  var log = document.getElementById('log'), bet = 0, betEl = document.getElementById('bet');
  function say(t) { log.textContent = t + '\n' + log.textContent.split('\n').slice(0, 5).join('\n'); }
  var A = new ChipRack('#rackA', { min: 0, max: 100, onSelect: function (c, x) { say('select ' + c.value + ' selected=' + x.selected); } });
  var B = new ChipRack('#rackB', { mode: 'tap', min: 10, max: 500, onSelect: function (c) { bet += c.value; betEl.textContent = bet; say('tap +' + c.value); } });
  var C = new ChipRack('#rackC', { min: 10, max: 500, chips: ChipRack.DEFAULT_CHIPS.slice(0, 6), capacity: 8 });
  document.getElementById('clr').onclick = function () { bet = 0; betEl.textContent = 0; };
  document.getElementById('b1').onclick = function () { [A, B, C].forEach(function (r) { r.setBalance(60); }); };
  document.getElementById('b2').onclick = function () { [A, B, C].forEach(function (r) { r.setBalance(5000); }); };
  document.getElementById('b3').onclick = function () { A.setLimits(5, Infinity); };
  document.getElementById('b4').onclick = function () { A.addCount(25, 1); };
  document.getElementById('b5').onclick = function () { A.addCount(25, -1); };
  window.__racks = { A: A, B: B, C: C };
})();
