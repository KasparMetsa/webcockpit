# 0011 — Stage 2 foundation: storage, cell grid, caret, status

- Status: Accepted
- Date: 2026-09-27

## Context

Stage 2 package A implements the settings store, theme, fonts and cell
grid fixed by ADR 0010. Building it raised technical questions ADR 0010
leaves open, and one point where measurement showed ADR 0010's wording
does not work (the cell height).

## Decision

### Storage

- **One database module.** `src/core/db.ts` opens `webcockpit` for every
  caller. Version 2 adds the `settings` store (out-of-line key `main`) and
  the `profiles` store (keyPath `name`) in one step, so package C needs no
  further upgrade. Every connection closes itself on `versionchange`, so
  a newer tab can upgrade while an older one is open.
- **Settings updates.** `update(patch)` deep-merges plain objects and
  replaces arrays whole; `update(draft => …)` edits a copy. Every result
  runs through `migrateSettings` (fill, clamp, repair), and an update
  that changes nothing notifies nobody. `get()` returns a frozen snapshot;
  each change is a new object.
- **Writes.** The first unsaved change starts a 200 ms timer (not reset by
  later changes), so a drag never waits more than 250 ms to be saved;
  `pagehide` flushes at once. Changes made while IndexedDB is loading are
  replayed on top of the loaded data.
- **Mirror.** `localStorage['webcockpit.appearance']` holds the appearance
  as JSON, written synchronously on change. An inline script in
  `index.html` paints the saved bg/fg before any module loads.
- **Safe mode** loads everything except the appearance from storage and
  writes nothing (IndexedDB or mirror) until the first change.
- **Layout data.** Types and the default model live in
  `src/layout/types.ts`. Every pane id appears in exactly one dock
  whether it is on or off; a damaged stored layout is repaired on load
  (duplicates dropped, missing panes appended to the right dock). Empty
  docks keep a size to open with: left 33 cells, bottom 10.

### Fonts and cell grid

- **JetBrains Mono ships as its "NL" (no ligatures) build**, family name
  `JetBrains Mono`. It lacks `✦✧⚔♦★✖`; its CSS stack falls back to the
  bundled DejaVu Sans Mono for them. Box, block and quadrant glyphs are in
  both fonts (checked by a unit test that reads the woff2 cmaps). Fonts
  are not subset (MUD text can be any Latin-1).
- **Cell height = ink height of `█`, rounded down** (amends ADR 0010,
  which said "line height rounded to whole pixels"). Measured in Chrome
  and Firefox: the browsers' line box and canvas `actualBoundingBox*` are
  both rounded outwards, and using them left a visible seam between rows
  of block glyphs (DejaVu 15 px: line box 18–19 px, ink 17.8 px). The ink
  height comes from the font file (`FontInfo.blockEm`); rounding it down
  makes each block reach into the next row.
- **Font size snaps to whole-pixel cells.** A fractional glyph advance
  leaves hairline seams between columns of block glyphs (Firefox places
  glyphs at sub-pixel offsets; Chrome rounds hinted advances past the
  glyph's ink). The CSS size is `round(size × advance) / advance`, so
  neighbouring size settings can look the same (DejaVu 16 and 17 → 10 px
  cells). The change is at most half a pixel of cell width.
- **Firefox residue.** Firefox's hinted advance can still miss the whole
  pixel by 1/60 px (DejaVu at 10 px cells never gives exactly 10). After
  the font loads the advance is measured and corrected with a
  letter-spacing of a few hundredths of a pixel (`--cell-ls`). Chrome
  needs none.
- `CellMetrics` owns `--font-size`, `--cell-w`, `--cell-h`, `--cell-ls`;
  `applyTheme` owns the rest. Package B must size chrome from
  `cells.get()` (or the CSS variables), never from `size`.

### Theme tokens

- UI roles, banner and UI-message colours are data in
  `src/theme/presets.ts` and set on `:root` by `applyTheme`, next to the
  terminal colours. Shade tokens use kebab case:
  `--pane-shade-{track,dim,mid,pane-bg,vtext,label,glow}`. Every tint is
  also exposed as `--pane-bg-<tint>` / `--pane-border-<tint>` (`none` for
  `black`) for the Options swatches.

### Custom caret

- A `.wc-caret` element over the input, moved with `translateX(column ×
  cell width − scrollLeft)` in an animation frame after input, selection,
  focus and scroll events. The keydown handler only schedules the frame
  after the command has been sent, so Enter → `send()` does no caret work.
- Hidden while a range is selected (as the native caret is, e.g. in
  recall state). Blurred: a block becomes hollow, beam and underline hide.
- Blink is a 1 s `steps()` opacity animation. Each move swaps between two
  identical keyframe names, which restarts the cycle so the caret is
  visible right after it moves.
- Columns count code points; double-width characters are not handled.

### Status

- `app.status` is a read-only observable (`get()`, `subscribe()`) of
  connection state, replay flag, character, Link RTT and suspect flag,
  capture text and XML. `formatStatus` gives the old status-line text,
  which is mirrored to `data-status` on the app element for the browser
  tests.
- The dev server exposes `window.__wc = { app, settings, cells }` for
  tests and the console; production builds do not.

## Consequences

- A font file change must update `blockEm`/`advanceEm` in
  `src/theme/fonts.ts` (values and how to read them are in
  `public/fonts/README.md`).
- The owner may notice that some adjacent font sizes look identical.
  That is the price of seamless block art; revisit if it bothers.
