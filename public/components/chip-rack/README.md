# Chip rack

Dealer chip tray with a Min / Max plaque. Vanilla JS, CSS and inline SVG only: no dependencies, no images, no backend. It does not touch the engine, API or SSE code; it just calls your callback.

```html
<link rel="stylesheet" href="/components/chip-rack/chip-rack.css">
<div id="rack"></div>
<script src="/components/chip-rack/chip-rack.js"></script>
<script>
  const rack = new ChipRack('#rack', {
    min: 10, max: 500,
    onSelect(chip, { selected }) { console.log(chip.value, selected); },
  });
</script>
```

Try it at `/components/chip-rack/demo.html`.

## Options

| option | default | |
|---|---|---|
| `chips` | 9 casino colours, $1 to $5K | `[{ value, color, count, label, disabled }]` (`count` defaults to `capacity`) |
| `min`, `max` | `0`, `Infinity` | shown on the plaque (`Infinity` or 1e12 renders as ∞) |
| `capacity` | `10` | slot height in chips; stacks taller than this are drawn full and show `×count` |
| `mode` | `'select'` | `'select'`: one stack stays selected. `'tap'`: fires on every tap, nothing stays selected (use for "add chip to bet") |
| `toggle` | `true` | select mode: tapping the selected stack deselects it |
| `showLabels` | `true` | denomination and count under each slot |
| `disableEmpty` | `true` | stacks with `count: 0` can't be chosen |
| `format` | `$1,234` | `(n) => string` for plaque and labels |
| `selected` | none | initially selected value |
| `onSelect(chip, ctx)` | none | `chip = { value, color, label, count }`, `ctx = { index, selected, rack, event }` |

A `chiprack:select` CustomEvent (`detail: { chip, index, selected }`) bubbles from the container too.

## Methods

`select(value, { silent })`, `clearSelection()`, `getSelected()`, `setLimits(min, max)`, `setChips(list)`, `setCount(value, n)`, `addCount(value, delta)`, `setBalance(n)` (disables denominations above what the player can afford), `setDisabled(valuesOrPredicate | null)`, `destroy()`.

Keyboard: Tab to a stack, Enter/Space to pick it, arrow keys / Home / End to move.

## Theming

`--cr-accent` (selection colour, defaults to the site's `--cyan`), `--cr-max` (max width, default 680px). The rack scales with its container and switches to compact labels when narrow.

## Wiring it to the game

Blackjack, after the player's bet input exists (`placeBet` sends `{ type: 'bet', amount }`):

```js
const rack = new ChipRack('#rack', {
  mode: 'tap', min: v.limits.min, max: v.limits.max,
  onSelect: (chip) => setBetAmount(Math.min(currentBet + chip.value, myBalance)),
});
rack.setBalance(myBalance);
```

Poker raise slider (`pkSetTo(view, n)`):

```js
new ChipRack('#pkRack', { mode: 'tap', min: pk.bb, max: legal.raise.max,
  onSelect: (chip) => pkSetTo(view, pkState.to + chip.value) });
```

Update `setLimits` / `setBalance` from your render function when the view changes.
