# 0013 — Stage 2 chrome: TUI kit, start page, ESC menu, page flow

- Status: Accepted
- Date: 2026-09-27

## Context

Stage 2 package C builds the chrome fixed by ADR 0010 ("Chrome", "Page
flow", "Profiles"): the TUI kit, banner, start page, profiles, Options,
About, the ESC menu and the flow between the start page and the cockpit.
Building it raised the questions below, which ADR 0010 leaves open.

## Decision

### Loading

- Preact 10 (MIT) renders the chrome. Everything under `src/chrome/` is
  one chunk loaded with `import('../chrome')` from `src/app/shell.ts`;
  the game output and input never import it. On `/` the chunk loads at
  once (the start page is chrome). In `?replay` / `?fixture=` it is
  prefetched when idle; in `?bench` it loads on the first ESC, so the
  benchmark measures the stage-1 path.
- Production build: main 54 kB (18 kB gzip) + shared 18 kB (7 kB) +
  chrome 52 kB (20 kB) + CSS 9 kB (2 kB), plus one font family (≈ 290 kB
  woff2, preloaded). Cold start (`vite preview`, Chromium, 20 Mbit/s,
  40 ms RTT, no cache): menu on screen after a median of 264 ms, with the
  web font 336 ms. Localhost: 128 ms (Chromium), 241 ms (Firefox).

### Kit (`src/chrome/kit/`)

- **Frame stack.** Every pushed frame stays mounted and is hidden when
  not on top, so a frame keeps its cursor while a sub-page is open (no
  cursor bookkeeping). The flash message belongs to the stack: set by
  any frame, shown by the top frame's flash row, cleared after 3 s or
  when a frame is pushed (not popped, so "Created …" survives the pop).
- **Keys.** While a surface is active, one `keydown` listener on the
  window in the capture phase routes every key to the top frame and
  stops propagation. The game input listens on the document, so it never
  sees chrome keys and `InputPane` needs no change. Unhandled ESC pops
  (root: start page no-op, ESC menu close). Nav keys have their default
  prevented except inside a text field.
- **Focus.** The stack host is focused on every frame change unless the
  top frame holds the focus (a text field). A `focusin` trap pulls focus
  back while active; `mouseup` is stopped at the host because the input
  refocuses itself on document `mouseup`.
- Key listeners and text-field focus are attached in layout effects, and
  surfaces re-read their size after every render, so a key pressed right
  after a frame opens is never lost (a real race seen in the browser
  tests).
- **Grid.** A surface's grid is `floor(size / cell)` cells; the grid box
  is centred in whole pixels and every indent is `n × --cell-w`. Hover is
  CSS `:hover` on row elements only, which gives the hover-clear
  invariant for free.
- Cyclers and steppers: `<<` / `>>` on the cursor row are clickable
  (back / forward), so every value can be changed with the mouse.

### Banner

- Wordmark and star list per Inv §10.7 (owner decision: MUME + COCKPIT).
- Twinkle: a star shows its base look, one tier up while its sine is
  above 0.82 (a ✦/✧ also swaps glyph there) and one tier down while it
  is below −0.82, clamped. A star whose cell lies inside a wordmark's
  column span is static.
- One `setInterval` (12 Hz start page, 6 Hz ESC menu), running only while
  the banner's frame is the top of an active surface; a tick does nothing
  while `document.hidden` and only writes star spans whose class or
  glyph changed.

### Start page

- Top-anchored like Cockpit: blank, banner, blank, menu, flash row,
  quote, attribution; footer on the last row. The banner is dropped when
  it does not fit with the rest.
- History, Spotlights and Credits are selectable but dimmed; activating
  one flashes "Coming in a later stage." (C_HINT).
- Our own list of 21 Tolkien quotes; one per page load.
- Below 60 × 18 cells the start page shows "Window too small" and
  swallows keys (the hidden cockpit's input must never get them).

### Profiles

- `ProfileStore` wraps the `profiles` store; without IndexedDB it keeps a
  memory map for the page. A rule violation throws `ProfileError` with a
  user-facing message; a failed transaction is aborted.
- Rename keeps `created`; the selected profile follows a rename; deleting
  the selected profile selects `default`. NEW, IMPORT and copy make the
  new profile the selected one.
- The template uses ADR 0005 names. The vt100 application-keypad mapping
  behind Cockpit's escapes was checked: `ESC O p`…`ESC O y` are keypad
  0–9, `ESC O k` is `+`, `ESC O m` is `−`.
- Import names: file name without extension, non-name runs → `_`, a
  leading non-letter gets a `p` prefix, cut to 32, `_2`, `_3` … on a
  collision.

### Options

- **Appearance is offered in both the start page and the ESC menu**
  (Cockpit's popup has no terminal settings only because a relaunch was
  needed). Everything applies live; there is no Apply, and Back never
  discards.
- Options → Panes opens the pane × colour grid directly (titled
  "Panes"). The Panes sub-hub (General, Timers, Communication, Group)
  appears when a second pane page exists (stages 4–5).
- Grid cells are `[X]███` + one space, Border last, as in Cockpit.
  Hovering a cell moves the cursor there.
- ANSI palette: two rows of 8 swatches (normal, bright); Enter or a
  second click opens a hex field (`#rgb` / `#rrggbb`). Reset palette and
  Reset appearance act at once with a flash, no confirm (both are easy to
  redo and `?safe` exists).

### ESC menu

- A fixed layer over the whole window; the box is 80 % × 80 % in whole
  cells, centred, with a `┌─┐│└┘` border in C_SECTION glyphs and the
  terminal background. Clicks outside the box do nothing.
- Rows: Continue (only while connected), Reconnect, Profile (dimmed until
  stage 3, flashes), Options, Exit session. Continue is pre-selected when
  connected, Reconnect otherwise and on auto-open.
- Header `Profile: <name>  ·  Link: <ms>ms  ·  <capture>` in C_HINT; the
  Link part is C_ERR while unknown (`Link: —`) and C_YELLOW when suspect.
- **Auto-open** only on a transition from `login`/`playing` to
  `disconnected` of a live (not replay) connection, only while the
  cockpit is shown and the menu is closed, only after some connection
  reached `login`, and never for a disconnect the user asked for:
  `#reconnect`, `#disconnect`, Exit session, a replay starting.

### Page flow

- The App is built on the first Enter MUME and reused for later sessions
  in the tab. Exit session disconnects, hides the cockpit and shows the
  start page (a fresh frame stack); Enter MUME shows it again and
  connects. The game output keeps its scrollback across sessions (the
  "Connecting to MUME..." line separates them), which also avoids an
  output-reset API. Views switch with `style.display` in one task, so
  there is no blank frame.
- `src/app/app.ts` gained only an `onEscape` option passed to
  `InputPane`. `main.ts` hands everything after the theme set-up to
  `Shell`. `window.__wc` (dev) adds `shell`; `__wc.app` is a getter (the
  cockpit exists only after Enter MUME on `/`).

## Consequences

- The cockpit (package B) must keep `app.el`, `app.input.focus()`,
  `app.status`, `app.bus`, `app.onCommand`, `app.connectLive()` and
  `app.session`; `Shell.ensureApp()` is the one place that builds the App.
- Browser tests that open `/` now land on the start page and press Enter
  to connect.
- A later profile editor (stage 3) plugs in as a frame pushed from the
  EDIT button and the ESC menu's Profile row.
