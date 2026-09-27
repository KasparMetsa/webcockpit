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
- [ ] P2. Comm pane (+ options, archive), UI messages pane and its
      emitters.
- [ ] Merge P1 + P2; bench still passes (§1.3).
- [ ] Main-session verification in a browser.
- [ ] Test guide ready.
- [ ] Owner test.

## Live checks for the owner

1. **Idle timeout** (carried): stay idle 5+ minutes; does the link
   survive, and does `Link:` in the ESC menu keep updating?
2. **Auto-open on disconnect** (carried): after `quit`, the ESC menu
   opens with Reconnect selected.
3. **Group PvP**: group members' bars and labels follow the fight;
   Comm shows tells/narrates as in Cockpit; the clock strip counts down.

## Test guide

(Written when the stage is built.)

## Owner feedback

(After testing.)
