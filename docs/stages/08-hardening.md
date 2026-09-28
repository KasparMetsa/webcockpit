# Stage 8 — Hardening → v1

> Status: In progress (part A).
> Source: spec §5 row 8; owner brief 2026-09-28 (part A, viewer
> settings in RUN LOG and the HTML replay). ADR 0021.

## Goal

v1: fixes from PvP testing, a performance pass and polish. The owner
plays several live PvP sessions and gives the v1 verdict.

Part A (owner request, built first): whoever watches a log — in RUN LOG
or in an exported HTML replay — starts from exactly what the player saw,
and can then make it their own: turn panes on and off, move and resize
them, pick a font size and a colour theme. The settings live behind a
gear in the player's control box, so the rest of the screen stays clean.

## Scope

Part A — in:

- A gear in the control box (bottom right). Clicking it folds a settings
  section into the box; clicking again folds it away. The chrome does not
  auto-hide while it is open.
- Panes: one on/off toggle per pane (character, timers, group, comm, ui,
  map).
- Layout: the viewer drags panes to other docks and resizes docks and
  panes the way the live client does. Reset returns to the recorded
  layout.
- Font size: Default (as recorded) → Small → Medium → Large.
- Colours: Default (as recorded) → Dark → Teal → Paper → Sepia → Slate,
  with BG/FG black/silver, teal/silver, paper/ink, sepia/ink, slate/ink
  (the existing presets). Any theme but Default sets every pane's colour
  to None (the terminal background, as None works in Options → Panes).
- The timers pane's `+` corner (herblore add-view) is gone in the
  player and in the HTML replay; no pane in a player lets the viewer
  change game state.
- Same behaviour in the in-app RUN LOG, the HTML replay and (settings
  only where they make sense) the Spotlights reel.

Part A — out: saving the viewer's choices between opens (see ADR 0021),
per-pane colour editing, custom palettes.

Later parts (not planned yet): fixes from PvP testing, performance pass
(Chromium burst frame 39–58 ms), polish, and the carried items in
`progress.md` (map pane default height, replay font subsetting, player
paint after a long seek, JetBrains Mono exports without DejaVu fallback
glyphs, reel load time on a large library, live checks of stage 7,
`look` → Room.Info).

## Owner decisions

- 2026-09-28 (brief): settings behind a gear in the player box; start
  from the recorded layout and panes; viewer can rearrange, resize and
  toggle panes; font size small/medium/large; six colour themes as
  listed above; non-default theme → all pane colours None; no timers `+`
  in players.

## Tasks

Part A:

- [x] Stage file, ADR 0021.
- [ ] A1. Viewer overrides model (pure) + tests: font, theme, panes,
      layout; applied over every VIEW record and on every App rebuild
      (backward seek).
- [ ] A2. PlayerHost applies the overrides; the viewer's drag/resize in
      the player cockpit becomes a sticky layout override.
- [ ] A3. Gear and the fold-out settings section in the control box
      (PlayerView), keyboard/pointer handling, chrome stays while open.
- [ ] A4. Timers `+` corner and herblore add-view off in player Apps;
      audit the other panes for state-changing clicks in players.
- [ ] A5. HTML replay and Spotlights reel wiring; e2e for RUN LOG and
      the replay; unit + e2e green; build.
- [ ] A6. Owner test.

## Test guide (part A)

Open: History → a session with panes → RUN LOG. Then EXPORT the same
session to HTML and open the file.

Try:

1. The layout at the start matches what you had when you played.
2. Click the gear in the control box (bottom right). The box grows with
   the settings. Turn a pane off and on.
3. Drag a pane to another dock, resize a dock. Seek backwards and
   forwards: your layout stays. Reset: back to the recorded layout.
4. Cycle font size Default → Small → Medium → Large.
5. Cycle the colours. Every theme but Default shows the panes without
   colour tints. Paper (light) — is everything readable?
6. The timers pane has no `+` in the corner.
7. Do 2–6 in the HTML file too.

Feedback wanted: the gear's place and the fold-out's look; whether the
theme and font choices are right; anything in a pane that still reacts
to clicks in a way it should not.

## Owner feedback
