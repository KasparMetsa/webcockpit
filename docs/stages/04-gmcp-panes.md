# Stage 4 — GMCP panes

> Status: In progress.
> Source: spec §5 row 4, §2.4, §1.4, §2.1 (connection lines). Inv §2.1
> (inactive panes, shade ramp), §2.2, §2.3, §2.4, §2.5, §2.7, §8.1–8.2,
> §8.3 (wimpy, clock lines only). ADR 0016.

## Goal

The owner plays group PvP with the right-column panes filled from GMCP:
Character (vitals, XP/TP, toggles, gauges), Group (room-scoped members
with HP/mana/moves bars), Comm (channel history with filters, kept per
character across reloads), UI messages (system and event lines), and the
day/night clock in the input line. GMCP works under the hood; there are
no GMCP tools for the user.

## Scope

In:

- **GMCP state models** (pure TS, unit tested in Node): character,
  group (room-scoped, label promotion, vital-pair freshness, mid-fight
  `buffer`/`opponent` HP), comm (formatting per ADR 0013 of Cockpit, Inv
  §2.7.3), clock (anchor, precision, sync sources, day/night).
- **Pane context**: side panes get the bus, settings, storage and frame
  scheduler; render at most once per frame on change.
- **Inactive panes**: Character, Group and Comm blank while not
  `playing`; UI keeps its log (Inv §2.1). Character state resets on
  disconnect.
- **Character pane** (Inv §2.2): name + XP bar + level badge, TP bar,
  SNEAK/RIDE/CLIMB/SWIM boxes, MOOD/ALERTNESS/POSITION/WIMPY gauges,
  shade ramp from the pane colour, level from XP via our own level
  table, troll TP scaling, session-gain rules. Wimpy from text lines
  (system rules).
- **Group pane** (Inv §2.3): three bars per member, thresholds, name
  overlay, `Name (Label)`, ordering, overflow row, light-pane washout;
  Options → Panes → Group (show players, NPC mode).
- **Comm pane** (Inv §2.7): header with width regimes, channel colours,
  left-click toggle, right-click solo, message formatting, scroll by
  message with `↓ N newer messages`, timestamps only when scrolled back;
  Options → Panes → Communication (channel list, show header). Filters
  global. History per character in IndexedDB, 7-day prune, 1000 in
  memory, seeded on `Char.Name`, not cleared on disconnect.
- **UI messages pane** (Inv §2.4): prefixes and colours, scroll, 1000
  lines. Emits: connect/login/logout/closed, profile saved/applied,
  achievement (`Event.Achieved`), warnings. Kills, affects and other
  tracker lines come with stage 5–6.
- **Clock** (Inv §2.5): model, sync from `Event.Sun`, `time` output and
  the room clock line (system rules); input-line strip (countdown and
  ☼/☾), second-aligned re-render; global persistence with the age rules.
  MSSP time if MUME sends a usable field.
