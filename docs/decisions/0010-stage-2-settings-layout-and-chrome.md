# 0010 — Stage 2: settings, theme, docking and chrome

- Status: Accepted
- Date: 2026-09-27

## Context

Stage 2 (spec §2.3, §2.5, §2.6) adds the visual system, the pane layout,
the start page and the ESC menu. The spec leaves the settings model, the
docking model, font delivery and the page flow open. Three builders work
in parallel on them, so the shared contracts are fixed here.

## Decision

### Settings

- **One store, one object.** `src/settings/` holds a typed `Settings`
  object with a single `DEFAULT_SETTINGS` (Inv §3.1 lesson: one default
  object seeds storage and fills missing keys on upgrade).
- Persisted in IndexedDB (`webcockpit` database, `settings` store, key
  `main`), written on every change (debounced ≤ 250 ms, flushed on
  `pagehide`). A copy of the appearance part is mirrored to
  `localStorage` so the first paint uses the right font and colours
  (a convenience, ADR 0006).
- `SettingsStore` API: `get()`, `update(patch | fn)`, `subscribe(fn)`.
  Every surface (start page, ESC menu, drag in the layout) writes through
  it and every change applies live. There is no launcher/popup asymmetry
  (Inv §3.9).
- Shape (sketch; the code is authoritative):

  ```ts
  appearance: { font: 'dejavu' | 'jetbrains'; size: number /*6–32*/;
    padding: number /*0–40*/; fg: string; bg: string;
    ansi: string[16]; cursorStyle: 'block' | 'beam' | 'underline';
    cursorBlink: boolean }
  panes: Record<PaneId, { on: boolean; color: PaneColor; border: boolean }>
  corners: 'auto' | 'quadrant' | 'block'
  layout: LayoutModel            // see Docking
  profile: string                // selected profile name
  ```

  `PaneId` = `character | timers | group | comm | ui`.
  `PaneColor` = `black | red | green | blue | grey | orange | purple`.
- **Safe mode.** `?safe` starts with default appearance (not saved until
  the user changes something), so a bad font size can always be undone
  (Inv §3.1 lesson).

### Theme

- All colours are CSS custom properties set on `:root` from the settings
  (`--term-fg`, `--term-bg`, `--ansi-0..15`, the Inv §10.9 roles). The
  stage-1 `--wc-*` names are renamed to these.
- Per pane: `--pane-bg`, `--pane-border` and the seven shade tokens are
  set on the pane element; `data-light` marks a light effective
  background. They are recomputed on every settings change, never cached
  (Inv §10.5).
- The colour toolkit (`src/theme/color.ts`) is pure: hex↔HSL, border
  lift, shade ramp, `lightShift`, `washout`, `darkInk`. Unit tested.

### Fonts and cell grid

- DejaVu Sans Mono (Bitstream Vera/DejaVu licence) and JetBrains Mono
  (OFL 1.1), regular and bold, as woff2 in `public/fonts/` with their
  licence files. Only the selected family is preloaded; `font-display:
  block` avoids a reflow of the cell grid.
- Cell size is measured from the rendered font (width of a run of `█`,
  line height rounded to whole pixels) and published as `--cell-w` and
  `--cell-h`. Chrome sizes are whole cells. The line height is the cell
  height, so box and block glyphs tile.
- Corner style `auto` resolves to quadrant for both bundled fonts.

### Docking

- **Model** (`src/layout/model.ts`, pure, serialisable):

  ```ts
  LayoutModel = {
    docks: { left: DockState; right: DockState; bottom: DockState };
  }
  DockState = { size: number;              // cells: width (L/R), height (bottom)
                panes: { id: PaneId; desired: number }[] }  // order = stack order
  ```

  Left/right docks stack panes vertically; the bottom dock (above the
  input line, under the game pane) lays them out side by side. `desired`
  is content rows (vertical) or columns (bottom).
- **Default:** right dock 33 cells, panes in Cockpit order with desired
  heights 9/8/6/10/5; left and bottom empty.
- **Allocation** follows Inv §2.1 "Heights" per dock: desired if it fits
  (leftover to the highest-priority pane, `ui > character > comm >
  timers > group`), else Character reserved first and the rest scaled
  between minimum and desired, else survivors dropped in the order
  `group, timers, comm, character, ui`. The on/off setting is never
  changed by allocation. Allocation runs in one pass per frame after a
  resize or settings change.
- **Interaction:** drag a pane by its title row; drop zones show an
  insertion bar in the target dock; dropping on an empty dock's edge
  opens that dock. Dragging a gap resizes the adjacent panes or the
  dock; drag end saves `desired`/`size`. The game pane keeps ≥ 30 cells
  wide and ≥ 5 rows high; narrow collapse hides side docks and restores
  them when the window widens. Below 60×18 cells a "Window too small"
  screen replaces the view.
- No tabs, no floating panes (spec §2.3).
- `Reset layout` in Options → Panes restores the default model.

### Chrome

- The start page, ESC menu and Options pages are Preact components on
  the cell grid, loaded as a separate chunk from the hot path. The game
  output and input stay plain TypeScript.
- A small TUI kit (`src/chrome/kit/`) implements the Inv §10.6 grammar:
  title block, footer, `<< label >>` menu rows, filled buttons,
  swatch/checkbox cells, table, flash row, keyboard zones, hover-clear.
- Banner stars animate with one `setInterval` at 12 Hz (start page) or
  6 Hz (ESC menu), only while visible, and change only the star spans.
- Tolkien quotes are our own list (not copied from Cockpit's file).

### Page flow

- `/` shows the start page. Enter MUME builds the cockpit and connects;
  Exit session closes the connection and returns to the start page in
  the same tab without a blank frame. `?replay`, `?fixture=` and
  `?bench` go straight to the cockpit, as in stage 1.
- ESC in the input: leave scrollback if scrolled, otherwise open the ESC
  menu. ESC is never passed to user macros.
- The temporary status line is removed. `Link:` and the capture state
  are shown in the ESC menu header.

### Profiles

- IndexedDB store `profiles`, key = name: `{ name, text, created,
  modified }`. Names: start with a letter; letters, digits, `_`; ≤ 32.
  `default` is seeded from `src/profiles/template.tin` (header comment and
  ten numpad macros in ADR 0005 names) and cannot be renamed or deleted.
- Export downloads `<name>.tin`. Import reads a `.tin`/`.txt` file,
  takes the name from the file name (sanitised; `_2`, `_3` … on a
  collision) and makes it the selected profile. The text is stored
  verbatim; parsing starts in stage 3.

## Rationale

- One live settings object removes Cockpit's launcher/popup split, which
  only existed because tmux panes were not running yet.
- A pure layout model makes allocation and docking testable without a
  browser, and lets the settings store persist it as plain data.
- Preact only on chrome keeps the output and input paths as fast as in
  stage 1 (spec §1.3).

## Consequences

- The stage-1 `StatusLine` and its tests go away.
- Every later pane (stages 4–5) plugs into the pane shell: it gets a
  content element, its inner size in cells and its theme tokens.
- If more than three docks or tabs are wanted, the model grows a new
  dock kind; stored layouts are migrated through `DEFAULT_SETTINGS`.
