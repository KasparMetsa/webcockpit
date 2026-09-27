# Stage 2 — Look and layout

> Status: Owner testing (build done 2026-09-27).
> Source: spec §5 row 2, §1.3 (cell grid, cold start), §1.4, §2.3, §2.5,
> §2.6 (skeleton), Inv §2.1, §3, §4, §10. ADR 0010.

## Goal

WebCockpit looks and feels like Cockpit. Opening the link shows the start
page (banner, menu, quote). Enter MUME shows the cockpit: game pane,
input line and the right column of framed panes in Cockpit's default
layout. Panes can be dragged between docks, reordered, resized and
toggled. Appearance (font, size, padding, colours, cursor) applies live.
ESC opens the in-game menu, which also opens by itself on disconnect.

## Scope

In:

- **Settings store** (one, IndexedDB, live-applied everywhere; ADR 0010):
  appearance, pane layout, per-pane colour and border, corner style,
  selected profile.
- **Visual system:** CSS tokens from Inv §10.9; terminal palette with
  fg/bg presets (Inv §10.2) and the ANSI 16 editable; UI colour roles
  (Inv §10.3); pane tints, borders, shade ramp and light-background
  transforms (Inv §10.4–10.5) as a tested colour toolkit.
- **Bundled fonts:** DejaVu Sans Mono (default) and JetBrains Mono,
  regular + bold, woff2, self-hosted, with licence files. Glyph coverage
  checked for every glyph in Inv §10.1.
- **Cell grid:** measured cell width/height; all chrome sized in whole
  cells.
- **Appearance settings:** font family, size 6–32, padding 0–40 (step 2),
  font colour and background presets, ANSI palette, cursor style
  (block/beam/underline) and blink. Live preview box. A safe way back to
  defaults if a bad setting makes the page unusable (`?safe` URL).
- **Custom caret** in the input line (a native caret cannot be block or
  underline).
- **Pane frame** (Inv §2.1 "Pane frame"): half-block glyph art, label,
  corner style Auto/Quadrant/Block, per-pane border on/off.
- **Panes (empty shells):** Character, Timers, Group, Comm, UI. Content
  comes in stages 4–5. The dev pane is not built.
- **Default layout:** game left, right dock 33 cells wide with the five
  panes in Cockpit's order and default heights; input full width at the
  bottom with the 7-cell clock strip reserved.
- **Docking engine** (ADR 0010): left, right and bottom docks; drag a
  pane by its title row to a dock or a position in a dock; reorder;
  resize dock width/height and pane sizes by dragging the gaps; toggles;
  height allocation, survivor selection and narrow collapse after
  Inv §2.1; minimum-size screen below 60×18 cells; reset layout.
- **Start page** (Inv §3.2–3.5, §3.11): banner with twinkling starfield
  (MUME/COCKPIT, owner decision 2026-09-27), menu, Tolkien quote, footer,
  navigation grammar (Inv §3.3), About. History, Spotlights and Credits
  are shown dimmed ("stage 6/7").
- **Profiles:** stored as named tt++ text records. Profile frame with
  SELECT, NEW (blank or copy), RENAME, DELETE, IMPORT, EXPORT, BACK.
  EDIT is dimmed until stage 3. `default` seeded from one template with
  the ten numpad macros (ADR 0005 names).
- **Options:** Panes → General (pane × colour grid, Border column, corner
  style), Appearance (above). Readability/Scripts/Connection are not
  shown.
- **ESC menu skeleton** (Inv §4): 80 %×80 % overlay, status header
  (`Profile · Link`), banner at 6 Hz, Continue, Reconnect, Profile
  (dimmed until stage 3), Options (Panes, live), Exit session (confirm,
  no rating until stage 6; returns to the start page). Auto-open on
  disconnect with dedup, reconnect suppression and bootstrap guard.
  Focus trapped while open, returned to the input on close.
- **ESC key:** leaves scrollback first (stage 1), otherwise opens the menu.
- **Temporary status line removed.** Link and capture state move into the
  ESC menu header.

Out: pane content (stages 4–5), clock (stage 4), profile editor and
macros (stage 3), rating, History/Statistics/Spotlights/Credits screens
(stages 6–7), dev pane, tabs.

## Tasks

- [x] Stage file and ADR 0010.
- [x] A. Foundation: settings store, tokens and theme application, fonts,
      cell metrics, colour toolkit, custom caret, `?safe`, remove status
      line. Unit tests. (ADR 0011; APIs: `src/settings`, `src/theme/*`,
      `src/layout/types.ts`, `app.status`.)
