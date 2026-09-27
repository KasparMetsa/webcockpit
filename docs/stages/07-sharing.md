# Stage 7 — Sharing

> Status: In progress (started 2026-09-28).
> Source: spec §5 row 7, §2.8, §2.5. Inv §7.6 (Spotlights, Credits),
> §7.7 (export editor, HTML replay), §3.8 (Options → Spotlights), §7.4
> (History EXPORT), §7.8 (sweep also removes export records).
> ADR 0018 (runs, player), ADR 0019 (this stage).

## Goal

The owner picks a fight in History, opens the export editor, cuts away
what should not be shown, adds a comment or two, gives it a title, and
exports one `.html` file. A friend opens that file in any desktop browser,
with no WebCockpit and no internet, and watches the fight the way the
owner saw it: game text and every pane, in the recorded layout, with
play, pause, seek and speed, and the comments holding the playback while
they are read. On the start page, Spotlights plays the evening's deaths,
level-ups, PvP kills and achievements as a reel across characters, and
Credits rolls a chronicle of every character's deeds.

## Scope

In:

- **Export editor** (Inv §7.7): History → EXPORT (active when the chain
  has a log). Info row, log with gutter (cursor, exclusion bar, greyed
  excluded lines), comments `## …`, overview map with markers, exclusion
  ranges, comments (add/edit/delete, ≤ 600 chars, wrapped at 80), title,
  format HTML / Text, EXPORT (browser download), BACK. Every edit saved
  as it happens (IndexedDB, keyed by the session's first run id, anchors
  are log µs). Keys and mouse as in Inv §7.7.
- **Text export:** kept lines without timestamps and ANSI, commands as
  echoed, comments as `## ` lines, a blank line between runs.
- **HTML replay:** one self-contained file (player code, CSS, the bundled
  font and the log inside; no network). It is the log player: the same
  App, panes, layout, strip, markers, control box and keys, plus the
  replay's own bits (title in the header, comment holds, cut points at
  ≤ 0.5 s, `F` fullscreen, strip hover time). Excluded lines are not in
  the file at all.
- **Spotlights** (Inv §7.6): the reel across all characters (deaths,
  level-ups, PvP kills, achievements), windows `[event − 10 s, event +
  5 s]`, rotation, blank transition, info box with countdown, `←`/`→`,
  header, park at the end, empty states.
- **Credits** (Inv §7.6): the scrolling chronicle of all characters,
  with our own wording, stable per event; fades, 1 row/s, ESC.
- **Options → Spotlights** (Inv §3.8): four toggles, global, filter both
  reel and Credits.
- **Start page:** Spotlights and Credits become active.
- **Backup** (ADR 0018) also carries the export editor records; Delete
  and the 14-day sweep remove them.

Out: sharing hosting (the file is the share), import of Cockpit exports
(non-goal), video/GIF export, map (stage 9).

## Owner decisions

None needed to start. Technical choices are in ADR 0019; the ones the
owner may want to change after testing are listed in the test guide.

## Tasks

- [x] Stage file and ADR 0019.
- [ ] P0. Foundation: DB v6 `exports` store and library methods, edits
      model, timeline edits (cuts, comments with holds, spotlight
      windows, blanks), engine holds, `PlayerView` options, text export,
      replay payload, spotlight selection, chronicle, spotlight settings.
- [ ] P1. Export editor frame, History EXPORT, downloads.
- [ ] P2. HTML replay: replay bundle (dev and build), page runtime,
      `buildReplayHtml`.
- [ ] P3. Spotlights reel, Credits, Options → Spotlights, start page.
- [ ] Merge; bench still passes (§1.3).
- [ ] Main-session verification (unit, e2e, screenshots).
- [ ] Test guide ready.
- [ ] Owner test 1.

## Live checks for the owner

1. After a real session with a PvP kill or a death: Spotlights shows it,
   and Credits mentions it.
2. Export a real fight as HTML, open the file from the Downloads folder
   (double-click, no dev server), and send it to a friend if you like.

## Test guide

(Written at the end of the stage.)

## Owner feedback

(After testing.)