- **GMCP in the raw capture**: inbound GMCP is recorded in the run so a
  later replay (and stage 6's log player) can drive the panes. Replay
  feeds recorded GMCP back through telnet.
- **Offline demo**: a synthetic fixture with GMCP (group fight, comm
  traffic, sunrise, level-up) so the panes can be tested without
  logging in.
- **Carry-over**: live checks 1–2 from stage 3.

Out: Timers pane and trackers (stage 5), kill/pkill/death UI lines and
XP folding (stage 5–6 with runs), map and `Room.*` consumers (stage 9),
`MUME.Client.Edit/View` remote editing (later; noted), GMCP inspector
(intent: no user GMCP tools).

## Owner decisions

Technical choices in ADR 0016.

- **2026-09-27 — full-screen replay.** The HTML replay export (stage 7)
  and the log player (stage 6) show all panes in the layout the player
  had, not only the game output; the input pane is left out. Owner:
  "a replay that actually matches what the player saw". So from this
  stage on, the run capture records GMCP, layout/appearance snapshots
  and the window size in cells, in addition to lines and commands.

Carried: the owner wants per-character state to survive sessions
(2026-09-27). This stage covers comm history. Timers follow in stage 5.

## Tasks

- [x] Stage file and ADR 0016.
- [x] P0. Foundation: pane context and factory, inactive blanking,
      settings keys, IndexedDB `comm` store, GMCP capture and replay,
      offline demo fixture, `ui.message` bus event. Also VIEW/SIZE
      capture records (owner decision). Notes in ADR 0016; demo at
      `/?fixture=gmcp-demo.log`.
- [x] P1. Character pane, Group pane (+ options), clock model and
      input strip. GameState hub in the pane context, replay end keeps
      the panes, demo fixture in MUME's output shape. Notes in ADR 0016.
- [x] P2. Comm pane (+ options, archive), UI messages pane and its
      emitters. Notes in ADR 0016 (`PANE_FACTORIES` moved to
      `src/panes/factories.ts`).
- [x] Merge P1 + P2; bench still passes (§1.3): 500 rules 13 µs/line;
      key → send p99 0.13/0.16 ms; paint p95 19/19 ms, 0 late frames;
      burst max frame 24/19 ms (Chromium/Firefox).
- [x] Main-session verification (696 unit, 114 e2e; demo screenshot:
      all four panes, clock strip, blank lines in the game output).
- [x] Test guide ready.
- [ ] Owner test.

## Live checks for the owner

1. **Idle timeout** (carried): stay idle 5+ minutes; does the link
   survive, and does `Link:` in the ESC menu keep updating?
2. **Auto-open on disconnect** (carried): after `quit`, the ESC menu
   opens with Reconnect selected.
3. **Group PvP**: group members' bars and labels follow the fight;
   Comm shows tells/narrates as in Cockpit; the clock strip counts down.

## Test guide

**Start:** `cd ~/proj/webcockpit && npm run dev` (restart it if it was
already running: the fixture route changed), then open
http://localhost:5173/.

**Offline demo (no login):**
http://localhost:5173/?fixture=gmcp-demo.log plays a 58 s synthetic
session (`&speed=0` jumps to the end, `&speed=2` doubles). The panes keep
their last picture when it ends. Look at:

1. **Character:** name and `L26`, the XP bar behind the name and the TP
   bar under it (session gain in a lighter shade after the level-up),
   SNEAK/RIDE/CLIMB/SWIM boxes, MOOD/ALERTNESS/POSITION gauges with
   their ticks, the WIMPY caret.
2. **Group:** three bars per member, `a citizen mercenary (MERC)`,
   `a large dog (DOG)`; members leave and come back.
3. **Comm:** the channel header (left-click toggles, right-click solo,
   right-click again restores), wheel up shows `HH:MM` stamps and
   `↓ N newer messages`; click it to return.
4. **UI:** `● SYSTEM:` and `▶ ACHIEVEMENT:` lines.
5. **Clock:** the input line's right end, e.g. ` 11:52☼`, counts down
   every second.
6. **Options:** ESC → Options → Panes is now a hub: General (the old
   grid), Communication (channels, show header), Group (show players,
   NPC mode off/labeled/all). Changes apply at once.
7. Change the terminal to a light background (Appearance): the panes
   switch to their light shades.

**Live (log in):**

1. Group PvP: the Group pane follows the fight (bars, labels, members
   in your room only); the mercenary's HP moves mid-fight.
2. Comm: tells, narrates, says as in Cockpit. Reload the page, log in
   again: the history is back (kept 7 days per character).
3. Character: toggles and gauges follow `sneak`, `ride`, mood, wimpy.
4. Clock: `time` or looking at a clock sets it; the strip counts down
   to the next sunrise/sunset.
5. Live checks 1–3 above.
6. Each run now also records GMCP and your layout (for the full-screen
   replay in stages 6–7); nothing to test yet.

**Feedback wanted:**

- Does each pane look and behave like Cockpit's? Anything off in
  colours, shades, order or wording?
- Comm deviations from Cockpit (chosen on purpose, tell me if you
  disagree): full channel names whenever they fit; long talker names
  such as `Thrakghash of the Mordor Flame` are kept whole; enemy
  stars kept (`*Throzghul*`).
- The existing `[SYSTEM]` lines stay in the game output next to the UI
  pane. Keep both, or move them to the UI pane only?
- The `▀` tick glyphs under the gauges in your font.

Known in stage 4: with the pane border off, Comm's header covers the
drag grip (drag between the labels); a profile saved from the start
page before entering the game gives no UI line; the capture warning
repeats on every load while capture is off; the TP bar shows progress
through the current level's TP range (Inv §2.2's troll example
disagrees with Cockpit's own code); MSSP game day is taken as 0-based
(unchecked live); Timers stays empty until stage 5.

## Owner feedback

### 2026-09-27 — demo fixture (during the build)

1. The demo log works but lacks MUME's blank lines. Cause: the synthetic
   fixture, not the client. Real MUME sends an empty line before every
   prompt, and unsolicited output is framed by empty lines (checked
   against Cockpit's run logs). The generator is being fixed in P1.

### 2026-09-27 — first test

1. Group pane follows the fight in group PvP.
2. Comm talker names: the owner prefers Cockpit's short names ("too
   spammy otherwise"). Fixed: cut at the first `" the "` as in Cockpit,
   without the dangling `of`. Full channel names and enemy stars were
   not objected to and stay.
3. `[SYSTEM]` lines stay both in the game output and in the UI pane.
4. Live checks: the link survives 5+ minutes idle and `Link:` keeps
   updating; the ESC menu opens by itself on disconnect. Both carried
   checks are closed.
