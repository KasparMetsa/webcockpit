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
- [x] P0. Foundation: DB v6 `exports` store and library methods, edits
      model, timeline edits (cuts, comments with holds, spotlight
      windows, blanks), engine holds, `PlayerView` options, text export,
      replay payload, spotlight selection, chronicle, spotlight settings.
- [x] P1. Export editor frame, History EXPORT, downloads.
- [x] P2. HTML replay: replay bundle (dev and build), page runtime,
      `buildReplayHtml`.
- [x] P3. Spotlights reel, Credits, Options → Spotlights, start page.
- [x] Merge; bench still passes (§1.3), except the known borderline
      Chromium burst frame (stage 8).
- [x] Main-session verification (959 unit, 158 e2e; screenshots of the
      editor, the replay, the reel and Credits). Two reel fixes: info box
      over the game text, login state read for the panes.
- [x] Test guide ready.
- [ ] Owner test 1.

## Live checks for the owner

1. After a real session with a PvP kill or a death: Spotlights shows it,
   and Credits mentions it.
2. Export a real fight as HTML, open the file from the Downloads folder
   (double-click, no dev server), and send it to a friend if you like.

## Test guide

**Start:** `cd ~/proj/webcockpit && npm run dev` (restart it if it was
already running), then open http://localhost:5173/. If History is empty,
History → RESTORE → `~/proj/webcockpit/tests/fixtures/runs-demo.jsonl.gz`
(the stage 6 demo: Gittan and Rasta, with kills, a PvP kill, a death, a
level-up and achievements).

1. **Export editor:** History → the Rasta row → EXPORT. Move with ↑/↓ and
   PgUp/PgDn; `C` adds a comment before the cursor line (preview and hold
   time shown), `E`/`D` edit/delete it; `X` starts excluding from the
   cursor line, `X` again further down stops (red bar, grey lines); `T`
   sets a title; `F` toggles HTML / TEXT; the map on the right shows the
   comment, excluded parts and K/D/A/L. BACK and open it again: your edits
   are still there (also after reloading the page).
2. **Text export:** FORMAT: TEXT → EXPORT. Open the `.txt` from Downloads:
   no timestamps or colour codes, your comment as `## …`, the excluded
   lines gone.
3. **HTML replay:** FORMAT: HTML → EXPORT. Close the dev server if you
   like, then double-click the `.html` in Downloads. It plays by itself:
   game text and panes as recorded, the comment in yellow holding the
   playback for a few seconds, the cut lines not there at all. Try Space,
   `1`–`6`, ↑/↓ in pause, click/drag the strip (hover shows the time),
   click a marker, `F` or the Fullscreen button, ESC (leaves fullscreen
   only). Try it in the other browser too.
4. **Spotlights:** start page → Spotlights. Five moments play one after
   another, newest first, alternating characters; the info box (top right
   of the game text) says what and counts down to the moment; → / ← jump;
   move the mouse to see the header and strip. It stops on the last one.
   ESC back.
5. **Credits:** start page → Credits. The chronicle rolls up slowly and
   returns by itself at `The End.` (or ESC).
6. **Options → Spotlights:** turn kinds off; Spotlights and Credits
   follow. All off gives the "all disabled" message.

**Choices you may want to change** (tell me):

- The HTML file is ~0.7 MB for the demo and ~2 MB for a 5 h log; it holds
  the whole player and the font. Trimming the fonts would save ~0.3 MB.
- The replay uses the same speeds as the player (0.25×–8×), not
  Cockpit's 0.25×–1×.
- In the editor, commands are on their own lines (`> kill bat`), not after
  the prompt as in the game; empty Enters are not shown.
- A cut plays as a jump of at most 0.5 s; the panes (vitals, group,
  timers) still follow what happened during the cut, but the Comm pane
  and the text do not show it.
- Credits' wording is our own, in a light chronicle tone.

Feedback wanted: does the exported file open and play well on another
computer; is the editor comfortable for cutting a fight; do Spotlights
and Credits feel like Cockpit's.

## Owner feedback

### During the build (2026-09-28)

1. *The output scrollbar lights up whenever text arrives* (overlay
   scrollbars flash on every programmatic scroll; also in the player).
   Fixed: the scroller's scrollbar is transparent unless the view is
   scrolled back (`wc-scrolled`); transparent rather than hidden, so a
   classic scrollbar keeps its width and the text never reflows.
