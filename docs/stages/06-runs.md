# Stage 6 — Runs

> Status: Owner testing.
> Source: spec §5 row 6, §2.8, §1.4, §2.5, §2.6. Inv §7.1–7.5, §7.8,
> §4.6 (Exit + rating), §8.3 (mob_death, pc_death, char_death rows).
> ADR 0008, 0016, 0017, 0018.

## Goal

After an evening of play the owner opens History on the start page, sees
the day's sessions, opens one in the log player and watches it the way
it looked on screen — game text and every pane, in the recorded layout —
with play, pause, seek and speed. Statistics shows the kills, PvPs,
allies, achievements and XP/TP curves of a session, live from the ESC
menu and afterwards from History. Old unsaved runs go away after 14
days; saved and rated ones stay, and all runs can be backed up to a file
and restored.

## Scope

In:

- **Run events** (Inv §7.2): run_start (first `Char.Vitals`, baseline
  level/XP/TP, `previousRunId`), run_end, orphan_close, level_up, kill
  and pkill (500 ms XP fold), tp_gained, xp_loss, tp_loss, char_death,
  achievement, group_changed. µs timestamps; kills and deaths carry the
  µs of their log line. Stored per run in IndexedDB, with a per-run
  summary for History. Too-short runs (no `Char.Vitals`) are deleted.
