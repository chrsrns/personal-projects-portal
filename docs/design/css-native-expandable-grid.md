# CSS-Native Expandable Grid Row Design

## Summary

A card in a multi-column grid can be expanded to fill its entire row using only
CSS transitions, provided the card does not change its grid cell. Instead, the
parent row's `grid-template-columns` is transitioned so the active column becomes
`1fr` and the others collapse to `0fr`. The card's own `grid-template-rows` is
transitioned to reveal an expanded detail track. This avoids the discrete
`grid-column`/`grid-row` properties, which cannot be interpolated.

## Why `grid-column` cannot be used

`grid-column` and `grid-row` have a discrete animation type [^1]. Toggling
`col-span-full` or `grid-column: 1 / -1` makes the card snap to its new area; the
browser cannot tween it.

`grid-template-columns` and `grid-template-rows` are different. They can be
interpolated as a simple list of length, percentage, or calc values, provided the
number of tracks stays the same [^2][^3]. The `0fr` to `1fr` technique works
because both values are `fr` units [^4].

## Proposed layout

- Outer container is a vertical stack of `.row` elements.
- Each `.row` is an independent three-column grid.
- Each `.cell` inside a row is also a grid, with a collapsed summary and an
  expanded detail as two tracks.
- When a cell expands, the parent `.row` transitions `grid-template-columns` to
  `0fr 1fr 0fr` (or `1fr 0fr 0fr` / `0fr 0fr 1fr` depending on which cell is
  active), the active cell transitions `grid-template-rows` from `1fr 0fr` to
  `0fr 1fr`, and the row `gap` shrinks to `0` [^5][^6].

## Markup

```html
<ul class="rows">
  <li class="row">
    <article class="cell">
      <div class="collapsed">…</div>
      <div class="expanded">…</div>
    </article>
    <article class="cell">
      <div class="collapsed">…</div>
      <div class="expanded">…</div>
    </article>
    <article class="cell">
      <div class="collapsed">…</div>
      <div class="expanded">…</div>
    </article>
  </li>
</ul>
```

## CSS

```css
.row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 1rem;
  transition: grid-template-columns 0.3s ease, gap 0.3s ease;
}

.row.expanded-1 { grid-template-columns: 1fr 0fr 0fr; gap: 0; }
.row.expanded-2 { grid-template-columns: 0fr 1fr 0fr; gap: 0; }
.row.expanded-3 { grid-template-columns: 0fr 0fr 1fr; gap: 0; }

.cell {
  display: grid;
  grid-template-rows: 1fr 0fr;
  transition: grid-template-rows 0.3s ease;
  min-height: 0;
}

.cell.expanded {
  grid-template-rows: 0fr 1fr;
}

.collapsed,
.expanded {
  min-height: 0;
  overflow: hidden;
}

/* Hide siblings when any row is expanded */
.row[class^="expanded-"] .cell:not(.expanded) {
  visibility: hidden;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition-duration: 0.01ms !important;
  }
}
```

## JavaScript

```js
const expand = (cell) => {
  const row = cell.closest(".row");
  const index = Array.from(row.children).indexOf(cell) + 1;

  document
    .querySelectorAll(".cell.expanded")
    .forEach((c) => c.classList.remove("expanded"));
  document
    .querySelectorAll('.row[class^="expanded-"]')
    .forEach((r) => r.classList.remove("expanded-1", "expanded-2", "expanded-3"));

  cell.classList.add("expanded");
  row.classList.add(`expanded-${index}`);
};
```

## Limitations

- Sibling cards in the same row shrink to zero width and become hidden; they do
  not wrap to the next row. Moving surrounding items smoothly is a layout
  reflow, not a track-size transition; it requires View Transitions or a FLIP
  calculation.
- The active card expands from its original column (left, center, or right)
  because `grid-column` cannot be animated.
- Both states of a track must use the same unit type. `auto` cannot be
  interpolated with `1fr`; the collapsed/expanded detail must both use `fr`
  units.
- `visibility` and `display` are discrete. Use `transition-behavior:
  allow-discrete` if you want them to transition, or rely on `overflow: hidden`
  clipping.

## References

[^1]: MDN, *grid-column* — "Animation type: discrete". https://developer.mozilla.org/en-US/docs/Web/CSS/grid-column
[^2]: MDN, *grid-template-rows* — "Animation type: simple list of length, percentage, or calc...". https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-rows
[^3]: web.dev, *CSS animated grid layouts*. https://web.dev/articles/css-animated-grid-layouts
[^4]: CSS-Tricks, *CSS Grid Can Do Auto Height Transitions*. https://css-tricks.com/css-grid-can-do-auto-height-transitions/
[^5]: MDN, *gap* — "Animation type: a length, percentage or calc()". https://developer.mozilla.org/en-US/docs/Web/CSS/gap
[^6]: MDN, *transition-behavior*. https://developer.mozilla.org/en-US/docs/Web/CSS/transition-behavior
