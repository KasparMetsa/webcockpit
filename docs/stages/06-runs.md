# Stage 6 — Runs

> Status: In progress.
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
- [ ] P1. History, Statistics (both surfaces), Exit with rating, start
      page and ESC menu entries. Notes in ADR 0018.
- [ ] P2. Log player: controllable replay with replay clock, seek,
      speeds, recorded layout, chrome (header, strip, markers, control
      box), echo of replayed commands. Notes in ADR 0018.
- [ ] Merge P1 + P2; bench still passes (§1.3).
- [ ] Main-session verification.
- [ ] Test guide ready.
- [ ] Owner test.

## Live checks for the owner

1. Play a while, kill a few mobs; ESC → Statistics shows the kills with
   XP, the allies, and XP/h.
2. Log out and in within an hour: History shows one session (two runs);
   the player plays both as one timeline ("Run 1 of 2").
3. ESC → Exit session with 3 stars: History shows `Saved ★★★`.
4. The player shows the panes as they were (Character, Group, Timers,
   Comm, UI) and the commands you typed.

## Test guide

(Written when the build is verified.)