- [x] B. Layout: docking engine (model + allocation, pure and tested),
      pane frame, pane shells, drag/resize/toggle, narrow collapse, size
      gate. Unit + e2e tests. (ADR 0012; APIs: `src/layout/allocate.ts`,
      `src/layout/model.ts`, `src/layout/cockpit.ts`, `src/panes/*`,
      `app.cockpit`.)
- [x] C. Chrome: TUI kit (Preact), banner, start page, profiles store and
      frame, Options (Panes grid, Appearance), About, ESC menu, app flow
      start page ↔ cockpit. Unit + e2e tests. (ADR 0013; cold start
      264 ms median on throttled broadband.)
- [x] Benchmarks still pass (§1.3), cold start < 1 s (package C, after
      merge; Chromium burst worst frame 39–57 ms is borderline, see ADR 0012).
- [x] Main-session verification in a browser (334 unit, 60 e2e;
      screenshots of start page, profile, cockpit, frames, ESC menu).
- [x] Test guide ready.
- [ ] Owner test.

## Live checks for the owner

1. **Idle timeout** (carried from stage 1): stay idle 5+ minutes; does
   the link survive, and does `Link:` in the ESC menu keep updating?
2. **Auto-open on disconnect:** after a real disconnect (e.g. `quit`),
   the ESC menu opens with Reconnect selected.

## Test guide

**Start:** `cd ~/proj/webcockpit && npm install && npm run dev`, then open
http://localhost:5173/ in Firefox or Chrome. The page now opens on the
start page; nothing connects until you choose Enter MUME.

**Start page:**

1. Banner, twinkling stars, menu, a Tolkien quote, footer. Arrow keys,
   Enter/Space, mouse hover and click. History, Spotlights and Credits
   are dimmed (later stages).
2. **Profile:** create (blank or copy), rename, delete, export (downloads
   `<name>.tin`), import a `.tin` file. EDIT is dimmed until stage 3.
3. **Options → Panes:** the pane × colour grid, Border column, corner
   style, Reset layout.
4. **Options → Appearance:** font (DejaVu Sans Mono / JetBrains Mono),
   size, padding, font colour, background, ANSI palette, cursor style and
   blink. Everything applies at once. If a setting makes the page
   unusable, open http://localhost:5173/?safe.
5. **About.**

**Cockpit (live):**

1. Enter MUME, log in and play. Right column: Character, Timers, Group,
   Comm, UI (empty frames until stages 4–5).
2. Arrange panes: drag a pane by its title row to the left edge, the
   bottom (under the game pane) or another place in a column. Drag the
   gaps to resize a dock or two neighbouring panes. Reload: the layout
   is kept.
3. Make the window narrow and small: side docks collapse; below 60×18
   cells a "Window too small" notice shows.
4. ESC opens the menu (ESC first leaves scrollback if you scrolled up).
   Header: profile, `Link:` and capture state. Options work live from
   here too. Exit session goes back to the start page.
5. Live checks 1–2 above (idle timeout; `quit` → menu opens with
   Reconnect selected).

**Offline:** http://localhost:5173/?fixture=Rasta/2026-09-18T18-11-42.log&speed=0
goes straight to the cockpit and replays a log.

**Feedback wanted:**

- Does the start page, the pane frames and the ESC menu look and feel
  like Cockpit? What differs that bothers you?
- Docking: is dragging and resizing natural? Anything missing (e.g.
  tabs, other dock positions)?
- Fonts and the cell grid: size steps (some neighbouring sizes look the
  same, because cells snap to whole pixels), sharpness, cursor.
- The Tolkien quotes (`src/chrome/quotes.ts`) — proofread if you like.

Known in stage 2: panes are empty; the chrome keeps dark colours on the
"paper" background; the Panes grid is clipped near the 60-column
minimum; `[SYSTEM]` lines in the game output remain until the UI pane
gets content (stage 4).

## Owner feedback

(After testing.)

### 2026-09-27 — first test

1. Corner style: always quadrant. Remove the setting (Options → Panes and
   the settings model).
2. Docking: panes can dock anywhere — right, left, bottom **and top**.
   Panes can also **float**: free position and free size anywhere on the
   screen. Docked or floating is per pane (main-session decision; a
   floating pane is dropped over the game area, a docked one on a screen
   edge). Default stays: all docked in the right column as now.
3. Fonts and font sizes work well.
4. Quotes: assume they are good.
5. Nothing else to remark on.

Follow-up tasks:

- [x] Remove corner-style setting; frames always quadrant.
- [x] Top dock.
- [x] Floating panes: drag out of a dock to float, move, resize from
      edges/corners, bring to front, dock again by dropping on an edge;
      persisted; clamped to the window on resize. (ADR 0014)