- **`◆` lines** in the UI pane for attributed kills, pkills and deaths
  (Cockpit's `KILL` / `PKILL` / `DEATH` announces).
- **Sessions**: runs stitched into chains (predecessor link, gap
  < 3600 s). Saved/rating per chain as in Inv §7.4, §7.8.
- **History** (Inv §7.4): pills, table, sort, RUN LOG, STATS, RATE,
  SAVE, EXPORT (dim, stage 7), DELETE (modal), BACK; plus BACKUP and
  RESTORE (all runs to and from one file, spec §1.4) and the storage use
  in the footer.
- **Statistics** (Inv §7.3): one renderer for ESC → Statistics (live
  run chain, 1 Hz) and History → STATS (archived chain).
- **Exit session with rating** (Inv §4.6).
- **Log player** (Inv §7.5, spec §2.8): the chain as one timeline, the
  whole screen in the recorded layout (panes rebuilt from recorded GMCP,
  lines and sent commands, trackers on the replay clock), echo of sent
  commands, header, strip with gold playhead and K/D/A/L markers, control
  box, auto-hide, pause cursor, seek, speeds, gap collapse.
- **Retention** (Inv §7.8): 14-day sweep of unsaved runs at start, one
  tab at a time.
- **Demo data**: a backup file with a few runs (two characters, one
  stitched chain, kills, a pkill, a death, a level-up, an achievement)
  the owner can RESTORE to try History, Statistics and the player
  without playing.

Out: Spotlights, Credits, the export editor and the HTML replay (stage
7; the player's renderer is built so the HTML replay can reuse it),
import of Cockpit data (non-goal), chunk compression (ADR 0008 revisit).

## Owner decisions

None needed to start. Technical choices are in ADR 0018; the ones the
owner may want to change after testing are listed in the test guide.

## Tasks

- [x] Stage file and ADR 0018.
- [x] P0. Foundation: DB v5, run events deriver + writer, UI `◆` lines,
      run library (list, stitch, chain load, save/rate, delete, sweep,
      backup/restore), demo backup generator. Notes in ADR 0018.
- [x] P1. History, Statistics (both surfaces), Exit with rating, start
      page and ESC menu entries. Notes in ADR 0018.
- [x] P2. Log player: controllable replay with replay clock, seek,
      speeds, recorded layout, chrome (header, strip, markers, control
      box), echo of replayed commands. Notes in ADR 0018.
- [x] Sparkline rates over a trailing ≥ 10 min window (owner request
      after P1; ADR 0018 main-session note).
- [x] Merge P1 + P2; bench still passes (§1.3): burst max frame
      48.9 / 35.9 ms (Chromium / Firefox), 500 rules + system rules
      27.9 µs/line. Seek to the end of a 5 h log 1.6 s painted.
- [x] Main-session verification (874 unit, 138 e2e; screenshots of
      History, Statistics, player playing and paused).
- [x] Test guide ready.
- [x] Owner test 1 (2026-09-28): three player fixes, see Owner feedback.
- [ ] Owner test 2.

## Live checks for the owner

1. Play a while, kill a few mobs; ESC → Statistics shows the kills with
   XP, the allies, and XP/h.
2. Log out and in within an hour: History shows one session (two runs);
   the player plays both as one timeline ("Run 1 of 2").
3. ESC → Exit session with 3 stars: History shows `Saved ★★★`.
4. The player shows the panes as they were (Character, Group, Timers,
   Comm, UI) and the commands you typed.

## Test guide

**Start:** `cd ~/proj/webcockpit && npm run dev` (restart it if it was
already running), then open http://localhost:5173/.

**Demo data (no login):** the demo backup holds four runs (Gittan ×2,
Rasta ×2 stitched into one saved ★★★★ session with kills, a pkill, a
death, a level-up and an achievement). Start page → History → RESTORE →
pick `~/proj/webcockpit/tests/fixtures/runs-demo.jsonl.gz`. (Or open
http://localhost:5173/?player=runs-demo.jsonl.gz to go straight to the
player.) Then:

1. **History:** three rows, Rasta `Saved ★★★★`. Pills (All / Gittan /
   Rasta) filter; click column headers to sort; SAVE, RATE (0–5 stars),
   DELETE (modal, Y deletes); storage use at the bottom.
2. **STATS** on the Rasta row: allies, achievements (`↑ Reached level
   42`, `★ …`), kills and PvPs tables (click headers to sort, Tab moves
   between tables), XP/h and TP/h curves, the XP ruler.
3. **RUN LOG** (or Enter on the row): the log player. Header `Rasta (L42)
   · Run 1 of 2 · …`; the game text with your commands echoed; the panes
   as recorded (Character, Group, Comm, UI with `◆ KILL:` lines); the
   strip on the right with the gold playhead and `K► D► A► L►` markers;
   the control box. Try: Space (pause/play), `1`–`6` (0.25× … 8×), click
   or drag the strip, click a marker, ↑/↓ in pause (cursor line) then
   Space (plays from that line), Rewind, ESC (back to History, same row).
   The chrome hides after 6 s of play; move the mouse to bring it back.
4. **BACKUP** downloads all runs as one `.jsonl.gz`; RESTORE of the same
   file says the runs are already present.

**Live (log in):** live checks 1–4 above, plus: ESC → Exit session shows
a star row (`Rate & save this run`); pick stars, Y, and the session is
`Saved` in History.

**Choices you may want to change** (tell me):

- The player shows the raw game text without your profile's
  highlights/substitutes (like Cockpit's player and the future HTML
  replay).
- The player fits the recorded screen to the window by font size.
- Speeds 0.25×–8× on keys `1`–`6`.
- XP/h and TP/h are averaged over at least 10 minutes (your request).
- After a long jump the text takes up to ~1 s to fill in the scrollback.

Feedback wanted: does History/Statistics/the player look and feel like
Cockpit's; are the kills, pkills and deaths right after a real session;
anything that stutters in the player.

## Owner feedback

### Test 1 (2026-09-28)

1. *Delay from RUN LOG until anything shows.* Cause: the recorder keeps
   the login phase's GMCP with its receive times (`Comm.Channel.List` at
   connect, `Char.Name` after the password), and the player played those
   seconds in real time on a blank screen. Fixed in the player's
   timeline (so existing recordings play right too): each run's lead-in
   up to its first visible line or typed command takes no time; text
   shows at 00:00, and run 2 of a session starts straight after run 1.
   Clock, strip and markers follow the shortened timeline (ADR 0018
   amendment).
2. *Empty space left and right.* No more letterboxing to the recorded
   size: the player fills the window left of the strip with the recorded
   layout and font size, docks keep their widths and the game text
   reflows, as when playing. The font only shrinks on a window too small
   for the 60 × 18 minimum.
3. *Only `ESC Back` in the header.* The header now shows `Space
   Play/Pause · 1–6 Speed · ↑↓ Cursor · ESC Back`; on a narrow window
   Cursor goes first, then Speed, then Play/Pause; `ESC Back` always
   stays.

Retest: open a real session from History (text at once), check the
layout at your usual window size, and read the header hints.

